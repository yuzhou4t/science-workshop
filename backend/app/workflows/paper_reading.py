import json
from pathlib import Path

from app.models.job import Artifact, JobStatus, NodeStatus, WorkflowJob
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


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
        self.store.set_node_status(job, "document_extraction", NodeStatus.RUNNING)
        await self.events.publish(job.job_id, "progress", "document_extraction", "MinerU 正在提取 PDF", 10, {})
        try:
            result = await self.mineru.parse_pdf_to_markdown(pdf_path)
            self.store.write_text_artifact(job, "extraction/extracted.md", result.markdown)
            self.store.set_node_status(job, "document_extraction", NodeStatus.COMPLETED, ["extracted.md"])
            await self.events.publish(job.job_id, "progress", "document_extraction", "MinerU 提取完成", 25, {})
            return result
        except Exception as exc:
            self.store.set_node_status(job, "document_extraction", NodeStatus.FAILED, error=str(exc))
            raise

    async def _llm_node(self, job: WorkflowJob, node_id: str, prompt: str) -> str:
        self.store.set_node_status(job, node_id, NodeStatus.RUNNING)
        await self.events.publish(job.job_id, "progress", node_id, f"{node_id} 正在生成", 40, {})
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
        self.store.set_node_status(job, "draft", NodeStatus.RUNNING)
        try:
            prompt = f"整合以下材料，写成研读非洲公众号精读初稿。\n\n{basic}\n\n{method}\n\n{formula}"
            draft = await self.deepseek.generate("draft", prompt)
            self.store.write_text_artifact(job, "nodes/draft.md", draft)
            self.store.set_node_status(job, "draft", NodeStatus.COMPLETED, ["draft.md"])
            return draft
        except Exception as exc:
            self.store.set_node_status(job, "draft", NodeStatus.FAILED, error=str(exc))
            raise

    async def _finalize(self, job: WorkflowJob, draft: str) -> str:
        self.store.set_node_status(job, "final", NodeStatus.RUNNING)
        try:
            prompt = f"清理提示词残留、JSON 残留和附录残留，输出公众号终稿 Markdown。\n\n{draft}"
            final = await self.deepseek.generate("final", prompt)
            self.store.write_text_artifact(job, "nodes/final.md", final)
            self.store.set_node_status(job, "final", NodeStatus.COMPLETED, ["final.md"])
            return final
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

    def _basic_prompt(self, markdown: str) -> str:
        return f"抽取题目、作者、期刊、年份、摘要、研究问题、核心结论。\n\n{markdown}"

    def _method_prompt(self, markdown: str) -> str:
        return f"抽取数据来源、样本范围、研究方法、识别策略、图表含义、关键数字。\n\n{markdown}"

    def _formula_prompt(self, markdown: str) -> str:
        return f"抽取公式、指标定义、变量构造、统计模型和计算逻辑。\n\n{markdown}"
