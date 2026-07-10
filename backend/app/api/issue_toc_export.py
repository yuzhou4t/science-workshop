import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.access import owner_id_from_request
from app.models.job import WorkflowType
from app.services.docx_exporter import DocxExporter
from app.workflows.issue_toc_export import IssueTocExportWorkflow

router = APIRouter(prefix="/api/workflows/issue-toc-export", tags=["issue-toc-export"])


class IssueArticleInput(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str
    authors: str = ""
    abstract: str = ""
    keywords: list[str] | str = Field(default_factory=list)
    section: str = "新文推介"

    @field_validator("title")
    @classmethod
    def title_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title is required")
        return value


class IssueTocExportRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    journal_name: str
    year: int | str | None = None
    volume: int | str | None = None
    issue: int | str | None = None
    issue_label: str = ""
    article_count: int | None = None
    columns: list[str] | str = Field(default_factory=list)
    online_note: str = ""
    template_id: str = "issue-toc"
    articles: list[IssueArticleInput]

    @field_validator("journal_name")
    @classmethod
    def journal_name_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("journal_name is required")
        return value


@router.post("/jobs")
async def create_issue_toc_export_job(payload: IssueTocExportRequest, request: Request) -> dict:
    if not payload.articles:
        raise HTTPException(status_code=400, detail="articles are required")

    store = request.app.state.job_store
    job = store.create_job(
        WorkflowType.ISSUE_TOC_EXPORT,
        template_id=payload.template_id,
        owner_id=owner_id_from_request(request),
    )
    issue_data: dict[str, Any] = payload.model_dump(exclude={"template_id"})
    store.write_text_artifact(
        job,
        "input/issue_toc.json",
        json.dumps(issue_data, ensure_ascii=False, indent=2),
        media_type="application/json",
    )

    workflow = IssueTocExportWorkflow(
        store=store,
        events=request.app.state.event_broker,
        docx_exporter=DocxExporter(),
    )
    await workflow.run(job.job_id)
    return store.load_job(job.job_id).model_dump(mode="json")
