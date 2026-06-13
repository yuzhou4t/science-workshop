import asyncio
from types import SimpleNamespace

import pytest

from app.models.job import JobStatus, WorkflowType
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.scheduler import WorkflowLimitError, WorkflowScheduler


def scheduler_settings(**overrides):
    values = {
        "workflow_max_running_jobs": 3,
        "workflow_paper_reading_max_running_jobs": 1,
        "workflow_wechat_writing_max_running_jobs": 2,
        "workflow_max_running_jobs_per_user": 1,
        "workflow_max_queued_jobs_per_user": 2,
        "workflow_paper_reading_daily_quota_per_user": 3,
        "workflow_wechat_writing_daily_quota_per_user": 10,
        "workflow_quota_timezone": "Asia/Shanghai",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_scheduler_starts_jobs_within_global_type_and_user_limits(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    scheduler = WorkflowScheduler(store, scheduler_settings(), EventBroker())
    release = asyncio.Event()
    started: list[str] = []

    async def runner(job_id: str) -> None:
        started.append(job_id)
        await release.wait()

    paper_1 = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading", owner_id="alice")
    paper_2 = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading", owner_id="bob")
    wechat_1 = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading", owner_id="carol")
    wechat_2 = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading", owner_id="alice")
    wechat_3 = store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading", owner_id="dave")

    for job in [paper_1, paper_2, wechat_1, wechat_2, wechat_3]:
        await scheduler.enqueue(job, lambda job_id=job.job_id: runner(job_id))
    await asyncio.sleep(0)

    assert set(started) == {paper_1.job_id, wechat_1.job_id, wechat_3.job_id}
    assert store.load_job(paper_2.job_id).status == JobStatus.QUEUED
    assert store.load_job(wechat_2.job_id).status == JobStatus.QUEUED

    release.set()
    await scheduler.wait_for_idle()
    assert set(started) == {job.job_id for job in [paper_1, paper_2, wechat_1, wechat_2, wechat_3]}


def test_scheduler_rejects_more_than_two_queued_jobs_per_user(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    scheduler = WorkflowScheduler(store, scheduler_settings(), EventBroker())
    store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading", owner_id="alice")
    store.create_job(WorkflowType.WECHAT_WRITING, template_id="africa-reading", owner_id="alice")

    with pytest.raises(WorkflowLimitError, match="queued workflow limit"):
        scheduler.ensure_can_submit("alice", WorkflowType.WECHAT_WRITING)


def test_scheduler_rejects_daily_paper_reading_quota(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    scheduler = WorkflowScheduler(store, scheduler_settings(), EventBroker())
    for _index in range(3):
        job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading", owner_id="alice")
        job.status = JobStatus.COMPLETED
        store.save_job(job)

    with pytest.raises(WorkflowLimitError, match="daily paper reading quota"):
        scheduler.ensure_can_submit("alice", WorkflowType.PAPER_READING)
