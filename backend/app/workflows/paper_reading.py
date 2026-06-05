import json
from pathlib import Path

from app.models.job import Artifact, JobStatus, NodeStatus, WorkflowJob
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


PUBLIC_ACCOUNT_READING_STRUCTURE = (
    "参考输出结构必须贴近“研读非洲”式公众号精读稿：\n"
    "- 标题：研读非洲｜第 X 期】论文核心议题。\n"
    "- 导语：先交代现实问题、研究价值和本文回答的问题，不要写成摘要复述。\n"
    "- PART01 研究背景：解释问题从哪里来、既有研究缺口是什么。\n"
    "- PART02 核心发现：写 3-5 个主要结论；每个发现用 01、02 等编号，必要时用 ◆ 列关键证据。\n"
    "- PART03 进一步讨论：只讨论论文材料支持的政策含义、理论启发、局限和后续方向。\n"
    "- PART04 研究框架与方法：讲清研究范式、数据链路、识别/模拟/建模逻辑、图表逐图解读和公式指标。\n"
    "- PART05 核心数据：列出数据来源、样本范围、变量/指标和关键数字。\n"
    "- 引用格式：按材料提供的信息整理；缺失就标注材料中未明确说明。\n"
    "- 结语：用克制语言总结本文价值，不添加材料外栏目宣传。\n"
)


class PaperReadingWorkflow:
    def __init__(
        self,
        store: JobStore,
        events: EventBroker,
        mineru: MineruClient,
        deepseek: DeepSeekClient,
        docx_exporter: DocxExporter,
    ) -> None:
        self.store = store
        self.events = events
        self.mineru = mineru
        self.deepseek = deepseek
        self.docx_exporter = docx_exporter

    async def run(self, job_id: str, pdf_path: Path) -> WorkflowJob:
        job = self.store.load_job(job_id)
        job.status = JobStatus.RUNNING
        self.store.save_job(job)

        try:
            result = await self._extract(job, pdf_path)
            basic = await self._llm_node(job, "basic_info", self._basic_prompt(result.markdown))
            method = await self._llm_node(job, "method_data_figures", self._method_prompt(result.markdown))
            formula = await self._llm_node(job, "formula_metrics", self._formula_prompt(result.markdown))
            draft = await self._draft(job, basic, method, formula)
            final = await self._finalize(job, draft)
            self._export_docx(job, final)
            job.status = JobStatus.COMPLETED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "completed", "workflow", "论文精读完成", 100, {})
            return job
        except Exception as exc:
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "failed", "workflow", str(exc), 100, {})
            raise

    async def _extract(self, job: WorkflowJob, pdf_path: Path):
        self.store.set_node_status(
            job,
            "document_extraction",
            NodeStatus.RUNNING,
            message="MinerU 正在提取 PDF",
            progress=10,
        )
        await self.events.publish(job.job_id, "progress", "document_extraction", "MinerU 正在提取 PDF", 10, {})
        try:
            async def publish_progress(node_id: str, progress: float, message: str, data: dict) -> None:
                self.store.set_node_progress(job, node_id, message, progress, data)
                await self.events.publish(job.job_id, "progress", node_id, message, progress, data)

            result = await self.mineru.parse_pdf_to_markdown(pdf_path, progress_callback=publish_progress)
            self.store.write_text_artifact(job, "extraction/extracted.md", result.markdown)
            self.store.set_node_status(
                job,
                "document_extraction",
                NodeStatus.COMPLETED,
                ["extracted.md"],
                message="MinerU 提取完成",
                progress=25,
            )
            await self.events.publish(job.job_id, "progress", "document_extraction", "MinerU 提取完成", 25, {})
            return result
        except Exception as exc:
            self.store.set_node_status(job, "document_extraction", NodeStatus.FAILED, error=str(exc))
            raise

    async def _llm_node(self, job: WorkflowJob, node_id: str, prompt: str) -> str:
        message = f"{node_id} 正在生成"
        self.store.set_node_status(job, node_id, NodeStatus.RUNNING, message=message, progress=40)
        await self.events.publish(job.job_id, "progress", node_id, message, 40, {})
        try:
            content = await self.deepseek.generate(node_id, prompt)
            self.store.write_text_artifact(job, f"nodes/{node_id}.md", content)
            structured = json.dumps({"node_id": node_id, "markdown": content}, ensure_ascii=False, indent=2)
            self.store.write_text_artifact(job, f"nodes/{node_id}.json", structured, media_type="application/json")
            self.store.set_node_status(job, node_id, NodeStatus.COMPLETED, [f"{node_id}.md", f"{node_id}.json"])
            return content
        except Exception as exc:
            self.store.set_node_status(job, node_id, NodeStatus.FAILED, error=str(exc))
            raise

    async def _draft(self, job: WorkflowJob, basic: str, method: str, formula: str) -> str:
        self.store.set_node_status(job, "draft", NodeStatus.RUNNING, message="公众号精读初稿正在生成", progress=75)
        try:
            prompt = (
                "你正在写“研读非洲”式论文精读公众号初稿。目标不是普通归纳总结，而是帮助读者真正理解"
                "这篇论文在回答什么问题、采用什么研究范式、图表与公式如何支撑结论。\n"
                "必须严格依据下方三份上游证据材料，不得引入材料外事实、机构归属、作者身份、夸张评价、"
                "延伸讨论或案例。\n"
                "硬性规则：\n"
                "1. 每个核心数字、结论、方法和图表解释都必须能在材料中找到对应依据。\n"
                "2. 不要写“颠覆认知”“手术刀”“悲情叙事”等材料外修辞。\n"
                "3. 如果材料未明确说明某项信息，写“材料中未明确说明”，不要补全。\n"
                "4. 核心发现不要只写结论，要解释证据链：数据/图表/公式如何推出这个结论。\n"
                "5. 研究框架与方法部分必须讲清研究范式、为什么适合本文问题、范式局限、图表逐图解读、"
                "公式符号和计算逻辑。\n"
                "6. 涉及公式时，必须保留或改写为 LaTeX 独立公式块（使用 $$ 包裹），不要把公式写成普通文字；"
                "每个公式后面紧跟中文解释，逐一说明符号含义和这个公式回答的问题。\n"
                "7. 输出中文 Markdown，严格使用下方结构。\n\n"
                f"{PUBLIC_ACCOUNT_READING_STRUCTURE}\n"
                f"【基础信息抽取】\n{basic}\n\n【方法数据与图表抽取】\n{method}\n\n【公式指标抽取】\n{formula}"
            )
            draft = await self.deepseek.generate("draft", prompt)
            self.store.write_text_artifact(job, "nodes/draft.md", draft)
            self.store.set_node_status(job, "draft", NodeStatus.COMPLETED, ["draft.md"])
            return draft
        except Exception as exc:
            self.store.set_node_status(job, "draft", NodeStatus.FAILED, error=str(exc))
            raise

    async def _finalize(self, job: WorkflowJob, draft: str) -> str:
        self.store.set_node_status(job, "final", NodeStatus.RUNNING, message="终稿正在校准", progress=90)
        try:
            prompt = (
                "清理提示词残留、JSON 残留和附录残留，输出公众号终稿 Markdown。\n"
                "保留 PART01-PART05、引用格式和结语，不要把文章改回普通摘要。\n"
                "只允许在不改变事实含义的前提下润色；不得新增草稿中没有的作者机构、数字、案例、判断或延伸问题。"
                "删除材料外修辞和无法由草稿证据支持的泛化表达。保留研究范式、图表逐图解读、公式解释和关键数字。"
                "保留 LaTeX 公式块（$$...$$）和公式后的中文解释，不要改成一串普通文字。\n\n"
                f"{draft}"
            )
            final = await self.deepseek.generate("final", prompt)
            self.store.write_text_artifact(job, "nodes/final.md", final)
            self.store.set_node_status(job, "final", NodeStatus.COMPLETED, ["final.md"])
            return final
        except Exception as exc:
            self.store.set_node_status(job, "final", NodeStatus.FAILED, error=str(exc))
            raise

    def _export_docx(self, job: WorkflowJob, final_markdown: str) -> None:
        self.store.set_node_status(job, "docx_export", NodeStatus.RUNNING, message="Word 正在导出", progress=98)
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

    def _basic_prompt(self, markdown: str) -> str:
        return (
            "请仅依据下方论文正文抽取基础信息，输出中文 Markdown，不要补写正文没有的信息。\n"
            "请覆盖：\n"
            "1. 文献信息：题目、作者、期刊、年份、DOI 或引用信息（如有）。\n"
            "2. 摘要与研究问题：论文想解释什么现象，核心问题是什么。\n"
            "3. 论文主线：用 3-5 句话说明作者如何从问题走到结论。\n"
            "4. 研究贡献：相对既有研究新在哪里，必须区分论文明确贡献与可推断价值。\n"
            "5. 核心结论：列出有证据支撑的主要发现和关键数字。\n"
            "6. 读者要先理解什么：列出理解本文前需要先知道的概念、背景或变量。\n"
            "如果材料缺失某项，请写“材料中未明确说明”。\n\n"
            f"{markdown}"
        )

    def _method_prompt(self, markdown: str) -> str:
        return (
            "请仅依据下方论文正文抽取方法、数据和图表证据，输出中文 Markdown。\n"
            "请覆盖：\n"
            "1. 数据来源：数据集名称、来源机构、时间范围、样本范围、空间/行业/国家覆盖。\n"
            "2. 研究范式识别：判断本文主要属于哪类范式，例如计量识别、反事实模拟、空间分析、"
            "资源核算、网络拓扑、机器学习分类、主成分分析或统计建模；如果是组合范式，请分层说明。\n"
            "3. 为什么这个范式适合本文问题：说明研究问题、数据结构和方法选择之间的关系。\n"
            "4. 识别策略/模型逻辑：说明因果识别、模拟设定、分类标准或估计流程，不能只列方法名。\n"
            "5. 范式的局限：写出论文材料中说明的限制；材料没有说明时，标注“材料中未明确说明”。\n"
            "6. 图表逐图解读：逐张图表记录图号、变量、读图方法、关键数字/关系、支持的结论，"
            "并说明每张图表如何服务论文主论点。\n"
            "7. 可进入公众号正文的关键数字：只列材料内出现的数字。\n\n"
            f"{markdown}"
        )

    def _formula_prompt(self, markdown: str) -> str:
        return (
            "请仅依据下方论文正文抽取公式、指标定义、变量构造、统计模型和计算逻辑，输出中文 Markdown。\n"
            "对每个公式或核心指标，请建立清晰条目，覆盖：\n"
            "1. 公式原文或指标名称。\n"
            "2. 公式必须用 LaTeX 写成独立公式块，例如：\n"
            "$$\n"
            "A_B \\approx \\frac{k^2}{n_b}\n"
            "$$\n"
            "不要把公式写成一串普通文字，也不要只写口头描述。\n"
            "3. 每个符号的含义、单位、取值范围或角色。\n"
            "4. 变量构造与数据来源：变量如何从原始数据转换而来。\n"
            "5. 计算步骤：按先后顺序讲清怎么从输入得到结果。\n"
            "6. 白话解释：不用术语堆砌，说明这个公式回答什么问题。\n"
            "7. 统计关系或模型含义：例如回归、PC1、最短路径、网络指标、情景模拟等如何支撑结论。\n"
            "8. 假设与局限：公式成立依赖什么条件，材料没有说明时写“材料中未明确说明”。\n"
            "如果论文没有显式公式，也要解释核心操作性定义、指标口径和经验逻辑。\n\n"
            f"{markdown}"
        )
