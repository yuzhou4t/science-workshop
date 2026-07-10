import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.access import owner_id_from_request, role_from_request
from app.services.source_intake import (
    MAX_IMPORT_BYTES,
    MAX_PENDING_PROBES_PER_USER,
    append_pending_source_request,
    append_record,
    append_runtime_source,
    parse_import,
    read_records,
    schedule_probe,
    source_identity_values,
    source_key,
    update_record,
    utc_now,
)

router = APIRouter(prefix="/api/source-requests", tags=["source-requests"])
sources_router = APIRouter(prefix="/api/sources", tags=["sources"])


class SourceRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    journal_name: str = Field(max_length=200)
    issn: str = Field(default="", max_length=20)
    homepage_url: str = Field(default="", max_length=2048)
    archive_url: str = Field(default="", max_length=2048)
    sample_article_url: str = Field(default="", max_length=2048)
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

    @field_validator("issn")
    @classmethod
    def normalize_issn(cls, value: str) -> str:
        value = value.strip().upper()
        if value and not re.fullmatch(r"\d{4}-?\d{3}[\dX]", value):
            raise ValueError("ISSN must look like 1234-567X")
        return value

    @field_validator("homepage_url", "archive_url", "sample_article_url", "feed_url")
    @classmethod
    def optional_http_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        if not re.match(r"^https?://[^/?#\s\\]+(?:[/?#]|$)", value, re.IGNORECASE):
            raise ValueError("URL must be a valid http(s) URL")
        try:
            parsed = urlparse(value)
            valid = parsed.scheme in {"http", "https"} and bool(parsed.netloc) and not parsed.username and not parsed.password
            _ = parsed.hostname, parsed.port
        except ValueError as exc:
            raise ValueError("URL must be a valid http(s) URL") from exc
        if not valid:
            raise ValueError("URL must be a valid http(s) URL")
        return value


class SourceDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approve", "approved", "reject", "rejected"]
    reason: str = Field(default="", max_length=2000)

    @field_validator("decision")
    @classmethod
    def normalize_decision(cls, value: str) -> str:
        return "approve" if value == "approved" else "reject" if value == "rejected" else value


def _log_path(request: Request) -> Path:
    root = request.app.state.settings.workflow_storage_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root / "source-requests.jsonl"


def _source_request_record(payload: SourceRequestInput, request: Request, *, batch_id: str = "") -> dict:
    now = datetime.now(UTC).isoformat()
    record = {
        "request_id": uuid4().hex,
        "created_at": now,
        "intake_status": "pending_auto_probe",
        "probe_methods": ["RSS / Atom", "RSSHub 路由", "官网标准 Feed", "开放元数据 / DOI"],
        "submitter": owner_id_from_request(request),
        "submitter_role": role_from_request(request),
        **payload.model_dump(),
    }
    if batch_id:
        record["batch_id"] = batch_id
    return record


@router.post("")
def create_source_request(payload: SourceRequestInput, request: Request) -> dict:
    path = _log_path(request)
    record = _source_request_record(payload, request)
    # Persist first.  The admin inbox can read this pending record even while
    # the network probe is waiting in the background executor.
    outcome, stored = append_pending_source_request(path, record)
    if outcome == "duplicate":
        return {
            "ok": True,
            "duplicate": True,
            "request": {
                "request_id": (stored or {}).get("request_id", ""),
                "intake_status": (stored or {}).get("intake_status", ""),
                "journal_name": record["journal_name"],
            },
        }
    if outcome == "limit":
        raise HTTPException(
            status_code=429,
            detail=f"Each user may have at most {MAX_PENDING_PROBES_PER_USER} pending source probes",
        )
    schedule_probe(path, record["request_id"])
    return {"ok": True, "request": record, "duplicate": False}


@router.get("")
def list_source_requests(request: Request) -> dict:
    if role_from_request(request) != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    records = read_records(_log_path(request))
    return {"requests": list(reversed(records[-100:]))}


@router.post("/{request_id}/decision")
def decide_source_request(request_id: str, payload: SourceDecision, request: Request) -> dict:
    if role_from_request(request) != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    path = _log_path(request)
    records = read_records(path)
    record = next((item for item in records if item.get("request_id") == request_id), None)
    if record is None:
        raise HTTPException(status_code=404, detail="Source request not found")
    current = record.get("intake_status")
    if current == "approved":
        if payload.decision == "approve":
            return {"ok": True, "request": record, "idempotent": True}
        raise HTTPException(status_code=409, detail="Approved source cannot be rejected")
    if current == "rejected":
        if payload.decision == "reject":
            return {"ok": True, "request": record, "idempotent": True}
        raise HTTPException(status_code=409, detail="Rejected source must be retried before approval")
    if payload.decision == "approve":
        report = record.get("probe_report") or {}
        if current != "probe_succeeded" or not report.get("eligible_for_approval"):
            raise HTTPException(status_code=409, detail="Only a successfully verified Feed or open-metadata candidate can be approved")
        # Write the runtime registry before exposing the approved state.  Both
        # files use replace/locks, so Node never sees a half-written registry.
        try:
            record = {**record, "decided_at": utc_now()}
            append_runtime_source(request.app.state.settings, record)
        except OSError as exc:
            raise HTTPException(status_code=503, detail=f"Unable to write runtime source registry: {exc}") from exc
        changes = {"intake_status": "approved", "decision": "approve", "decision_reason": payload.reason, "decided_at": record["decided_at"]}
    else:
        changes = {"intake_status": "rejected", "decision": "reject", "decision_reason": payload.reason, "decided_at": utc_now()}
    updated = update_record(path, request_id, **changes)
    return {"ok": True, "request": updated}


@router.post("/{request_id}/retry")
def retry_source_request(request_id: str, request: Request) -> dict:
    if role_from_request(request) != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    path = _log_path(request)
    records = read_records(path)
    record = next((item for item in records if item.get("request_id") == request_id), None)
    if record is None:
        raise HTTPException(status_code=404, detail="Source request not found")
    if record.get("intake_status") not in {"probe_failed", "needs_manual_review", "rejected"}:
        raise HTTPException(status_code=409, detail="Only failed, manual-review or rejected requests can be retried")
    updated = update_record(path, request_id, intake_status="pending_auto_probe", retry_count=int(record.get("retry_count", 0)) + 1, retry_at=utc_now())
    schedule_probe(path, request_id)
    return {"ok": True, "request": updated}


def _import_rows(path: Path, rows: list[dict[str, str]]) -> tuple[list[dict], list[dict], list[dict]]:
    existing = read_records(path)
    seen = set().union(*(source_identity_values(item) for item in existing)) if existing else set()
    valid: list[dict] = []
    errors: list[dict] = []
    skipped: list[dict] = []
    for row_number, row in enumerate(rows, 2):
        try:
            payload = SourceRequestInput.model_validate(row)
        except Exception as exc:
            message = str(exc).replace("Value error, ", "")
            errors.append({"row": row_number, "error": message})
            continue
        key = source_identity_values(payload.model_dump())
        if key.intersection(seen):
            skipped.append({"row": row_number, "reason": "duplicate", "journal_name": payload.journal_name})
            continue
        seen.update(key)
        valid.append({"row": row_number, "payload": payload})
    return valid, errors, skipped


@sources_router.post("/import")
async def import_sources(
    request: Request,
    file: UploadFile = File(...),
    mode: Literal["preview", "commit"] = Query("preview"),
) -> dict:
    """Preview or commit CSV/XLSX rows; both paths use normal probing/approval."""
    if role_from_request(request) != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    content = await file.read(MAX_IMPORT_BYTES + 1)
    rows, parse_errors = parse_import(content, file.filename or "sources.csv", file.content_type or "")
    valid, errors, skipped = _import_rows(_log_path(request), rows)
    errors = parse_errors and [{"row": 1, "error": value} for value in parse_errors] + errors or errors
    preview_rows = [
        {"row": item["row"], **item["payload"].model_dump(), "duplicate": False}
        for item in valid
    ]
    preview_rows.extend(
        {"row": item.get("row", ""), "journal_name": item.get("journal_name", ""), "error": item.get("error", "")}
        for item in errors
    )
    preview_rows.extend(
        {"row": item.get("row", ""), "journal_name": item.get("journal_name", ""), "duplicate": True, "error": item.get("reason", "duplicate")}
        for item in skipped
    )
    response = {
        "ok": not errors,
        "mode": mode,
        "filename": file.filename or "",
        "rows_total": len(rows),
        "rows": preview_rows,
        "valid_rows": len(valid),
        "valid_count": len(valid),
        "duplicate_count": len(skipped),
        "error_count": len(errors),
        "errors": errors,
        "skipped": skipped,
        "requests_created": 0,
    }
    if mode == "preview" or errors:
        return response
    batch_id = uuid4().hex
    records = []
    path = _log_path(request)
    for item in valid:
        record = _source_request_record(item["payload"], request, batch_id=batch_id)
        append_record(path, record)
        schedule_probe(path, record["request_id"])
        records.append(record)
    response.update({"batch_id": batch_id, "requests_created": len(records), "requests": records})
    return response
