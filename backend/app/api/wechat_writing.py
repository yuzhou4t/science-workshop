import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.models.job import Artifact, WorkflowType
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
UPLOAD_CHUNK_SIZE = 1024 * 1024
PDF_MEDIA_TYPE = "application/pdf"


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


def _is_pdf_material(path: Path, media_type: str) -> bool:
    return media_type == PDF_MEDIA_TYPE or path.suffix.lower() == ".pdf"


def _decode_text_chunks(chunks: list[bytes]) -> str:
    if not chunks:
        return ""
    try:
        return b"".join(chunks).decode("utf-8-sig")
    except UnicodeDecodeError:
        return ""


def _extract_pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        logger.warning("pypdf is not installed; cannot extract uploaded WeChat PDF material")
        return ""

    try:
        reader = PdfReader(str(path))
        parts = []
        for page_index, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                parts.append(f"## 第 {page_index} 页\n\n{text}")
        return "\n\n".join(parts).strip()
    except Exception as exc:
        logger.warning("Failed to extract uploaded WeChat PDF material %s: %s", path, exc)
        return ""


def _extract_stored_material_content(path: Path, media_type: str, chunks: list[bytes]) -> str:
    text_content = _decode_text_chunks(chunks)
    if text_content:
        return text_content
    if _is_pdf_material(path, media_type):
        return _extract_pdf_text(path)
    return ""


def _safe_material_filename(filename: str, fallback: str) -> str:
    safe_name = Path(filename.replace("\\", "/")).name.strip()
    safe_name = safe_name.replace("\r", "").replace("\n", "").replace('"', "")
    return safe_name or fallback


def _unique_material_filename(upload_dir: Path, filename: str) -> str:
    candidate = filename
    stem = Path(filename).stem or "material"
    suffix = Path(filename).suffix
    counter = 2
    while (upload_dir / candidate).exists():
        candidate = f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


async def _write_uploaded_materials(
    store,
    job,
    materials: list[UploadFile],
    max_bytes: int,
) -> list[dict[str, Any]]:
    upload_dir = store.job_dir(job.job_id) / "input" / "materials"
    upload_dir.mkdir(parents=True, exist_ok=True)
    uploaded: list[dict[str, Any]] = []

    for index, material in enumerate(materials, start=1):
        if not material.filename:
            continue
        media_type = material.content_type or "application/octet-stream"
        filename = _unique_material_filename(
            upload_dir,
            _safe_material_filename(material.filename, f"material-{index}"),
        )
        path = upload_dir / filename
        bytes_written = 0
        chunks: list[bytes] = []
        with path.open("wb") as output:
            while chunk := await material.read(UPLOAD_CHUNK_SIZE):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Uploaded material is too large")
                output.write(chunk)
                if _is_text_media_type(media_type):
                    chunks.append(chunk)

        text_content = _extract_stored_material_content(path, media_type, chunks)

        relative_path = f"input/materials/{filename}"
        job.artifacts[filename] = Artifact(name=filename, relative_path=relative_path, media_type=media_type)
        uploaded.append(
            {
                "filename": filename,
                "relative_path": relative_path,
                "media_type": media_type,
                "size_bytes": bytes_written,
                "content": text_content,
            }
        )

    store.save_job(job)
    return uploaded


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
    materials: list[UploadFile] | None = File(None),
) -> dict:
    settings = request.app.state.settings
    store = request.app.state.job_store
    evidence_chain = []
    if paper_reading_job_id:
        evidence_chain = _collect_paper_reading_evidence(store, paper_reading_job_id)
    incoming_materials = [material for material in materials or [] if material.filename]
    if not source_text.strip() and not evidence_chain and not incoming_materials:
        raise HTTPException(status_code=400, detail="source_text, paper_reading_job_id with evidence, or uploaded materials are required")

    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id=template_id)
    uploaded_materials = await _write_uploaded_materials(
        store,
        job,
        incoming_materials,
        settings.paper_reading_max_upload_bytes,
    )
    source_bundle = {
        "source_text": source_text,
        "article_id": article_id,
        "paper_reading_job_id": paper_reading_job_id,
        "template_id": template_id,
        "evidence_chain": evidence_chain,
        "uploaded_materials": uploaded_materials,
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
