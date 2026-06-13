# Paper Reading And WeChat Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local FastAPI workflow backend and static frontend integration for paper deep-reading and lightweight WeChat article writing, with full evidence-chain storage, 7-day cleanup, editable output, and DOCX export.

**Architecture:** Keep the current static frontend and Node journal crawler intact. Add an independent `backend/` FastAPI app that owns uploads, job state, workflow execution, MinerU/DeepSeek adapters, artifacts, SSE/polling status, and DOCX generation. Frontend changes should call the backend API and remain scoped to the two new boards plus article-card entry points.

**Tech Stack:** Python 3.11, FastAPI, Pydantic Settings, pytest, httpx, python-docx, python-multipart, optional `cos-python-sdk-v5`, existing static `index.html`, existing Node `.mjs` checks.

---

## Existing Context To Preserve

- Project root: `/Users/yuzhou4tc/Public/工作坊/journal-workshop-prototype`.
- Existing frontend entry: `index.html`.
- Existing journal workflow docs: `docs/architecture.md`, `docs/runbook.md`, `docs/handoff.md`.
- Existing crawler scripts and data must remain the source of truth for article tracking.
- Current uncommitted work may include `index.html` feed-display changes and `.superpowers/` visual companion files. Do not overwrite or revert unrelated changes.
- Runtime job data must not be committed.

## File Structure

Create:

- `backend/requirements.txt` - Python backend dependencies.
- `backend/.env.example` - documented environment variables with non-secret defaults.
- `backend/app/__init__.py` - package marker.
- `backend/app/main.py` - FastAPI app factory, CORS, routers, startup cleanup.
- `backend/app/core/config.py` - settings loaded from `.env`.
- `backend/app/models/job.py` - workflow, node, artifact, and event models.
- `backend/app/storage/job_store.py` - local job directory persistence and retention cleanup.
- `backend/app/workflows/events.py` - per-job event broker for SSE and polling recovery.
- `backend/app/services/docx_exporter.py` - Markdown-to-DOCX export.
- `backend/app/services/deepseek_client.py` - DeepSeek interface plus deterministic mock mode.
- `backend/app/services/mineru_client.py` - MinerU interface with COS-first upload path and mock mode.
- `backend/app/workflows/paper_reading.py` - paper-reading orchestrator.
- `backend/app/workflows/wechat_writing.py` - lightweight WeChat writing orchestrator.
- `backend/app/api/jobs.py` - status, SSE, node edit, rerun, artifact, and DOCX export routes.
- `backend/app/api/paper_reading.py` - paper-reading job creation route.
- `backend/app/api/wechat_writing.py` - WeChat writing job creation route.
- `backend/tests/conftest.py` - temp storage and app fixtures.
- `backend/tests/test_job_store.py` - job persistence and cleanup tests.
- `backend/tests/test_docx_exporter.py` - DOCX generation tests.
- `backend/tests/test_workflow_rerun.py` - node edit and downstream rerun tests.
- `backend/tests/test_api_jobs.py` - FastAPI status, artifact, and SSE tests.
- `backend/tests/test_paper_workflow.py` - mocked paper workflow integration.
- `backend/tests/test_wechat_workflow.py` - mocked WeChat workflow integration.

Modify:

- `.gitignore` - ignore backend runtime state, virtualenvs, caches, and secrets.
- `index.html` - add the two workflow boards and API calls after backend endpoints are working.
- `docs/runbook.md` - add local backend setup and workflow smoke-test commands.
- `docs/handoff.md` - record the new workflow capability and any known local setup notes.

---

## Task 1: Backend Scaffold And Config

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/core/config.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_api_jobs.py`
- Modify: `.gitignore`

- [ ] **Step 1: Add the failing health-check test**

Create `backend/tests/test_api_jobs.py` with:

```python
from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

Create `backend/tests/conftest.py` with:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("WORKFLOW_STORAGE_DIR", str(tmp_path / "workflow_jobs"))
    monkeypatch.setenv("WORKFLOW_RETENTION_DAYS", "7")
    monkeypatch.setenv("WORKFLOW_USE_MOCKS", "true")
    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend
python3.11 -m pytest tests/test_api_jobs.py::test_health_endpoint -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app'` or an import error for `app.main`.

- [ ] **Step 3: Add backend dependencies and config**

Create `backend/requirements.txt` with:

```text
fastapi==0.115.12
uvicorn[standard]==0.34.3
python-multipart==0.0.20
pydantic-settings==2.9.1
httpx==0.28.1
python-docx==1.1.2
pytest==8.3.5
pytest-asyncio==0.26.0
cos-python-sdk-v5==1.9.36
```

Create `backend/.env.example` with:

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

MINERU_API_KEY=
MINERU_BASE_URL=https://mineru.net
MINERU_ENABLED=true

TENCENT_COS_SECRET_ID=
TENCENT_COS_SECRET_KEY=
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_BUCKET=

WORKFLOW_STORAGE_DIR=storage/workflow_jobs
WORKFLOW_RETENTION_DAYS=3
WORKFLOW_USE_MOCKS=true
```

Create `backend/app/__init__.py` as an empty file.

Create `backend/app/core/config.py` with:

```python
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    deepseek_api_key: str = Field(default="", alias="DEEPSEEK_API_KEY")
    deepseek_base_url: str = Field(default="https://api.deepseek.com", alias="DEEPSEEK_BASE_URL")
    deepseek_model: str = Field(default="deepseek-chat", alias="DEEPSEEK_MODEL")

    mineru_api_key: str = Field(default="", alias="MINERU_API_KEY")
    mineru_base_url: str = Field(default="https://mineru.net", alias="MINERU_BASE_URL")
    mineru_enabled: bool = Field(default=True, alias="MINERU_ENABLED")

    tencent_cos_secret_id: str = Field(default="", alias="TENCENT_COS_SECRET_ID")
    tencent_cos_secret_key: str = Field(default="", alias="TENCENT_COS_SECRET_KEY")
    tencent_cos_region: str = Field(default="ap-guangzhou", alias="TENCENT_COS_REGION")
    tencent_cos_bucket: str = Field(default="", alias="TENCENT_COS_BUCKET")

    workflow_storage_dir: Path = Field(default=Path("storage/workflow_jobs"), alias="WORKFLOW_STORAGE_DIR")
    workflow_retention_days: int = Field(default=3, alias="WORKFLOW_RETENTION_DAYS")
    workflow_use_mocks: bool = Field(default=False, alias="WORKFLOW_USE_MOCKS")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
```

Create `backend/app/main.py` with:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Science Workshop Workflow API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        settings.workflow_storage_dir.mkdir(parents=True, exist_ok=True)
        return {"status": "ok"}

    return app


app = create_app()
```

Modify `.gitignore` by appending:

```text
.venv/
backend/.venv/
backend/.env
backend/.pytest_cache/
backend/__pycache__/
backend/app/**/__pycache__/
backend/tests/**/__pycache__/
backend/storage/
.superpowers/
```

- [ ] **Step 4: Install dependencies and rerun the health test**

Run:

```bash
cd backend
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m pytest tests/test_api_jobs.py::test_health_endpoint -v
```

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit the scaffold**

Run:

```bash
git add .gitignore backend/requirements.txt backend/.env.example backend/app/__init__.py backend/app/core/config.py backend/app/main.py backend/tests/conftest.py backend/tests/test_api_jobs.py
git commit -m "Add workflow backend scaffold"
```

---

## Task 2: Job Models, Local Store, And Retention

**Files:**
- Create: `backend/app/models/job.py`
- Create: `backend/app/storage/job_store.py`
- Create: `backend/tests/test_job_store.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Write failing tests for job creation and retention cleanup**

Create `backend/tests/test_job_store.py` with:

```python
from datetime import UTC, datetime, timedelta

from app.models.job import WorkflowType
from app.storage.job_store import JobStore


def test_create_job_writes_job_json(tmp_path) -> None:
    store = JobStore(tmp_path, retention_days=7)

    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    job_path = tmp_path / job.job_id / "job.json"
    assert job_path.exists()
    loaded = store.load_job(job.job_id)
    assert loaded.job_id == job.job_id
    assert loaded.workflow_type == WorkflowType.PAPER_READING
    assert loaded.template_id == "africa-reading"
    assert (tmp_path / job.job_id / "input").is_dir()
    assert (tmp_path / job.job_id / "extraction").is_dir()
    assert (tmp_path / job.job_id / "nodes").is_dir()
    assert (tmp_path / job.job_id / "exports").is_dir()


def test_cleanup_expired_jobs_removes_old_directory(tmp_path) -> None:
    store = JobStore(tmp_path, retention_days=7)
    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading")
    job.created_at = datetime.now(UTC) - timedelta(days=9)
    job.expires_at = datetime.now(UTC) - timedelta(days=2)
    store.save_job(job)

    removed = store.cleanup_expired_jobs(now=datetime.now(UTC))

    assert removed == [job.job_id]
    assert not (tmp_path / job.job_id).exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_job_store.py -v
```

Expected: FAIL because `app.models.job` and `app.storage.job_store` do not exist.

- [ ] **Step 3: Add job models**

Create `backend/app/models/job.py` with:

```python
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
```

- [ ] **Step 4: Add the local job store**

Create `backend/app/storage/job_store.py` with:

```python
import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.models.job import Artifact, NodeState, NodeStatus, WorkflowJob, WorkflowType


class JobNotFoundError(Exception):
    pass


class JobStore:
    def __init__(self, root: Path, retention_days: int) -> None:
        self.root = root
        self.retention_days = retention_days
        self.root.mkdir(parents=True, exist_ok=True)

    def create_job(self, workflow_type: WorkflowType, template_id: str) -> WorkflowJob:
        now = datetime.now(UTC)
        job = WorkflowJob(
            workflow_type=workflow_type,
            template_id=template_id,
            created_at=now,
            updated_at=now,
            expires_at=now + timedelta(days=self.retention_days),
        )
        job_dir = self.job_dir(job.job_id)
        for child in ("input", "extraction", "nodes", "exports"):
            (job_dir / child).mkdir(parents=True, exist_ok=True)
        self.save_job(job)
        return job

    def job_dir(self, job_id: str) -> Path:
        return self.root / job_id

    def save_job(self, job: WorkflowJob) -> None:
        job.updated_at = datetime.now(UTC)
        job_dir = self.job_dir(job.job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "job.json").write_text(
            job.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def load_job(self, job_id: str) -> WorkflowJob:
        job_file = self.job_dir(job_id) / "job.json"
        if not job_file.exists():
            raise JobNotFoundError(job_id)
        return WorkflowJob.model_validate_json(job_file.read_text(encoding="utf-8"))

    def set_node_status(
        self,
        job: WorkflowJob,
        node_id: str,
        status: NodeStatus,
        output_artifacts: list[str] | None = None,
        error: str = "",
    ) -> WorkflowJob:
        node = job.nodes.get(node_id, NodeState(node_id=node_id))
        node.status = status
        node.error = error
        node.updated_at = datetime.now(UTC)
        if output_artifacts is not None:
            node.output_artifacts = output_artifacts
        job.nodes[node_id] = node
        self.save_job(job)
        return job

    def write_text_artifact(
        self,
        job: WorkflowJob,
        relative_path: str,
        content: str,
        media_type: str = "text/markdown; charset=utf-8",
    ) -> Artifact:
        path = self.job_dir(job.job_id) / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        artifact = Artifact(name=Path(relative_path).name, relative_path=relative_path, media_type=media_type)
        job.artifacts[artifact.name] = artifact
        self.save_job(job)
        return artifact

    def read_artifact_bytes(self, job_id: str, artifact_name: str) -> tuple[bytes, Artifact]:
        job = self.load_job(job_id)
        artifact = job.artifacts.get(artifact_name)
        if artifact is None:
            raise JobNotFoundError(f"{job_id}:{artifact_name}")
        path = (self.job_dir(job_id) / artifact.relative_path).resolve()
        root = self.job_dir(job_id).resolve()
        if root not in path.parents and path != root:
            raise JobNotFoundError(f"{job_id}:{artifact_name}")
        return path.read_bytes(), artifact

    def cleanup_expired_jobs(self, now: datetime | None = None) -> list[str]:
        current_time = now or datetime.now(UTC)
        removed: list[str] = []
        for job_file in self.root.glob("*/job.json"):
            job = WorkflowJob.model_validate_json(job_file.read_text(encoding="utf-8"))
            if job.expires_at <= current_time:
                shutil.rmtree(job_file.parent)
                removed.append(job.job_id)
        return removed
```

- [ ] **Step 5: Wire the store into app state**

Modify `backend/app/main.py` to:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.storage.job_store import JobStore


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Science Workshop Workflow API")
    app.state.settings = settings
    app.state.job_store = JobStore(settings.workflow_storage_dir, settings.workflow_retention_days)
    app.state.job_store.cleanup_expired_jobs()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        settings.workflow_storage_dir.mkdir(parents=True, exist_ok=True)
        return {"status": "ok"}

    return app


app = create_app()
```

Modify `backend/tests/conftest.py` to reset settings cache:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache


@pytest.fixture()
def client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("WORKFLOW_STORAGE_DIR", str(tmp_path / "workflow_jobs"))
    monkeypatch.setenv("WORKFLOW_RETENTION_DAYS", "7")
    monkeypatch.setenv("WORKFLOW_USE_MOCKS", "true")
    reset_settings_cache()
    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    reset_settings_cache()
```

- [ ] **Step 6: Run store and health tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_job_store.py tests/test_api_jobs.py::test_health_endpoint -v
```

Expected: PASS.

- [ ] **Step 7: Commit job storage**

Run:

```bash
git add backend/app/models/job.py backend/app/storage/job_store.py backend/app/main.py backend/tests/conftest.py backend/tests/test_job_store.py
git commit -m "Add workflow job storage"
```

---

## Task 3: Event Broker, Status API, Artifacts, And SSE

**Files:**
- Create: `backend/app/workflows/events.py`
- Create: `backend/app/api/jobs.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api_jobs.py`

- [ ] **Step 1: Add failing API tests**

Append to `backend/tests/test_api_jobs.py`:

```python
from app.models.job import WorkflowType


def test_job_status_returns_created_job(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    response = client.get(f"/api/jobs/{job.job_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["job_id"] == job.job_id
    assert body["workflow_type"] == "paper_reading"
    assert body["status"] == "queued"


def test_artifact_download_returns_saved_markdown(client: TestClient) -> None:
    store = client.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    store.write_text_artifact(job, "nodes/final.md", "# 标题\n\n正文")

    response = client.get(f"/api/jobs/{job.job_id}/artifacts/final.md")

    assert response.status_code == 200
    assert "# 标题" in response.text
    assert response.headers["content-type"].startswith("text/markdown")


def test_missing_job_returns_404(client: TestClient) -> None:
    response = client.get("/api/jobs/missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found"
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_api_jobs.py -v
```

Expected: FAIL with `404 Not Found` for `/api/jobs/{job_id}` because the router is not registered.

- [ ] **Step 3: Add the event broker**

Create `backend/app/workflows/events.py` with:

```python
import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass(frozen=True)
class WorkflowEvent:
    job_id: str
    event: str
    node_id: str
    message: str
    progress: float
    data: dict[str, Any]
    created_at: str

    def to_sse(self) -> str:
        return f"event: {self.event}\ndata: {json.dumps(self.__dict__, ensure_ascii=False)}\n\n"


class EventBroker:
    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue[WorkflowEvent]]] = defaultdict(set)

    async def publish(
        self,
        job_id: str,
        event: str,
        node_id: str,
        message: str,
        progress: float,
        data: dict[str, Any] | None = None,
    ) -> WorkflowEvent:
        item = WorkflowEvent(
            job_id=job_id,
            event=event,
            node_id=node_id,
            message=message,
            progress=progress,
            data=data or {},
            created_at=datetime.now(UTC).isoformat(),
        )
        for queue in list(self._queues[job_id]):
            await queue.put(item)
        return item

    async def subscribe(self, job_id: str):
        queue: asyncio.Queue[WorkflowEvent] = asyncio.Queue()
        self._queues[job_id].add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._queues[job_id].discard(queue)
```

- [ ] **Step 4: Add jobs API router**

Create `backend/app/api/jobs.py` with:

```python
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.storage.job_store import JobNotFoundError

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


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
        headers={"Content-Disposition": f'attachment; filename="{artifact.name}"'},
    )


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
```

Modify `backend/app/main.py` to register the broker and router:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import jobs
from app.core.config import get_settings
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Science Workshop Workflow API")
    app.state.settings = settings
    app.state.job_store = JobStore(settings.workflow_storage_dir, settings.workflow_retention_days)
    app.state.event_broker = EventBroker()
    app.state.job_store.cleanup_expired_jobs()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        settings.workflow_storage_dir.mkdir(parents=True, exist_ok=True)
        return {"status": "ok"}

    app.include_router(jobs.router)
    return app


app = create_app()
```

Create `backend/app/api/__init__.py` as an empty file.

- [ ] **Step 5: Run API tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_api_jobs.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit job API**

Run:

```bash
git add backend/app/api/__init__.py backend/app/api/jobs.py backend/app/main.py backend/app/workflows/events.py backend/tests/test_api_jobs.py
git commit -m "Add workflow job status API"
```

---

## Task 4: DOCX Exporter

**Files:**
- Create: `backend/app/services/docx_exporter.py`
- Create: `backend/tests/test_docx_exporter.py`
- Modify: `backend/app/api/jobs.py`

- [ ] **Step 1: Write failing DOCX tests**

Create `backend/tests/test_docx_exporter.py` with:

```python
from docx import Document

from app.services.docx_exporter import DocxExporter


def test_export_markdown_to_docx_preserves_headings_and_paragraphs(tmp_path) -> None:
    output = tmp_path / "final.docx"
    exporter = DocxExporter()

    exporter.export_markdown("# 主标题\n\n## 小标题\n\n这是一段正文。", output)

    assert output.exists()
    doc = Document(output)
    texts = [paragraph.text for paragraph in doc.paragraphs]
    assert "主标题" in texts
    assert "小标题" in texts
    assert "这是一段正文。" in texts
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_docx_exporter.py -v
```

Expected: FAIL because `app.services.docx_exporter` does not exist.

- [ ] **Step 3: Add DOCX exporter**

Create `backend/app/services/docx_exporter.py` with:

```python
from pathlib import Path

from docx import Document


class DocxExporter:
    def export_markdown(self, markdown: str, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        document = Document()
        for raw_line in markdown.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("# "):
                document.add_heading(line[2:].strip(), level=1)
            elif line.startswith("## "):
                document.add_heading(line[3:].strip(), level=2)
            elif line.startswith("### "):
                document.add_heading(line[4:].strip(), level=3)
            elif line.startswith("- "):
                document.add_paragraph(line[2:].strip(), style="List Bullet")
            else:
                document.add_paragraph(line)
        document.save(output_path)
        return output_path
```

Create `backend/app/services/__init__.py` as an empty file.

- [ ] **Step 4: Add DOCX export API**

Append to `backend/app/api/jobs.py`:

```python
from app.models.job import Artifact
from app.services.docx_exporter import DocxExporter


@router.post("/{job_id}/export/docx")
def export_docx(job_id: str, request: Request) -> dict[str, str]:
    store = request.app.state.job_store
    try:
        job = store.load_job(job_id)
        final_bytes, _ = store.read_artifact_bytes(job_id, "final.md")
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Final markdown not found") from exc

    output_path = store.job_dir(job_id) / "exports" / "final.docx"
    DocxExporter().export_markdown(final_bytes.decode("utf-8"), output_path)
    job.artifacts["final.docx"] = Artifact(
        name="final.docx",
        relative_path="exports/final.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    store.save_job(job)
    return {"artifact": "final.docx"}
```

- [ ] **Step 5: Run DOCX and API tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_docx_exporter.py tests/test_api_jobs.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit DOCX exporter**

Run:

```bash
git add backend/app/services/__init__.py backend/app/services/docx_exporter.py backend/app/api/jobs.py backend/tests/test_docx_exporter.py
git commit -m "Add workflow DOCX export"
```

---

## Task 5: DeepSeek Client, MinerU Client, And Mock Mode

**Files:**
- Create: `backend/app/services/deepseek_client.py`
- Create: `backend/app/services/mineru_client.py`
- Create: `backend/tests/test_paper_workflow.py`

- [ ] **Step 1: Write failing client tests**

Create `backend/tests/test_paper_workflow.py` with:

```python
import pytest

from app.services.deepseek_client import DeepSeekClient
from app.services.mineru_client import MineruClient


@pytest.mark.asyncio
async def test_mock_mineru_returns_markdown(tmp_path) -> None:
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 mock")
    client = MineruClient(use_mock=True)

    result = await client.parse_pdf_to_markdown(pdf)

    assert "# Mock Extracted Paper" in result.markdown
    assert result.assets == []


@pytest.mark.asyncio
async def test_mock_deepseek_returns_node_text() -> None:
    client = DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True)

    result = await client.generate("basic_info", "Extract basic info")

    assert result.startswith("# basic_info")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_paper_workflow.py -v
```

Expected: FAIL because client modules do not exist.

- [ ] **Step 3: Add DeepSeek client**

Create `backend/app/services/deepseek_client.py` with:

```python
import httpx


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str, model: str, use_mock: bool = False) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.use_mock = use_mock

    async def generate(self, node_id: str, prompt: str) -> str:
        if self.use_mock:
            return f"# {node_id}\n\nMock output for prompt length {len(prompt)}."
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is required when mock mode is disabled")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "你是严谨的中文学术编辑，只输出可直接保存的 Markdown。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
```

- [ ] **Step 4: Add MinerU client with COS-first shape and mock mode**

Create `backend/app/services/mineru_client.py` with:

```python
import asyncio
import os
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(frozen=True)
class MineruResult:
    markdown: str
    assets: list[Path]


class MineruClient:
    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://mineru.net",
        use_mock: bool = False,
        cos_secret_id: str = "",
        cos_secret_key: str = "",
        cos_region: str = "ap-guangzhou",
        cos_bucket: str = "",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.use_mock = use_mock
        self.cos_secret_id = cos_secret_id
        self.cos_secret_key = cos_secret_key
        self.cos_region = cos_region
        self.cos_bucket = cos_bucket

    async def parse_pdf_to_markdown(self, pdf_path: Path) -> MineruResult:
        if self.use_mock:
            return MineruResult(
                markdown="# Mock Extracted Paper\n\nThis is mock MinerU Markdown.",
                assets=[],
            )
        if not self.api_key:
            raise RuntimeError("MINERU_API_KEY is required when mock mode is disabled")
        file_url = await self._upload_to_cos(pdf_path)
        task_id = await self._create_task(file_url)
        zip_url = await self._wait_for_completion(task_id)
        return await self._download_and_extract(zip_url, pdf_path.parent / "mineru_assets")

    async def _upload_to_cos(self, pdf_path: Path) -> str:
        if not all([self.cos_secret_id, self.cos_secret_key, self.cos_bucket]):
            raise RuntimeError("Tencent COS settings are required for MinerU parsing")

        from qcloud_cos import CosConfig, CosS3Client

        object_key = f"mineru/{int(time.time())}_{pdf_path.name}"
        config = CosConfig(
            Region=self.cos_region,
            SecretId=self.cos_secret_id,
            SecretKey=self.cos_secret_key,
            Token=None,
            Scheme="https",
        )
        client = CosS3Client(config)

        def upload_sync() -> None:
            with pdf_path.open("rb") as file_obj:
                client.put_object(
                    Bucket=self.cos_bucket,
                    Body=file_obj.read(),
                    Key=object_key,
                    ContentType="application/pdf",
                )

        await asyncio.get_running_loop().run_in_executor(None, upload_sync)
        return f"https://{self.cos_bucket}.cos.{self.cos_region}.myqcloud.com/{object_key}"

    async def _create_task(self, file_url: str) -> str:
        payload = {
            "url": file_url,
            "model_version": "vlm",
            "enable_formula": True,
            "enable_table": True,
            "language": "ch",
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            response = await client.post(f"{self.base_url}/api/v4/extract/task", headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
            if body.get("code") != 0:
                raise RuntimeError(body.get("msg", "MinerU task creation failed"))
            return body["data"]["task_id"]

    async def _wait_for_completion(self, task_id: str, max_wait: int = 300) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        started = time.time()
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            while time.time() - started < max_wait:
                response = await client.get(f"{self.base_url}/api/v4/extract/task/{task_id}", headers=headers)
                response.raise_for_status()
                body = response.json()
                if body.get("code") != 0:
                    raise RuntimeError(body.get("msg", "MinerU task query failed"))
                data = body.get("data", {})
                state = data.get("state")
                if state == "done" and data.get("full_zip_url"):
                    return data["full_zip_url"]
                if state == "failed":
                    raise RuntimeError(data.get("err_msg", "MinerU task failed"))
                await asyncio.sleep(5)
        raise TimeoutError("MinerU task timed out")

    async def _download_and_extract(self, zip_url: str, asset_dir: Path) -> MineruResult:
        asset_dir.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(timeout=120.0, verify=False) as client:
            response = await client.get(zip_url)
            response.raise_for_status()
        zip_path = asset_dir / "mineru_result.zip"
        zip_path.write_bytes(response.content)
        extract_dir = asset_dir / "extracted"
        with zipfile.ZipFile(zip_path, "r") as archive:
            archive.extractall(extract_dir)
        markdown_paths = list(extract_dir.glob("**/*.md"))
        markdown = markdown_paths[0].read_text(encoding="utf-8") if markdown_paths else ""
        assets = [path for path in extract_dir.glob("**/*") if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg"}]
        return MineruResult(markdown=markdown, assets=assets)
```

- [ ] **Step 5: Run client tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_paper_workflow.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit clients**

Run:

```bash
git add backend/app/services/deepseek_client.py backend/app/services/mineru_client.py backend/tests/test_paper_workflow.py
git commit -m "Add workflow model service clients"
```

---

## Task 6: Paper Reading Workflow Orchestrator

**Files:**
- Create: `backend/app/workflows/paper_reading.py`
- Modify: `backend/tests/test_paper_workflow.py`

- [ ] **Step 1: Add failing paper workflow integration test**

Append to `backend/tests/test_paper_workflow.py`:

```python
from app.models.job import JobStatus, WorkflowType
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.paper_reading import PaperReadingWorkflow


@pytest.mark.asyncio
async def test_paper_workflow_creates_evidence_chain(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")

    workflow = PaperReadingWorkflow(
        store=store,
        events=EventBroker(),
        mineru=MineruClient(use_mock=True),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    completed = await workflow.run(job.job_id, pdf_path)

    assert completed.status == JobStatus.COMPLETED
    assert (store.job_dir(job.job_id) / "extraction" / "extracted.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "basic_info.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "basic_info.json").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "method_data_figures.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "method_data_figures.json").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "formula_metrics.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "formula_metrics.json").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "draft.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "final.md").exists()
    assert (store.job_dir(job.job_id) / "exports" / "final.docx").exists()
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_paper_workflow.py::test_paper_workflow_creates_evidence_chain -v
```

Expected: FAIL because `app.workflows.paper_reading` does not exist.

- [ ] **Step 3: Implement the paper workflow**

Create `backend/app/workflows/__init__.py` as an empty file.

Create `backend/app/workflows/paper_reading.py` with:

```python
import json
from pathlib import Path

from app.models.job import Artifact, JobStatus, NodeStatus, WorkflowJob
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


class PaperReadingWorkflow:
    def __init__(
        self,
        store: JobStore,
        events: EventBroker,
        mineru: MineruClient,
        deepseek: DeepSeekClient,
        docx_exporter: DocxExporter,
    ) -> None:
        self.store = store
        self.events = events
        self.mineru = mineru
        self.deepseek = deepseek
        self.docx_exporter = docx_exporter

    async def run(self, job_id: str, pdf_path: Path) -> WorkflowJob:
        job = self.store.load_job(job_id)
        job.status = JobStatus.RUNNING
        self.store.save_job(job)

        try:
            result = await self._extract(job, pdf_path)
            basic = await self._llm_node(job, "basic_info", self._basic_prompt(result.markdown))
            method = await self._llm_node(job, "method_data_figures", self._method_prompt(result.markdown))
            formula = await self._llm_node(job, "formula_metrics", self._formula_prompt(result.markdown))
            draft = await self._draft(job, basic, method, formula)
            final = await self._finalize(job, draft)
            self._export_docx(job, final)
            job.status = JobStatus.COMPLETED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "completed", "workflow", "论文精读完成", 100, {})
            return job
        except Exception as exc:
            job.status = JobStatus.FAILED
            self.store.save_job(job)
            await self.events.publish(job.job_id, "failed", "workflow", str(exc), 100, {})
            raise

    async def _extract(self, job: WorkflowJob, pdf_path: Path):
        self.store.set_node_status(job, "document_extraction", NodeStatus.RUNNING)
        await self.events.publish(job.job_id, "progress", "document_extraction", "MinerU 正在提取 PDF", 10, {})
        result = await self.mineru.parse_pdf_to_markdown(pdf_path)
        self.store.write_text_artifact(job, "extraction/extracted.md", result.markdown)
        self.store.set_node_status(job, "document_extraction", NodeStatus.COMPLETED, ["extracted.md"])
        await self.events.publish(job.job_id, "progress", "document_extraction", "MinerU 提取完成", 25, {})
        return result

    async def _llm_node(self, job: WorkflowJob, node_id: str, prompt: str) -> str:
        self.store.set_node_status(job, node_id, NodeStatus.RUNNING)
        await self.events.publish(job.job_id, "progress", node_id, f"{node_id} 正在生成", 40, {})
        content = await self.deepseek.generate(node_id, prompt)
        self.store.write_text_artifact(job, f"nodes/{node_id}.md", content)
        structured = json.dumps({"node_id": node_id, "markdown": content}, ensure_ascii=False, indent=2)
        self.store.write_text_artifact(job, f"nodes/{node_id}.json", structured, media_type="application/json")
        self.store.set_node_status(job, node_id, NodeStatus.COMPLETED, [f"{node_id}.md", f"{node_id}.json"])
        return content

    async def _draft(self, job: WorkflowJob, basic: str, method: str, formula: str) -> str:
        prompt = f"整合以下材料，写成研读非洲公众号精读初稿。\n\n{basic}\n\n{method}\n\n{formula}"
        draft = await self.deepseek.generate("draft", prompt)
        self.store.write_text_artifact(job, "nodes/draft.md", draft)
        self.store.set_node_status(job, "draft", NodeStatus.COMPLETED, ["draft.md"])
        return draft

    async def _finalize(self, job: WorkflowJob, draft: str) -> str:
        prompt = f"清理提示词残留、JSON 残留和附录残留，输出公众号终稿 Markdown。\n\n{draft}"
        final = await self.deepseek.generate("final", prompt)
        self.store.write_text_artifact(job, "nodes/final.md", final)
        self.store.set_node_status(job, "final", NodeStatus.COMPLETED, ["final.md"])
        return final

    def _export_docx(self, job: WorkflowJob, final_markdown: str) -> None:
        output_path = self.store.job_dir(job.job_id) / "exports" / "final.docx"
        self.docx_exporter.export_markdown(final_markdown, output_path)
        job.artifacts["final.docx"] = Artifact(
            name="final.docx",
            relative_path="exports/final.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self.store.set_node_status(job, "docx_export", NodeStatus.COMPLETED, ["final.docx"])

    def _basic_prompt(self, markdown: str) -> str:
        return f"抽取题目、作者、期刊、年份、摘要、研究问题、核心结论。\n\n{markdown}"

    def _method_prompt(self, markdown: str) -> str:
        return f"抽取数据来源、样本范围、研究方法、识别策略、图表含义、关键数字。\n\n{markdown}"

    def _formula_prompt(self, markdown: str) -> str:
        return f"抽取公式、指标定义、变量构造、统计模型和计算逻辑。\n\n{markdown}"
```

- [ ] **Step 4: Run paper workflow tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_paper_workflow.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit paper workflow**

Run:

```bash
git add backend/app/workflows/__init__.py backend/app/workflows/paper_reading.py backend/tests/test_paper_workflow.py
git commit -m "Add paper reading workflow"
```

---

## Task 7: Paper Reading API Route

**Files:**
- Create: `backend/app/api/paper_reading.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api_jobs.py`

- [ ] **Step 1: Add failing upload API test**

Append to `backend/tests/test_api_jobs.py`:

```python
def test_create_paper_reading_job_uploads_pdf(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/paper-reading/jobs",
        data={"template_id": "africa-reading"},
        files={"file": ("paper.pdf", b"%PDF-1.4 mock", "application/pdf")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "paper_reading"
    assert body["status"] in {"queued", "running", "completed"}
    assert body["job_id"]
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_api_jobs.py::test_create_paper_reading_job_uploads_pdf -v
```

Expected: FAIL with `404 Not Found`.

- [ ] **Step 3: Add paper route and dependency factory**

Create `backend/app/api/paper_reading.py` with:

```python
import asyncio
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile

from app.models.job import WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.services.mineru_client import MineruClient
from app.workflows.paper_reading import PaperReadingWorkflow

router = APIRouter(prefix="/api/workflows/paper-reading", tags=["paper-reading"])


@router.post("/jobs")
async def create_paper_reading_job(
    request: Request,
    file: UploadFile = File(...),
    template_id: str = Form("africa-reading"),
) -> dict:
    settings = request.app.state.settings
    store = request.app.state.job_store
    job = store.create_job(WorkflowType.PAPER_READING, template_id=template_id)
    pdf_path = store.job_dir(job.job_id) / "input" / "input.pdf"
    pdf_path.write_bytes(await file.read())

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
        asyncio.create_task(workflow.run(job.job_id, Path(pdf_path)))
    return store.load_job(job.job_id).model_dump(mode="json")
```

Modify `backend/app/main.py` imports and router registration:

```python
from app.api import jobs, paper_reading
```

Add after `app.include_router(jobs.router)`:

```python
    app.include_router(paper_reading.router)
```

- [ ] **Step 4: Run upload API test**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_api_jobs.py::test_create_paper_reading_job_uploads_pdf -v
```

Expected: PASS.

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest -v
```

Expected: PASS.

- [ ] **Step 6: Commit paper API**

Run:

```bash
git add backend/app/api/paper_reading.py backend/app/main.py backend/tests/test_api_jobs.py
git commit -m "Add paper reading workflow API"
```

---

## Task 8: Node Edit, Downstream Rerun Rules, And WeChat Workflow

**Files:**
- Create: `backend/app/workflows/wechat_writing.py`
- Create: `backend/app/api/wechat_writing.py`
- Create: `backend/tests/test_workflow_rerun.py`
- Create: `backend/tests/test_wechat_workflow.py`
- Modify: `backend/app/api/jobs.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing rerun-rule test**

Create `backend/tests/test_workflow_rerun.py` with:

```python
from app.workflows.wechat_writing import downstream_nodes


def test_downstream_nodes_for_final_only_regenerates_docx() -> None:
    assert downstream_nodes("final") == ["docx_export"]


def test_downstream_nodes_for_formula_regenerates_article_chain() -> None:
    assert downstream_nodes("formula_metrics") == ["draft", "final", "docx_export"]
```

Create `backend/tests/test_wechat_workflow.py` with:

```python
import pytest

from app.models.job import JobStatus, WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.wechat_writing import WeChatWritingWorkflow


@pytest.mark.asyncio
async def test_wechat_workflow_creates_angle_final_and_docx(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading")
    store.write_text_artifact(job, "input/source_bundle.json", '{"title":"测试论文"}', media_type="application/json")

    workflow = WeChatWritingWorkflow(
        store=store,
        events=EventBroker(),
        deepseek=DeepSeekClient(api_key="", base_url="https://example.invalid", model="mock", use_mock=True),
        docx_exporter=DocxExporter(),
    )

    completed = await workflow.run(job.job_id)

    assert completed.status == JobStatus.COMPLETED
    assert (store.job_dir(job.job_id) / "nodes" / "angle.md").exists()
    assert (store.job_dir(job.job_id) / "nodes" / "article_final.md").exists()
    assert (store.job_dir(job.job_id) / "exports" / "final.docx").exists()
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_workflow_rerun.py tests/test_wechat_workflow.py -v
```

Expected: FAIL because `app.workflows.wechat_writing` does not exist.

- [ ] **Step 3: Add WeChat workflow and rerun rules**

Create `backend/app/workflows/wechat_writing.py` with:

```python
from app.models.job import Artifact, JobStatus, NodeStatus, WorkflowJob
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker


RERUN_GRAPH = {
    "basic_info": ["draft", "final", "docx_export"],
    "method_data_figures": ["draft", "final", "docx_export"],
    "formula_metrics": ["draft", "final", "docx_export"],
    "draft": ["final", "docx_export"],
    "final": ["docx_export"],
}


def downstream_nodes(node_id: str) -> list[str]:
    return RERUN_GRAPH.get(node_id, [])


class WeChatWritingWorkflow:
    def __init__(
        self,
        store: JobStore,
        events: EventBroker,
        deepseek: DeepSeekClient,
        docx_exporter: DocxExporter,
    ) -> None:
        self.store = store
        self.events = events
        self.deepseek = deepseek
        self.docx_exporter = docx_exporter

    async def run(self, job_id: str) -> WorkflowJob:
        job = self.store.load_job(job_id)
        job.status = JobStatus.RUNNING
        self.store.save_job(job)
        source_bytes, _ = self.store.read_artifact_bytes(job_id, "source_bundle.json")
        source = source_bytes.decode("utf-8")
        angle = await self.deepseek.generate("angle", f"为公众号文章提炼选题角度。\n\n{source}")
        self.store.write_text_artifact(job, "nodes/angle.md", angle)
        self.store.set_node_status(job, "angle", NodeStatus.COMPLETED, ["angle.md"])
        draft = await self.deepseek.generate("article_draft", f"根据选题角度写公众号初稿。\n\n{angle}\n\n{source}")
        self.store.write_text_artifact(job, "nodes/article_draft.md", draft)
        self.store.set_node_status(job, "article_draft", NodeStatus.COMPLETED, ["article_draft.md"])
        final = await self.deepseek.generate("article_final", f"清理提示词残留并输出终稿。\n\n{draft}")
        self.store.write_text_artifact(job, "nodes/article_final.md", final)
        self.store.write_text_artifact(job, "nodes/final.md", final)
        self.store.set_node_status(job, "article_final", NodeStatus.COMPLETED, ["article_final.md", "final.md"])
        output_path = self.store.job_dir(job.job_id) / "exports" / "final.docx"
        self.docx_exporter.export_markdown(final, output_path)
        job.artifacts["final.docx"] = Artifact(
            name="final.docx",
            relative_path="exports/final.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        job.status = JobStatus.COMPLETED
        self.store.save_job(job)
        await self.events.publish(job.job_id, "completed", "workflow", "公众号文章完成", 100, {})
        return job
```

- [ ] **Step 4: Add node edit and rerun endpoints**

Append to `backend/app/api/jobs.py`:

```python
from pydantic import BaseModel

from app.workflows.wechat_writing import downstream_nodes


class NodeEditRequest(BaseModel):
    content: str


class RerunRequest(BaseModel):
    from_node: str


@router.patch("/{job_id}/nodes/{node_id}")
def edit_node(job_id: str, node_id: str, payload: NodeEditRequest, request: Request) -> dict:
    store = request.app.state.job_store
    try:
        job = store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    artifact_name = "final.md" if node_id == "final" else f"{node_id}.md"
    relative_path = f"nodes/{artifact_name}"
    store.write_text_artifact(job, relative_path, payload.content)
    return {"job_id": job_id, "node_id": node_id, "rerun_required": downstream_nodes(node_id)}


@router.post("/{job_id}/rerun")
def rerun_from_node(job_id: str, payload: RerunRequest, request: Request) -> dict:
    try:
        request.app.state.job_store.load_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return {"job_id": job_id, "from_node": payload.from_node, "will_rerun": downstream_nodes(payload.from_node)}
```

- [ ] **Step 5: Add WeChat route**

Create `backend/app/api/wechat_writing.py` with:

```python
import asyncio
import json

from fastapi import APIRouter, Form, Request

from app.models.job import WorkflowType
from app.services.deepseek_client import DeepSeekClient
from app.services.docx_exporter import DocxExporter
from app.workflows.wechat_writing import WeChatWritingWorkflow

router = APIRouter(prefix="/api/workflows/wechat-writing", tags=["wechat-writing"])


@router.post("/jobs")
async def create_wechat_writing_job(
    request: Request,
    source_text: str = Form(""),
    article_id: str = Form(""),
    paper_reading_job_id: str = Form(""),
    template_id: str = Form("africa-reading"),
) -> dict:
    settings = request.app.state.settings
    store = request.app.state.job_store
    job = store.create_job(WorkflowType.WECHAT_WRITING, template_id=template_id)
    source_bundle = {
        "source_text": source_text,
        "article_id": article_id,
        "paper_reading_job_id": paper_reading_job_id,
    }
    store.write_text_artifact(job, "input/source_bundle.json", json.dumps(source_bundle, ensure_ascii=False, indent=2), media_type="application/json")
    workflow = WeChatWritingWorkflow(
        store=store,
        events=request.app.state.event_broker,
        deepseek=DeepSeekClient(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            use_mock=settings.workflow_use_mocks,
        ),
        docx_exporter=DocxExporter(),
    )
    if settings.workflow_use_mocks:
        await workflow.run(job.job_id)
    else:
        asyncio.create_task(workflow.run(job.job_id))
    return store.load_job(job.job_id).model_dump(mode="json")
```

Modify `backend/app/main.py` imports and router registration:

```python
from app.api import jobs, paper_reading, wechat_writing
```

Add after paper router registration:

```python
    app.include_router(wechat_writing.router)
```

- [ ] **Step 6: Add WeChat API test**

Append to `backend/tests/test_api_jobs.py`:

```python
def test_create_wechat_writing_job(client: TestClient) -> None:
    response = client.post(
        "/api/workflows/wechat-writing/jobs",
        data={"source_text": "这是一段补充材料", "template_id": "africa-reading"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workflow_type"] == "wechat_writing"
    assert body["status"] == "completed"
```

- [ ] **Step 7: Run rerun, WeChat, and API tests**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest tests/test_workflow_rerun.py tests/test_wechat_workflow.py tests/test_api_jobs.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit WeChat workflow and node editing**

Run:

```bash
git add backend/app/workflows/wechat_writing.py backend/app/api/wechat_writing.py backend/app/api/jobs.py backend/app/main.py backend/tests/test_workflow_rerun.py backend/tests/test_wechat_workflow.py backend/tests/test_api_jobs.py
git commit -m "Add WeChat writing workflow"
```

---

## Task 9: Frontend Workflow Boards

**Files:**
- Modify: `index.html`
- Create: `scripts/workflow-ui-smoke-test.mjs`

- [ ] **Step 1: Add failing frontend smoke test for workflow labels**

Create `scripts/workflow-ui-smoke-test.mjs` with:

```javascript
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

const required = [
  '论文精读',
  '公众号文章写作',
  'data-workflow-panel="paper-reading"',
  'data-workflow-panel="wechat-writing"',
  'createPaperReadingJob',
  'createWechatWritingJob',
  '/api/workflows/paper-reading/jobs',
  '/api/workflows/wechat-writing/jobs',
];

const missing = required.filter((item) => !html.includes(item));

if (missing.length > 0) {
  console.error(`Missing workflow UI markers: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('workflow UI markers ok');
```

- [ ] **Step 2: Run the frontend smoke test to verify it fails**

Run:

```bash
node scripts/workflow-ui-smoke-test.mjs
```

Expected: FAIL with missing workflow UI markers.

- [ ] **Step 3: Add static workflow panels in `index.html`**

Find the reserved workflow/navigation area in `index.html`. Add two panels with these stable markers and controls while preserving existing journal tracking markup:

```html
<section class="workflow-panel" data-workflow-panel="paper-reading">
  <div class="workflow-header">
    <h2>论文精读</h2>
    <p>上传 PDF，生成“研读非洲｜第 X 期”式精读稿，并保留完整证据链。</p>
  </div>
  <form id="paperReadingForm" class="workflow-form">
    <input id="paperReadingFile" name="file" type="file" accept="application/pdf" required>
    <input id="paperTemplateId" name="template_id" type="hidden" value="africa-reading">
    <button type="submit">开始精读</button>
  </form>
  <div id="paperReadingStatus" class="workflow-status" aria-live="polite"></div>
  <textarea id="paperReadingEditor" class="workflow-editor" rows="18" placeholder="精读终稿会显示在这里，可编辑后导出 Word"></textarea>
  <button id="paperReadingExport" type="button">导出 Word</button>
</section>

<section class="workflow-panel" data-workflow-panel="wechat-writing">
  <div class="workflow-header">
    <h2>公众号文章写作</h2>
    <p>接入论文精读结果、期刊追踪条目或补充材料，生成可编辑公众号稿。</p>
  </div>
  <form id="wechatWritingForm" class="workflow-form">
    <textarea id="wechatSourceText" name="source_text" rows="6" placeholder="粘贴补充材料或写作要求"></textarea>
    <input id="wechatArticleId" name="article_id" type="hidden" value="">
    <input id="wechatPaperJobId" name="paper_reading_job_id" type="hidden" value="">
    <input id="wechatTemplateId" name="template_id" type="hidden" value="africa-reading">
    <button type="submit">生成文章</button>
  </form>
  <div id="wechatWritingStatus" class="workflow-status" aria-live="polite"></div>
  <textarea id="wechatWritingEditor" class="workflow-editor" rows="18" placeholder="公众号终稿会显示在这里，可编辑后导出 Word"></textarea>
  <button id="wechatWritingExport" type="button">导出 Word</button>
</section>
```

Add CSS that matches the existing page palette and avoids nested cards:

```css
.workflow-panel {
  padding: 28px 0;
  border-top: 1px solid var(--border, #e5e7eb);
}

.workflow-header {
  max-width: 960px;
  margin-bottom: 16px;
}

.workflow-form {
  display: grid;
  gap: 12px;
  max-width: 960px;
}

.workflow-status {
  min-height: 32px;
  margin: 12px 0;
  color: var(--muted, #667085);
}

.workflow-editor {
  width: 100%;
  max-width: 960px;
  min-height: 360px;
  resize: vertical;
  font: inherit;
  line-height: 1.7;
}
```

- [ ] **Step 4: Add frontend API functions**

Add JavaScript near the existing app script area:

```javascript
const WORKFLOW_API_BASE = 'http://127.0.0.1:8000';

async function createPaperReadingJob(form) {
  const response = await fetch(`${WORKFLOW_API_BASE}/api/workflows/paper-reading/jobs`, {
    method: 'POST',
    body: new FormData(form),
  });
  if (!response.ok) throw new Error(`论文精读任务创建失败：${response.status}`);
  return response.json();
}

async function createWechatWritingJob(form) {
  const response = await fetch(`${WORKFLOW_API_BASE}/api/workflows/wechat-writing/jobs`, {
    method: 'POST',
    body: new FormData(form),
  });
  if (!response.ok) throw new Error(`公众号写作任务创建失败：${response.status}`);
  return response.json();
}

async function fetchWorkflowArtifact(jobId, artifactName) {
  const response = await fetch(`${WORKFLOW_API_BASE}/api/jobs/${jobId}/artifacts/${artifactName}`);
  if (!response.ok) throw new Error(`读取产物失败：${response.status}`);
  return response.text();
}

function attachWorkflowForms() {
  const paperForm = document.getElementById('paperReadingForm');
  const paperStatus = document.getElementById('paperReadingStatus');
  const paperEditor = document.getElementById('paperReadingEditor');
  if (paperForm && paperStatus && paperEditor) {
    paperForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      paperStatus.textContent = '论文精读正在运行...';
      try {
        const job = await createPaperReadingJob(paperForm);
        paperEditor.value = await fetchWorkflowArtifact(job.job_id, 'final.md');
        paperStatus.textContent = '论文精读完成';
      } catch (error) {
        paperStatus.textContent = error.message;
      }
    });
  }

  const wechatForm = document.getElementById('wechatWritingForm');
  const wechatStatus = document.getElementById('wechatWritingStatus');
  const wechatEditor = document.getElementById('wechatWritingEditor');
  if (wechatForm && wechatStatus && wechatEditor) {
    wechatForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      wechatStatus.textContent = '公众号文章正在生成...';
      try {
        const job = await createWechatWritingJob(wechatForm);
        wechatEditor.value = await fetchWorkflowArtifact(job.job_id, 'final.md');
        wechatStatus.textContent = '公众号文章完成';
      } catch (error) {
        wechatStatus.textContent = error.message;
      }
    });
  }
}

attachWorkflowForms();
```

- [ ] **Step 5: Run frontend and existing static checks**

Run:

```bash
node scripts/workflow-ui-smoke-test.mjs
node scripts/article-link-policy-test.mjs
node scripts/build-adapter-front-data-test.mjs
node scripts/adapter-smoke-test.mjs
node --check scripts/build-front-data.mjs
git diff --check -- index.html scripts/workflow-ui-smoke-test.mjs
```

Expected: all commands pass.

- [ ] **Step 6: Commit frontend workflow boards**

Run:

```bash
git add index.html scripts/workflow-ui-smoke-test.mjs
git commit -m "Add workflow frontend boards"
```

---

## Task 10: Runbook, Handoff, And End-To-End Local Smoke

**Files:**
- Modify: `docs/runbook.md`
- Modify: `docs/handoff.md`

- [ ] **Step 1: Add backend runbook instructions**

Append this section to `docs/runbook.md`:

````markdown
## Local Workflow Backend

Install and run the local FastAPI workflow backend:

```bash
cd backend
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For mock-mode smoke tests, keep `WORKFLOW_USE_MOCKS=true` in `backend/.env`. Real MinerU and DeepSeek runs require:

```text
DEEPSEEK_API_KEY
MINERU_API_KEY
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_REGION
TENCENT_COS_BUCKET
```

Run backend tests:

```bash
cd backend
. .venv/bin/activate
python -m pytest -v
```

Create a mock paper-reading job:

```bash
curl -s -X POST http://127.0.0.1:8000/api/workflows/paper-reading/jobs \
  -F "template_id=africa-reading" \
  -F "file=@/path/to/paper.pdf"
```

Create a mock WeChat writing job:

```bash
curl -s -X POST http://127.0.0.1:8000/api/workflows/wechat-writing/jobs \
  -F "source_text=这是一段补充材料" \
  -F "template_id=africa-reading"
```
````

- [ ] **Step 2: Update handoff snapshot**

Append to `docs/handoff.md`:

```markdown
## Workflow Backend Additions

- Local FastAPI backend lives in `backend/`.
- Mock mode is controlled by `WORKFLOW_USE_MOCKS=true`.
- Workflow job artifacts are stored under `backend/storage/workflow_jobs/` by default and are ignored by git.
- Paper reading supports PDF upload, MinerU/DeepSeek adapters, full evidence-chain artifacts, final Markdown, and DOCX export.
- WeChat writing supports source text, tracked article id, paper-reading job id, final Markdown, and DOCX export.
- Job artifacts are retained for `WORKFLOW_RETENTION_DAYS`, defaulting to 3 days.
```

- [ ] **Step 3: Run backend, frontend, and docs checks**

Run:

```bash
cd backend
. .venv/bin/activate
python -m pytest -v
cd ..
node scripts/workflow-ui-smoke-test.mjs
node scripts/article-link-policy-test.mjs
node scripts/build-adapter-front-data-test.mjs
node scripts/adapter-smoke-test.mjs
node --check scripts/build-front-data.mjs
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Manual smoke with mock mode**

Start the backend:

```bash
cd backend
. .venv/bin/activate
WORKFLOW_USE_MOCKS=true uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, from the repo root, run:

```bash
printf '%s' '%PDF-1.4 mock' > /tmp/workflow-mock-paper.pdf
curl -s -X POST http://127.0.0.1:8000/api/workflows/paper-reading/jobs \
  -F "template_id=africa-reading" \
  -F "file=@/tmp/workflow-mock-paper.pdf"
```

Expected: JSON response with `"workflow_type":"paper_reading"` and `"status":"completed"` in mock mode.

- [ ] **Step 5: Commit docs and final verification**

Run:

```bash
git add docs/runbook.md docs/handoff.md
git commit -m "Document local workflow backend"
```

Then run:

```bash
git status --short
```

Expected: only unrelated pre-existing changes remain, or a clean worktree if those changes were already committed intentionally.

---

## Final Review Checklist

- [ ] `backend/.env` is ignored and not staged.
- [ ] `backend/storage/` is ignored and not staged.
- [ ] Existing journal tracking tests still pass.
- [ ] Mock backend tests pass without MinerU, COS, or DeepSeek credentials.
- [ ] `final.md` and `final.docx` are produced for paper-reading mock jobs.
- [ ] `final.md` and `final.docx` are produced for WeChat writing mock jobs.
- [ ] `GET /api/jobs/{job_id}` returns node statuses and artifacts.
- [ ] `GET /api/jobs/{job_id}/events` returns an SSE stream for existing jobs.
- [ ] `PATCH /api/jobs/{job_id}/nodes/final` allows editing final Markdown.
- [ ] `POST /api/jobs/{job_id}/export/docx` regenerates Word from the current final Markdown.
- [ ] The frontend shows "论文精读" and "公众号文章写作" without hiding or breaking existing timeline and source inventory views.
