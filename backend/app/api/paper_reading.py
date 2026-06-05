import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.models.job import Artifact, WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient
from app.workflows.paper_reading import PaperReadingWorkflow

router = APIRouter(prefix="/api/workflows/paper-reading", tags=["paper-reading"])

PDF_MEDIA_TYPE = "application/pdf"
PDF_SIGNATURE = b"%PDF-"
UPLOAD_CHUNK_SIZE = 1024 * 1024

logger = logging.getLogger(__name__)


def _validate_pdf_metadata(file: UploadFile) -> None:
    filename = file.filename or ""
    if Path(filename).suffix.lower() != ".pdf" or file.content_type != PDF_MEDIA_TYPE:
        raise HTTPException(status_code=400, detail="PDF upload required")


async def _write_limited_pdf_upload(file: UploadFile, storage_dir: Path, max_bytes: int) -> Path:
    _validate_pdf_metadata(file)
    upload_dir = storage_dir / "_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="paper-reading-", suffix=".pdf", dir=upload_dir)
    temp_path = Path(temp_name)
    bytes_written = 0
    header = b""

    try:
        with os.fdopen(fd, "wb") as output:
            while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                if len(header) < len(PDF_SIGNATURE):
                    needed = len(PDF_SIGNATURE) - len(header)
                    header += chunk[:needed]
                    if len(header) == len(PDF_SIGNATURE) and header != PDF_SIGNATURE:
                        raise HTTPException(status_code=400, detail="PDF upload required")
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise HTTPException(status_code=413, detail="PDF upload is too large")
                output.write(chunk)
        if header != PDF_SIGNATURE:
            raise HTTPException(status_code=400, detail="PDF upload required")
        return temp_path
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _log_background_workflow_result(task: asyncio.Task, job_id: str) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        logger.warning("Paper reading workflow task cancelled for job %s", job_id)
    except Exception:
        logger.exception("Paper reading workflow task failed for job %s", job_id)


def _background_workflow_callback(job_id: str):
    def callback(task: asyncio.Task) -> None:
        _log_background_workflow_result(task, job_id)

    return callback


@router.post("/jobs")
async def create_paper_reading_job(
    request: Request,
    file: UploadFile = File(...),
    template_id: str = Form("africa-reading"),
) -> dict:
    settings = request.app.state.settings
    store = request.app.state.job_store
    temp_pdf_path = await _write_limited_pdf_upload(
        file,
        settings.workflow_storage_dir,
        settings.paper_reading_max_upload_bytes,
    )
    job = store.create_job(WorkflowType.PAPER_READING, template_id=template_id)
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    try:
        shutil.move(str(temp_pdf_path), pdf_path)
    finally:
        temp_pdf_path.unlink(missing_ok=True)
    job.artifacts["input.pdf"] = Artifact(
        name="input.pdf",
        relative_path="input/input.pdf",
        media_type=PDF_MEDIA_TYPE,
    )
    store.save_job(job)

    workflow = PaperReadingWorkflow(
        store=store,
        events=request.app.state.event_broker,
        mineru=MineruClient(
            api_key=settings.mineru_api_key,
            base_url=settings.mineru_base_url,
            use_mock=settings.workflow_use_mocks,
            cos_secret_id=settings.tencent_cos_secret_id,
            cos_secret_key=settings.tencent_cos_secret_key,
            cos_region=settings.tencent_cos_region,
            cos_bucket=settings.tencent_cos_bucket,
        ),
        deepseek=DeepSeekClient(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            use_mock=settings.workflow_use_mocks,
        ),
        docx_exporter=DocxExporter(),
    )
    if settings.workflow_use_mocks:
        await workflow.run(job.job_id, Path(pdf_path))
    else:
        task = asyncio.create_task(workflow.run(job.job_id, Path(pdf_path)))
        task.add_done_callback(_background_workflow_callback(job.job_id))
    return store.load_job(job.job_id).model_dump(mode="json")
