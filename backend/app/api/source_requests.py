import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

router = APIRouter(prefix="/api/source-requests", tags=["source-requests"])


class SourceRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    journal_name: str
    homepage_url: str = ""
    feed_url: str = ""
    source_type: str = "自动识别"
    refresh_interval: str = "每周检查"
    notes: str = ""

    @field_validator("journal_name")
    @classmethod
    def journal_name_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("journal_name is required")
        return value


def _log_path(request: Request) -> Path:
    root = request.app.state.settings.workflow_storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root / "source-requests.jsonl"


def _source_request_record(payload: SourceRequestInput, request: Request) -> dict:
    now = datetime.now(UTC).isoformat()
    return {
        "request_id": uuid4().hex,
        "created_at": now,
        "intake_status": "pending_auto_probe",
        "probe_methods": ["RSS / Atom", "RSSHub 路由", "页面适配 / XPath", "开放元数据 / DOI"],
        "submitter": request.headers.get("x-workshop-user", "anonymous"),
        "submitter_role": request.headers.get("x-workshop-role", "user"),
        **payload.model_dump(),
    }


@router.post("")
def create_source_request(payload: SourceRequestInput, request: Request) -> dict:
    record = _source_request_record(payload, request)
    with _log_path(request).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {"ok": True, "request": record}


@router.get("")
def list_source_requests(request: Request) -> dict:
    if request.headers.get("x-workshop-role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    path = _log_path(request)
    if not path.exists():
        return {"requests": []}

    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"requests": list(reversed(records[-50:]))}
