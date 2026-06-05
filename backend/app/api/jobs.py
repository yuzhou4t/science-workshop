from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.models.job import Artifact, NodeStatus
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobNotFoundError
from app.workflows.wechat_writing import downstream_nodes, editable_node_artifact_path, validate_rerun_node

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class NodeEditRequest(BaseModel):
    content: str


class RerunRequest(BaseModel):
    from_node: str


def _content_disposition_for_download(filename: str) -> str:
    fallback = _ascii_download_fallback(filename)
    encoded_filename = quote(filename, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded_filename}"


def _ascii_download_fallback(filename: str) -> str:
    safe_name = filename.replace("\r", "").replace("\n", "").replace('"', "")
    suffix = ""
    extension_start = safe_name.rfind(".")
    if extension_start != -1:
        candidate = safe_name[extension_start:]
        if _is_safe_ascii_suffix(candidate):
            suffix = candidate
    return f"download{suffix}"


def _is_safe_ascii_suffix(suffix: str) -> bool:
    return (
        suffix.isascii()
        and 1 < len(suffix) <= 16
        and suffix.startswith(".")
        and all(char.isalnum() or char in {"-", "_"} for char in suffix[1:])
    )


@router.get("/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    try:
        job = request.app.state.job_store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return job.model_dump(mode="json")


@router.get("/{job_id}/artifacts/{artifact_name}")
def get_artifact(job_id: str, artifact_name: str, request: Request) -> Response:
    try:
        data, artifact = request.app.state.job_store.read_artifact_bytes(job_id, artifact_name)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Artifact not found") from exc
    return Response(
        content=data,
        media_type=artifact.media_type,
        headers={"Content-Disposition": _content_disposition_for_download(artifact.name)},
    )


@router.post("/{job_id}/export/docx")
def export_docx(job_id: str, request: Request) -> dict[str, str]:
    store = request.app.state.job_store
    try:
        job = store.load_job(job_id)
        markdown_data, _artifact = store.read_artifact_bytes(job_id, "final.md")
    except (JobNotFoundError, OSError) as exc:
        raise HTTPException(status_code=404, detail="Final markdown not found") from exc

    output_path = store.job_dir(job_id) / "exports" / "final.docx"
    DocxExporter().export_markdown(markdown_data.decode("utf-8"), output_path)
    job.artifacts["final.docx"] = Artifact(
        name="final.docx",
        relative_path="exports/final.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    store.save_job(job)
    return {"artifact": "final.docx"}


@router.patch("/{job_id}/nodes/{node_id}")
def update_job_node(job_id: str, node_id: str, payload: NodeEditRequest, request: Request) -> dict:
    store = request.app.state.job_store
    try:
        job = store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    try:
        relative_path = editable_node_artifact_path(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unsupported editable node") from exc

    artifact = store.write_text_artifact(job, relative_path, payload.content)
    store.set_node_status(job, node_id, NodeStatus.COMPLETED, [artifact.name])
    return {"job_id": job_id, "node_id": node_id, "rerun_required": downstream_nodes(node_id)}


@router.post("/{job_id}/rerun")
def plan_job_rerun(job_id: str, payload: RerunRequest, request: Request) -> dict:
    try:
        request.app.state.job_store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    try:
        validate_rerun_node(payload.from_node)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unsupported rerun node") from exc
    return {"job_id": job_id, "from_node": payload.from_node, "will_rerun": downstream_nodes(payload.from_node)}


@router.get("/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    try:
        request.app.state.job_store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc

    async def stream():
        async for event in request.app.state.event_broker.subscribe(job_id):
            yield event.to_sse()

    return StreamingResponse(stream(), media_type="text/event-stream")
