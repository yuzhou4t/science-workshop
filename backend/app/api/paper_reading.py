import asyncio
import json
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator

from app.core.access import owner_id_from_request, require_owner_access
from app.models.job import Artifact, WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient
from app.workflows.paper_reading import PaperReadingWorkflow
from app.workflows.scheduler import WorkflowLimitError

router = APIRouter(prefix="/api/workflows/paper-reading", tags=["paper-reading"])

PDF_MEDIA_TYPE = "application/pdf"
PDF_SIGNATURE = b"%PDF-"
UPLOAD_CHUNK_SIZE = 1024 * 1024
PAPER_FILE_CHUNK_MAX_BYTES = 2 * 1024 * 1024
COS_SIGNED_URL_EXPIRES_SECONDS = 600


class PaperFileUploadInitRequest(BaseModel):
    filename: str
    media_type: str = PDF_MEDIA_TYPE
    size_bytes: int = Field(gt=0)
    total_chunks: int = Field(gt=0, le=256)

    @field_validator("filename")
    @classmethod
    def filename_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("filename is required")
        return value


class PaperCosUploadInitRequest(BaseModel):
    filename: str
    media_type: str = PDF_MEDIA_TYPE
    size_bytes: int = Field(gt=0)

    @field_validator("filename")
    @classmethod
    def filename_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("filename is required")
        return value


def _validate_pdf_metadata_values(filename: str, media_type: str) -> None:
    if Path(filename).suffix.lower() != ".pdf" or media_type != PDF_MEDIA_TYPE:
        raise HTTPException(status_code=400, detail="PDF upload required")


def _validate_pdf_metadata(file: UploadFile) -> None:
    _validate_pdf_metadata_values(file.filename or "", file.content_type or "")


def _validate_cos_object_key(object_key: str) -> str:
    object_key = object_key.strip()
    path = PurePosixPath(object_key)
    if (
        not object_key
        or len(object_key) > 1024
        or object_key.startswith("/")
        or "\\" in object_key
        or path.is_absolute()
        or ".." in path.parts
        or path.suffix.lower() != ".pdf"
    ):
        raise HTTPException(status_code=400, detail="Valid COS PDF object key required")
    return object_key


def _cos_object_key_from_reference(reference: str, settings) -> str:
    value = reference.strip()
    if "://" not in value:
        return _validate_cos_object_key(value)

    parsed = urlparse(value)
    expected_host = f"{settings.tencent_cos_bucket}.cos.{settings.tencent_cos_region}.myqcloud.com"
    if parsed.scheme != "https" or parsed.netloc != expected_host:
        raise HTTPException(status_code=400, detail="COS URL must belong to the configured bucket")
    return _validate_cos_object_key(unquote(parsed.path.lstrip("/")))


def _new_paper_cos_object_key() -> str:
    return f"paper-reading/{uuid4().hex}.pdf"


def _upload_root(request: Request) -> Path:
    return request.app.state.settings.workflow_storage_dir.resolve() / "_uploads" / "paper-reading"


def _safe_upload_id(upload_id: str) -> str:
    if len(upload_id) != 32 or any(char not in "0123456789abcdef" for char in upload_id):
        raise HTTPException(status_code=404, detail="PDF upload not found")
    return upload_id


def _upload_dir(request: Request, upload_id: str) -> Path:
    upload_id = _safe_upload_id(upload_id)
    root = _upload_root(request)
    path = (root / upload_id).resolve()
    if path.parent != root:
        raise HTTPException(status_code=404, detail="PDF upload not found")
    return path


def _read_upload_metadata(upload_dir: Path) -> dict:
    metadata_path = upload_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="PDF upload not found")
    try:
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="PDF upload metadata is invalid") from exc


async def _cos_signed_get_url(settings, object_key: str) -> str:
    if not all([settings.tencent_cos_secret_id, settings.tencent_cos_secret_key, settings.tencent_cos_bucket]):
        raise HTTPException(status_code=400, detail="Tencent COS settings are required")

    def sign_sync() -> str:
        from qcloud_cos import CosConfig, CosS3Client

        client = CosS3Client(
            CosConfig(
                Region=settings.tencent_cos_region,
                SecretId=settings.tencent_cos_secret_id,
                SecretKey=settings.tencent_cos_secret_key,
                Token=None,
                Scheme="https",
            )
        )
        return client.get_presigned_url(
            Method="GET",
            Bucket=settings.tencent_cos_bucket,
            Key=object_key,
            Expired=COS_SIGNED_URL_EXPIRES_SECONDS,
        )

    return await asyncio.get_running_loop().run_in_executor(None, sign_sync)


async def _cos_signed_put_url(settings, object_key: str) -> str:
    if not all([settings.tencent_cos_secret_id, settings.tencent_cos_secret_key, settings.tencent_cos_bucket]):
        raise HTTPException(status_code=400, detail="Tencent COS settings are required")

    def sign_sync() -> str:
        from qcloud_cos import CosConfig, CosS3Client

        client = CosS3Client(
            CosConfig(
                Region=settings.tencent_cos_region,
                SecretId=settings.tencent_cos_secret_id,
                SecretKey=settings.tencent_cos_secret_key,
                Token=None,
                Scheme="https",
            )
        )
        return client.get_presigned_url(
            Method="PUT",
            Bucket=settings.tencent_cos_bucket,
            Key=object_key,
            Expired=COS_SIGNED_URL_EXPIRES_SECONDS,
        )

    return await asyncio.get_running_loop().run_in_executor(None, sign_sync)


async def _download_pdf_url_to_temp(url: str, storage_dir: Path, max_bytes: int) -> Path:
    upload_dir = storage_dir / "_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="paper-reading-cos-", suffix=".pdf", dir=upload_dir)
    os.close(fd)
    temp_path = Path(temp_name)
    bytes_written = 0
    header = b""

    try:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                if response.status_code == 404:
                    raise HTTPException(status_code=404, detail="COS PDF not found")
                if response.status_code >= 400:
                    raise HTTPException(status_code=502, detail="COS PDF download failed")
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > max_bytes:
                            raise HTTPException(status_code=413, detail="PDF upload is too large")
                    except ValueError:
                        pass

                with temp_path.open("wb") as output:
                    async for chunk in response.aiter_bytes(UPLOAD_CHUNK_SIZE):
                        if not chunk:
                            continue
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


async def _copy_cos_pdf_to_temp(request: Request, cos_object_key: str, storage_dir: Path, max_bytes: int) -> Path:
    settings = request.app.state.settings
    object_key = _cos_object_key_from_reference(cos_object_key, settings)
    signed_url = await _cos_signed_get_url(settings, object_key)
    return await _download_pdf_url_to_temp(signed_url, storage_dir, max_bytes)


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


def _consume_chunked_pdf_upload(request: Request, upload_id: str, storage_dir: Path, max_bytes: int) -> Path:
    source_dir = _upload_dir(request, upload_id)
    metadata = _read_upload_metadata(source_dir)
    require_owner_access(str(metadata.get("owner_id") or "anonymous"), request)
    _validate_pdf_metadata_values(
        str(metadata.get("filename") or ""),
        str(metadata.get("media_type") or ""),
    )
    if int(metadata.get("size_bytes") or 0) > max_bytes:
        raise HTTPException(status_code=413, detail="PDF upload is too large")
    total_chunks = int(metadata.get("total_chunks") or 0)
    chunk_dir = source_dir / "chunks"
    chunk_paths = [chunk_dir / f"{chunk_index}.part" for chunk_index in range(total_chunks)]
    missing = [str(chunk_index) for chunk_index, chunk_path in enumerate(chunk_paths) if not chunk_path.exists()]
    if missing:
        raise HTTPException(status_code=400, detail=f"PDF upload is incomplete: {upload_id}")

    upload_dir = storage_dir / "_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="paper-reading-", suffix=".pdf", dir=upload_dir)
    temp_path = Path(temp_name)
    bytes_written = 0
    header = b""
    try:
        with os.fdopen(fd, "wb") as output:
            for chunk_path in chunk_paths:
                chunk = chunk_path.read_bytes()
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
        shutil.rmtree(source_dir, ignore_errors=True)
        return temp_path
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _raise_workflow_limit(exc: WorkflowLimitError) -> None:
    raise HTTPException(status_code=429, detail=exc.detail) from exc


@router.post("/file-uploads")
def create_file_upload(payload: PaperFileUploadInitRequest, request: Request) -> dict:
    settings = request.app.state.settings
    _validate_pdf_metadata_values(payload.filename, payload.media_type)
    if payload.size_bytes > settings.paper_reading_max_upload_bytes:
        raise HTTPException(status_code=413, detail="PDF upload is too large")

    upload_id = uuid4().hex
    upload_dir = _upload_root(request) / upload_id
    (upload_dir / "chunks").mkdir(parents=True, exist_ok=True)
    metadata = {
        "upload_id": upload_id,
        "filename": Path(payload.filename.replace("\\", "/")).name.strip() or "paper.pdf",
        "media_type": payload.media_type,
        "size_bytes": payload.size_bytes,
        "total_chunks": payload.total_chunks,
        "created_at": datetime.now(UTC).isoformat(),
        "owner_id": owner_id_from_request(request),
    }
    (upload_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"upload_id": upload_id, "chunk_size_bytes": PAPER_FILE_CHUNK_MAX_BYTES}


@router.post("/cos-uploads")
async def create_cos_upload(payload: PaperCosUploadInitRequest, request: Request) -> dict:
    settings = request.app.state.settings
    _validate_pdf_metadata_values(payload.filename, payload.media_type)
    if payload.size_bytes > settings.paper_reading_max_upload_bytes:
        raise HTTPException(status_code=413, detail="PDF upload is too large")

    object_key = _new_paper_cos_object_key()
    upload_url = await _cos_signed_put_url(settings, object_key)
    return {"object_key": object_key, "upload_url": upload_url}


@router.put("/file-uploads/{upload_id}/chunks/{chunk_index}")
async def upload_file_chunk(upload_id: str, chunk_index: int, request: Request) -> dict:
    upload_dir = _upload_dir(request, upload_id)
    metadata = _read_upload_metadata(upload_dir)
    require_owner_access(str(metadata.get("owner_id") or "anonymous"), request)
    total_chunks = int(metadata.get("total_chunks") or 0)
    if chunk_index < 0 or chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="Invalid chunk index")

    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Chunk is empty")
    if len(data) > PAPER_FILE_CHUNK_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Chunk is too large")

    chunk_dir = upload_dir / "chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    (chunk_dir / f"{chunk_index}.part").write_bytes(data)
    received_chunks = len(list(chunk_dir.glob("*.part")))
    return {
        "upload_id": upload_id,
        "chunk_index": chunk_index,
        "received_chunks": received_chunks,
        "total_chunks": total_chunks,
        "complete": received_chunks == total_chunks,
    }


@router.post("/jobs")
async def create_paper_reading_job(
    request: Request,
    file: UploadFile | None = File(None),
    template_id: str = Form("africa-reading"),
    file_upload_id: str = Form(""),
    cos_object_key: str = Form(""),
) -> dict:
    settings = request.app.state.settings
    store = request.app.state.job_store
    has_direct_file = bool(file and file.filename)
    has_chunked_file = bool(file_upload_id.strip())
    has_cos_file = bool(cos_object_key.strip())
    if sum([has_direct_file, has_chunked_file, has_cos_file]) > 1:
        raise HTTPException(status_code=400, detail="Provide only one PDF source")
    if has_chunked_file:
        temp_pdf_path = _consume_chunked_pdf_upload(
            request,
            file_upload_id.strip(),
            settings.workflow_storage_dir,
            settings.paper_reading_max_upload_bytes,
        )
    elif has_cos_file:
        temp_pdf_path = await _copy_cos_pdf_to_temp(
            request,
            cos_object_key.strip(),
            settings.workflow_storage_dir,
            settings.paper_reading_max_upload_bytes,
        )
    elif has_direct_file and file is not None:
        temp_pdf_path = await _write_limited_pdf_upload(
            file,
            settings.workflow_storage_dir,
            settings.paper_reading_max_upload_bytes,
        )
    else:
        raise HTTPException(status_code=400, detail="PDF upload required")
    owner_id = owner_id_from_request(request)
    try:
        request.app.state.workflow_scheduler.ensure_can_submit(owner_id, WorkflowType.PAPER_READING)
    except WorkflowLimitError as exc:
        temp_pdf_path.unlink(missing_ok=True)
        _raise_workflow_limit(exc)

    job = store.create_job(WorkflowType.PAPER_READING, template_id=template_id, owner_id=owner_id)
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
        await request.app.state.workflow_scheduler.enqueue(job, lambda: workflow.run(job.job_id, Path(pdf_path)))
    return store.load_job(job.job_id).model_dump(mode="json")
