from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, Field


class WorkflowType(StrEnum):
    PAPER_READING = "paper_reading"
    WECHAT_WRITING = "wechat_writing"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


class NodeStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class NodeState(BaseModel):
    node_id: str
    status: NodeStatus = NodeStatus.PENDING
    input_artifacts: list[str] = Field(default_factory=list)
    output_artifacts: list[str] = Field(default_factory=list)
    error: str = ""
    retry_count: int = 0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Artifact(BaseModel):
    name: str
    relative_path: str
    media_type: str


class WorkflowJob(BaseModel):
    job_id: str = Field(default_factory=lambda: uuid4().hex)
    workflow_type: WorkflowType
    template_id: str = "africa-reading"
    status: JobStatus = JobStatus.QUEUED
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    expires_at: datetime
    nodes: dict[str, NodeState] = Field(default_factory=dict)
    artifacts: dict[str, Artifact] = Field(default_factory=dict)


def ensure_relative_path(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()
