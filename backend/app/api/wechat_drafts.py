import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, field_validator

from app.core.access import owner_id_from_request, role_from_request

router = APIRouter(prefix="/api/wechat-drafts", tags=["wechat-drafts"])


class WeChatDraftImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    content_markdown: str
    source_job_id: str = ""

    @field_validator("title", "content_markdown")
    @classmethod
    def required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field is required")
        return value


def _log_path(request: Request) -> Path:
    root = request.app.state.settings.workflow_storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root / "wechat-draft-imports.jsonl"


def _draft_record(payload: WeChatDraftImportInput, request: Request) -> dict:
    return {
        "draft_import_id": uuid4().hex,
        "created_at": datetime.now(UTC).isoformat(),
        "mode": "mock",
        "status": "prepared",
        "submitter": owner_id_from_request(request),
        "submitter_role": role_from_request(request),
        **payload.model_dump(),
    }


@router.post("")
def create_wechat_draft_import(payload: WeChatDraftImportInput, request: Request) -> dict:
    record = _draft_record(payload, request)
    with _log_path(request).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {"ok": True, "draft": record}


@router.get("")
def list_wechat_draft_imports(request: Request) -> dict:
    if role_from_request(request) != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    path = _log_path(request)
    if not path.exists():
        return {"drafts": []}

    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"drafts": list(reversed(records[-50:]))}
