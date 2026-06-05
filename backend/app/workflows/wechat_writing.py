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
        return f"基于以下论文精读材料，提炼公众号写作角度、标题方向和读者收益。\n\n{self._source_text(source_bundle)}"

    def _draft_prompt(self, source_bundle: dict, angle: str) -> str:
        return f"根据写作角度和原始材料，写一版中文公众号论文精读初稿。\n\n{angle}\n\n{self._source_text(source_bundle)}"

    def _final_prompt(self, draft: str) -> str:
        return f"润色为可发布的中文公众号终稿 Markdown，保留学术依据并删除提示词痕迹。\n\n{draft}"

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
        return "\n\n".join(parts)
