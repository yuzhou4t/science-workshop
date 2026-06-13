import asyncio
import logging
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Request

from app.models.job import JobStatus, WorkflowJob, WorkflowType
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker

RunnerFactory = Callable[[], Awaitable[object]]

logger = logging.getLogger(__name__)


class WorkflowLimitError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass
class QueuedWorkflow:
    job_id: str
    workflow_type: WorkflowType
    owner_id: str
    runner_factory: RunnerFactory


def normalize_owner_id(owner_id: str | None) -> str:
    value = str(owner_id or "").strip()
    return value[:120] if value else "anonymous"


def owner_id_from_request(request: Request) -> str:
    return normalize_owner_id(request.headers.get("x-workshop-user"))


class WorkflowScheduler:
    def __init__(self, store: JobStore, settings, events: EventBroker) -> None:
        self.store = store
        self.settings = settings
        self.events = events
        self._lock = asyncio.Lock()
        self._queue: deque[QueuedWorkflow] = deque()
        self._running: dict[str, QueuedWorkflow] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def ensure_can_submit(self, owner_id: str, workflow_type: WorkflowType) -> None:
        owner = normalize_owner_id(owner_id)
        jobs = self.store.list_jobs()
        queued_count = sum(1 for job in jobs if job.owner_id == owner and job.status == JobStatus.QUEUED)
        if queued_count >= self.settings.workflow_max_queued_jobs_per_user:
            raise WorkflowLimitError("User queued workflow limit reached")

        quota = self._daily_quota_for(workflow_type)
        if quota is None:
            return
        submitted_today = sum(
            1
            for job in jobs
            if job.owner_id == owner and job.workflow_type == workflow_type and self._is_created_today(job)
        )
        if submitted_today >= quota:
            if workflow_type == WorkflowType.PAPER_READING:
                raise WorkflowLimitError("User daily paper reading quota reached")
            if workflow_type == WorkflowType.WECHAT_WRITING:
                raise WorkflowLimitError("User daily WeChat writing quota reached")
            raise WorkflowLimitError("User daily workflow quota reached")

    async def enqueue(self, job: WorkflowJob, runner_factory: RunnerFactory) -> None:
        item = QueuedWorkflow(
            job_id=job.job_id,
            workflow_type=job.workflow_type,
            owner_id=normalize_owner_id(job.owner_id),
            runner_factory=runner_factory,
        )
        async with self._lock:
            job.status = JobStatus.QUEUED
            self.store.save_job(job)
            self._queue.append(item)
            await self.events.publish(job.job_id, "progress", "workflow", "任务已排队", 0, {})
            self._start_ready_jobs_locked()

    async def wait_for_idle(self) -> None:
        while True:
            async with self._lock:
                if not self._queue and not self._running:
                    return
            await asyncio.sleep(0)

    def _start_ready_jobs_locked(self) -> None:
        started = True
        while started:
            started = False
            for item in list(self._queue):
                if not self._can_start_locked(item):
                    continue
                self._queue.remove(item)
                self._running[item.job_id] = item
                job = self.store.load_job(item.job_id)
                job.status = JobStatus.RUNNING
                self.store.save_job(job)
                self._tasks[item.job_id] = asyncio.create_task(self._run_item(item))
                started = True
                break

    async def _run_item(self, item: QueuedWorkflow) -> None:
        try:
            await item.runner_factory()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Workflow task failed for job %s", item.job_id)
        finally:
            async with self._lock:
                self._running.pop(item.job_id, None)
                self._tasks.pop(item.job_id, None)
                self._start_ready_jobs_locked()

    def _can_start_locked(self, item: QueuedWorkflow) -> bool:
        if len(self._running) >= self.settings.workflow_max_running_jobs:
            return False
        if self._running_count(workflow_type=item.workflow_type) >= self._type_limit(item.workflow_type):
            return False
        if self._running_count(owner_id=item.owner_id) >= self.settings.workflow_max_running_jobs_per_user:
            return False
        return True

    def _running_count(self, workflow_type: WorkflowType | None = None, owner_id: str | None = None) -> int:
        return sum(
            1
            for item in self._running.values()
            if (workflow_type is None or item.workflow_type == workflow_type)
            and (owner_id is None or item.owner_id == owner_id)
        )

    def _type_limit(self, workflow_type: WorkflowType) -> int:
        if workflow_type == WorkflowType.PAPER_READING:
            return self.settings.workflow_paper_reading_max_running_jobs
        if workflow_type == WorkflowType.WECHAT_WRITING:
            return self.settings.workflow_wechat_writing_max_running_jobs
        return self.settings.workflow_max_running_jobs

    def _daily_quota_for(self, workflow_type: WorkflowType) -> int | None:
        if workflow_type == WorkflowType.PAPER_READING:
            return self.settings.workflow_paper_reading_daily_quota_per_user
        if workflow_type == WorkflowType.WECHAT_WRITING:
            return self.settings.workflow_wechat_writing_daily_quota_per_user
        return None

    def _is_created_today(self, job: WorkflowJob) -> bool:
        timezone = self._quota_timezone()
        return job.created_at.astimezone(timezone).date() == datetime.now(timezone).date()

    def _quota_timezone(self):
        try:
            return ZoneInfo(self.settings.workflow_quota_timezone)
        except ZoneInfoNotFoundError:
            return ZoneInfo("UTC")
