import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Form, HTTPException, Request

from app.models.job import WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobNotFoundError
from app.workflows.wechat_writing import WeChatWritingWorkflow

router = APIRouter(prefix="/api/workflows/wechat-writing", tags=["wechat-writing"])

logger = logging.getLogger(__name__)

SAFE_EVIDENCE_ARTIFACTS = (
    ("final.md", "nodes/final.md"),
    ("draft.md", "nodes/draft.md"),
    ("basic_info.md", "nodes/basic_info.md"),
    ("method_data_figures.md", "nodes/method_data_figures.md"),
    ("formula_metrics.md", "nodes/formula_metrics.md"),
    ("extracted.md", "extraction/extracted.md"),
)


def _log_background_workflow_result(task: asyncio.Task, job_id: str) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        logger.warning("WeChat writing workflow task cancelled for job %s", job_id)
    except Exception:
        logger.exception("WeChat writing workflow task failed for job %s", job_id)


def _background_workflow_callback(job_id: str):
    def callback(task: asyncio.Task) -> None:
        _log_background_workflow_result(task, job_id)

    return callback


def _is_text_media_type(media_type: str) -> bool:
    return media_type.startswith("text/") or media_type == "application/json"


def _read_referenced_text_artifact(store, referenced_job, artifact_name: str, fallback_relative_path: str) -> dict | None:
    artifact = referenced_job.artifacts.get(artifact_name)
    relative_path = fallback_relative_path
    if artifact is not None:
        if not _is_text_media_type(artifact.media_type):
            return None
        relative_path = artifact.relative_path
        try:
            data, _artifact = store.read_artifact_bytes(referenced_job.job_id, artifact_name)
            content = data.decode("utf-8")
        except (JobNotFoundError, OSError, UnicodeDecodeError):
            return None
    else:
        path = store.job_dir(referenced_job.job_id) / fallback_relative_path
        if not path.exists():
            return None
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None
    if not content.strip():
        return None
    return {"artifact": artifact_name, "relative_path": relative_path, "content": content}


def _collect_paper_reading_evidence(store, paper_reading_job_id: str) -> list[dict[str, Any]]:
    try:
        referenced_job = store.load_job(paper_reading_job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Referenced paper-reading job not found") from exc
    if referenced_job.workflow_type != WorkflowType.PAPER_READING:
        raise HTTPException(status_code=404, detail="Referenced paper-reading job not found")

    evidence: list[dict[str, Any]] = []
    for artifact_name, fallback_relative_path in SAFE_EVIDENCE_ARTIFACTS:
        item = _read_referenced_text_artifact(store, referenced_job, artifact_name, fallback_relative_path)
        if item is not None:
            evidence.append(item)
    return evidence


@router.post("/jobs")
async def create_wechat_writing_job(
    request: Request,
    source_text: str = Form(""),
    article_id: str = Form(""),
    paper_reading_job_id: str = Form(""),
    template_id: str = Form("africa-reading"),
) -> dict:
    settings = request.app.state.settings
    store = request.app.state.job_store
    evidence_chain = []
    if paper_reading_job_id:
        evidence_chain = _collect_paper_reading_evidence(store, paper_reading_job_id)
    if not source_text.strip() and not evidence_chain:
        raise HTTPException(status_code=400, detail="source_text or paper_reading_job_id with evidence is required")

    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id=template_id)
    source_bundle = {
        "source_text": source_text,
        "article_id": article_id,
        "paper_reading_job_id": paper_reading_job_id,
        "template_id": template_id,
        "evidence_chain": evidence_chain,
    }
    store.write_text_artifact(
        job,
        "input/source_bundle.json",
        json.dumps(source_bundle, ensure_ascii=False, indent=2),
        media_type="application/json",
    )

    workflow = WeChatWritingWorkflow(
        store=store,
        events=request.app.state.event_broker,
        deepseek=DeepSeekClient(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            use_mock=settings.workflow_use_mocks,
        ),
        docx_exporter=DocxExporter(),
    )
    if settings.workflow_use_mocks:
        await workflow.run(job.job_id)
    else:
        task = asyncio.create_task(workflow.run(job.job_id))
        task.add_done_callback(_background_workflow_callback(job.job_id))
    return store.load_job(job.job_id).model_dump(mode="json")
