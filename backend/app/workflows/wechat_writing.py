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
    "请贴近参考公众号精读稿的组织方式：\n"
    "- 标题：聚焦论文问题或材料主题，可以采用“研读非洲｜第 X 期】主题”式标题；没有期数就不要编造具体期数。\n"
    "- 导语：先写现实问题、研究价值、本文回答的问题，避免写成摘要堆叠。\n"
    "- PART01 研究背景：解释问题背景和材料中的研究缺口。\n"
    "- PART02 核心发现：写 3-5 个主要结论，可用“4个主要结论”这类小标题；每个发现用 01、02 编号，"
    "并用 ◆ 列关键证据、数据、图表或公式。\n"
    "- PART03 进一步讨论：只基于材料讨论启发、局限和后续方向。\n"
    "- PART04 研究框架与方法：讲清研究范式、方法逻辑、图表含义、公式指标和变量构造。\n"
    "- PART05 核心数据：列数据来源、样本范围、变量口径、关键数字和可访问链接（如材料提供）。\n"
    "- 引用格式：按材料整理；缺失就写材料中未明确说明。\n"
    "- 结语：克制收束，不新增栏目宣传、机构背书或材料外评价。\n"
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
            "4. PART结构：按 PART01-PART05 规划每部分写什么。\n"
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
            "- PART02 核心发现中写 3-5 个发现；如果材料适合，可使用“4个主要结论”小标题，但不要硬凑。\n"
            "- 使用 ◆ 承载关键证据，不要让段落变成无证据的口号。\n"
            "- 对图表要说明图表展示什么、怎么看、支持哪个结论。\n"
            "- 对公式或指标要说明符号含义、计算逻辑和它回答的问题。\n"
            "- 缺失信息写“材料中未明确说明”。\n\n"
            f"【写作策划】\n{angle}\n\n【原始材料】\n{self._source_text(source_bundle)}"
        )

    def _final_prompt(self, draft: str) -> str:
        return (
            "润色为可发布的中文公众号终稿 Markdown，删除提示词痕迹、JSON 残留和空泛套话。\n"
            "保留 PART01-PART05、引用格式和结语；不得新增材料外事实、作者机构、数字、案例或判断。\n"
            "保留并强化材料内已有的研究范式、图表说明、公式解释、变量构造和关键数据。\n\n"
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
