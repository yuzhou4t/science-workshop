import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.access import owner_id_from_request, role_from_request

router = APIRouter(prefix="/api/source-requests", tags=["source-requests"])


class SourceRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    journal_name: str = Field(max_length=200)
    homepage_url: str = Field(default="", max_length=2048)
    feed_url: str = Field(default="", max_length=2048)
    source_type: str = Field(default="自动识别", max_length=80)
    refresh_interval: str = Field(default="每周检查", max_length=80)
    notes: str = Field(default="", max_length=4000)

    @field_validator("journal_name")
    @classmethod
    def journal_name_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("journal_name is required")
        return value

    @field_validator("homepage_url", "feed_url")
    @classmethod
    def optional_http_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        if not re.match(r"^https?://[^/?#\s\\]+(?:[/?#]|$)", value, re.IGNORECASE):
            raise ValueError("URL must be a valid http(s) URL")
        try:
            parsed = urlparse(value)
            valid = parsed.scheme in {"http", "https"} and bool(parsed.netloc)
            _ = parsed.hostname, parsed.port
        except ValueError as exc:
            raise ValueError("URL must be a valid http(s) URL") from exc
        if not valid:
            raise ValueError("URL must be a valid http(s) URL")
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
        "submitter": owner_id_from_request(request),
        "submitter_role": role_from_request(request),
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
    if role_from_request(request) != "admin":
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
