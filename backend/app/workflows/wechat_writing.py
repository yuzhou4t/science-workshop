import asyncio
import json

from app.models.job import Artifact, JobStatus, NodeStatus, WorkflowJob
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


RERUN_GRAPH: dict[str, list[str]] = {
    "basic_info": ["draft", "final", "docx_export"],
    "method_data_figures": ["draft", "final", "docx_export"],
    "formula_metrics": ["draft", "final", "docx_export"],
    "angle": ["article_draft", "article_final", "final", "docx_export"],
    "article_draft": ["article_final", "final", "docx_export"],
    "article_final": ["final", "docx_export"],
    "draft": ["final", "docx_export"],
    "final": ["docx_export"],
}

EDITABLE_NODE_ARTIFACTS: dict[str, str] = {
    "basic_info": "nodes/basic_info.md",
    "method_data_figures": "nodes/method_data_figures.md",
    "formula_metrics": "nodes/formula_metrics.md",
    "angle": "nodes/angle.md",
    "article_draft": "nodes/article_draft.md",
    "article_final": "nodes/article_final.md",
    "draft": "nodes/draft.md",
    "final": "nodes/final.md",
}


REFERENCE_PUBLIC_ACCOUNT_STYLE = (
    "请严格贴近用户提供的“研读非洲”公众号样稿版式，而不是普通论文摘要。\n"
    "输出必须按以下顺序组织：\n"
    "1. 标题行：使用“【研读非洲｜第X期】主题”。如果材料或用户输入没有提供期数，保留“第X期”，"
    "不要编造具体期数。\n"
    "2. 标题下方单独一行写“图片”。全文需要配图的位置，也单独一行写“图片”作为占位，不要写图片说明。\n"
    "3. 导语：写 2-4 段，先交代现实问题、材料价值、核心问题和全文判断。不要写成摘要罗列。\n"
    "4. PART01 研究背景：解释材料讨论的问题从哪里来，现实痛点、制度背景、产业背景或研究缺口是什么。\n"
    "5. PART02 发展现状：用“3个……发展现状”或“4个……核心发现”作为小标题，随后用 01、02、03 编号。"
    "每个编号下先写一句短标题，再写材料内证据、关键数字、图表或公式含义。\n"
    "6. PART03 进一步研究：用 1、2、3 分点展开后续研究问题、机制解释、局限或值得追问的方向，"
    "必须基于材料，不得空泛延伸。\n"
    "7. PART04 结论与建议：先用一段总括判断收束，再分“第一，第二，第三……”写建议或启示。"
    "如果材料不是政策报告，可把“建议”改成“研究启示”，但仍保留 PART04 标题为“结论与建议”。\n"
    "8. 引用格式: 按材料给出的作者、题名、机构/期刊、日期、链接整理；缺失就写“材料中未明确说明”。"
    "注意这里使用半角冒号“引用格式:”。\n"
    "9. 结语：最后必须附上固定栏目结语，不得改写为个人号口吻。\n"
    "硬性禁令：不得输出方括号占位、模板说明、示例解释或“请根据实际填入”。"
    "不要单独输出“导语”二字作为小标题；导语直接写成正文段落。"
    "每个 PART 标题、图片占位和分节标题都必须单独成行，不能挤在同一段里。\n"
    "固定栏目结语如下：\n"
    "数智非洲聚焦大数据、人工智能与非洲研究的有机结合，致力于探索数智时代下的非洲研究新范式。"
    "推荐前沿文献和权威报告，解读数智方法和数据集，并分享科研工作坊动态与研究进展。"
    "希望为学者、从业者及关注者提供洞察非洲发展的知识平台，共同拓展非洲研究的新视野。"
    "本文仅为个人对论文内容的初步理解，不代表原论文的官方观点。如果你对这篇文章感兴趣，"
    "请分享给身边的朋友，一起讨论这些有趣的科学发现吧!也欢迎关注和加入我们，扩展非洲研究的新视野!"
    "欢迎点击文末【阅读原文】阅读完整文献。\n"
)


def downstream_nodes(node_id: str) -> list[str]:
    return list(RERUN_GRAPH.get(node_id, []))


def editable_node_artifact_path(node_id: str) -> str:
    relative_path = EDITABLE_NODE_ARTIFACTS.get(node_id)
    if relative_path is None:
        raise ValueError("Unsupported editable node")
    return relative_path


def validate_rerun_node(node_id: str) -> None:
    if node_id not in RERUN_GRAPH:
        raise ValueError("Unsupported rerun node")


class WeChatWritingWorkflow:
    def __init__(
        self,
        store: JobStore,
        events: EventBroker,
        deepseek: DeepSeekClient,
        docx_exporter: DocxExporter,
    ) -> None:
        self.store = store
        self.events = events
        self.deepseek = deepseek
        self.docx_exporter = docx_exporter

    async def run(self, job_id: str) -> WorkflowJob:
        job = self.store.load_job(job_id)
        job.status = JobStatus.RUNNING
        self.store.save_job(job)

        try:
            source_bundle = self._read_source_bundle(job)
            angle = await self._llm_node(job, "angle", self._angle_prompt(source_bundle), 20)
            draft = await self._llm_node(job, "article_draft", self._draft_prompt(source_bundle, angle), 45)
            article_final = await self._llm_node(job, "article_final", self._final_prompt(draft), 70)
            final = self._mirror_final(job, article_final)
            self._export_docx(job, final)
            job.status = JobStatus.COMPLETED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "completed", "workflow", "公众号写作完成", 100, {})
            return job
        except asyncio.CancelledError:
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "failed", "workflow", "Workflow cancelled", 100, {})
            raise
        except Exception as exc:
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "failed", "workflow", str(exc), 100, {})
            raise

    def _read_source_bundle(self, job: WorkflowJob) -> dict:
        source_path = self.store.job_dir(job.job_id) / "input" / "source_bundle.json"
        return json.loads(source_path.read_text(encoding="utf-8"))

    async def _llm_node(self, job: WorkflowJob, node_id: str, prompt: str, progress: float) -> str:
        self.store.set_node_status(job, node_id, NodeStatus.RUNNING)
        await self.events.publish(job.job_id, "progress", node_id, f"{node_id} 正在生成", progress, {})
        try:
            content = await self.deepseek.generate(node_id, prompt)
            self.store.write_text_artifact(job, f"nodes/{node_id}.md", content)
            self.store.set_node_status(job, node_id, NodeStatus.COMPLETED, [f"{node_id}.md"])
            return content
        except asyncio.CancelledError:
            self.store.set_node_status(job, node_id, NodeStatus.FAILED, error="Workflow cancelled")
            raise
        except Exception as exc:
            self.store.set_node_status(job, node_id, NodeStatus.FAILED, error=str(exc))
            raise

    def _mirror_final(self, job: WorkflowJob, final_markdown: str) -> str:
        self.store.set_node_status(job, "final", NodeStatus.RUNNING)
        try:
            self.store.write_text_artifact(job, "nodes/final.md", final_markdown)
            self.store.set_node_status(job, "final", NodeStatus.COMPLETED, ["final.md"])
            return final_markdown
        except Exception as exc:
            self.store.set_node_status(job, "final", NodeStatus.FAILED, error=str(exc))
            raise

    def _export_docx(self, job: WorkflowJob, final_markdown: str) -> None:
        self.store.set_node_status(job, "docx_export", NodeStatus.RUNNING)
        try:
            output_path = self.store.job_dir(job.job_id) / "exports" / "final.docx"
            self.docx_exporter.export_markdown(final_markdown, output_path)
            job.artifacts["final.docx"] = Artifact(
                name="final.docx",
                relative_path="exports/final.docx",
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            self.store.set_node_status(job, "docx_export", NodeStatus.COMPLETED, ["final.docx"])
        except Exception as exc:
            self.store.set_node_status(job, "docx_export", NodeStatus.FAILED, error=str(exc))
            raise

    def _angle_prompt(self, source_bundle: dict) -> str:
        return (
            "基于以下材料，先做公众号写作策划，不要直接写正文。请输出中文 Markdown，覆盖：\n"
            "1. 目标读者：这篇文章主要写给谁，他们需要先理解什么。\n"
            "2. 核心主张：用一句话说明文章最想让读者带走的判断。\n"
            "3. 标题方向：给 3 个克制、材料内有依据的标题备选。\n"
            "4. PART结构：按 PART01 研究背景、PART02 发展现状、PART03 进一步研究、"
            "PART04 结论与建议规划每部分写什么。\n"
            "5. 必须出现的数据、公式或图表：列出正文不能遗漏的证据点。\n"
            "6. 不确定信息：列出材料没有明确说明、正文不能补写的内容。\n\n"
            f"{self._source_text(source_bundle)}"
        )

    def _draft_prompt(self, source_bundle: dict, angle: str) -> str:
        return (
            "根据写作策划和原始材料，写一版可编辑的中文公众号精读初稿。"
            "不得补写材料外事实、作者机构、数据、案例或夸张评价。\n"
            "写作重点不是普通摘要，而是把问题、证据、图表、公式和方法逻辑讲清楚。\n\n"
            f"{REFERENCE_PUBLIC_ACCOUNT_STYLE}\n"
            "正文要求：\n"
            "- PART02 必须采用 01、02、03 这类编号；根据材料数量写 3-5 个现状、发现或判断，不要硬凑。\n"
            "- 每个编号下面先写短标题，再写成段落；不要只列项目符号。\n"
            "- 对图表要说明图表展示什么、怎么看、支持哪个结论。\n"
            "- 对公式或指标要使用 LaTeX 独立公式块（使用 $$ 包裹），并说明符号含义、计算逻辑和它回答的问题。\n"
            "- 除标题、PART标题、编号和引用格式外，正文主体使用完整段落，避免生成生硬提纲。\n"
            "- 不得输出方括号占位、模板说明或示例解释；不能把示例说明写进正文。\n"
            "- 不要单独输出“导语”二字，导语直接写段落。\n"
            "- 每个 PART 标题、图片占位和分节标题都必须单独成行。\n"
            "- 缺失信息写“材料中未明确说明”。\n\n"
            f"【写作策划】\n{angle}\n\n【原始材料】\n{self._source_text(source_bundle)}"
        )

    def _final_prompt(self, draft: str) -> str:
        return (
            "润色为可发布的中文公众号终稿 Markdown，删除提示词痕迹、JSON 残留和空泛套话。\n"
            "保留【研读非洲｜第X期】标题、图片占位、PART01-PART04、引用格式和固定栏目结语；"
            "不得新增材料外事实、作者机构、数字、案例或判断。\n"
            "删除方括号占位、删除“请根据实际填入”、删除“例如/这里开始写成段落”等模板说明，"
            "不要输出未完成模板；如果信息不足，只能写“材料中未明确说明”。\n"
            "保留并强化材料内已有的研究范式、图表说明、公式解释、变量构造和关键数据。"
            "保留 LaTeX 公式块（$$...$$）和公式后的中文解释，不要改成一串普通文字。\n\n"
            f"{draft}"
        )

    def _source_text(self, source_bundle: dict) -> str:
        parts = []
        source_text = str(source_bundle.get("source_text", "")).strip()
        if source_text:
            parts.append(f"【手动输入】\n{source_text}")
        for item in source_bundle.get("evidence_chain", []):
            if not isinstance(item, dict):
                continue
            content = str(item.get("content", "")).strip()
            if not content:
                continue
            artifact = str(item.get("artifact", "evidence"))
            parts.append(f"【{artifact}】\n{content}")
        for item in source_bundle.get("uploaded_materials", []):
            if not isinstance(item, dict):
                continue
            filename = str(item.get("filename", "uploaded material"))
            content = str(item.get("content", "")).strip()
            if content:
                parts.append(f"【上传文件：{filename}】\n{content}")
            else:
                media_type = str(item.get("media_type", "application/octet-stream"))
                size_bytes = item.get("size_bytes", 0)
                parts.append(f"【上传文件：{filename}】\n文件已保存，类型：{media_type}，大小：{size_bytes} bytes。")
        return "\n\n".join(parts)
