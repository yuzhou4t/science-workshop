from fastapi import HTTPException, Request

from app.models.job import WorkflowJob
from app.storage.job_store import JobNotFoundError
from app.workflows.scheduler import normalize_owner_id


def identity_headers_are_trusted(request: Request) -> bool:
    return bool(
        getattr(request.state, "proxy_authenticated", False)
        or request.app.state.settings.workflow_allow_insecure_direct_access
    )


def owner_id_from_request(request: Request) -> str:
    if not identity_headers_are_trusted(request):
        return "anonymous"
    return normalize_owner_id(request.headers.get("x-workshop-user"))


def role_from_request(request: Request) -> str:
    if not identity_headers_are_trusted(request):
        return "user"
    return "admin" if request.headers.get("x-workshop-role") == "admin" else "user"


def require_owner_access(owner_id: str, request: Request) -> None:
    if role_from_request(request) == "admin":
        return
    if normalize_owner_id(owner_id) != owner_id_from_request(request):
        raise HTTPException(status_code=403, detail="Access denied")


def load_accessible_job(
    request: Request,
    job_id: str,
    *,
    not_found_detail: str = "Job not found",
) -> WorkflowJob:
    try:
        job = request.app.state.job_store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=not_found_detail) from exc
    require_owner_access(job.owner_id, request)
    return job
