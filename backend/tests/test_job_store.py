from datetime import UTC, datetime, timedelta

import pytest

from app.models.job import WorkflowType
from app.storage.job_store import JobNotFoundError, JobStore


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


def test_load_job_rejects_traversal_job_id(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    (outside_dir / "job.json").write_text(
        (store.job_dir(job.job_id) / "job.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    with pytest.raises(JobNotFoundError):
        store.load_job("../outside")


def test_write_text_artifact_rejects_traversal_path(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")

    with pytest.raises(ValueError):
        store.write_text_artifact(job, "../../escape.md", "nope")

    assert not (tmp_path / "escape.md").exists()


def test_write_text_artifact_rejects_absolute_path(tmp_path) -> None:
    store = JobStore(tmp_path / "jobs", retention_days=7)
    job = store.create_job(WorkflowType.PAPER_READING, template_id="africa-reading")
    outside_path = tmp_path / "outside.md"

    with pytest.raises(ValueError):
        store.write_text_artifact(job, str(outside_path), "nope")

    assert not outside_path.exists()


def test_cleanup_expired_jobs_ignores_malformed_job_json(tmp_path) -> None:
    store = JobStore(tmp_path, retention_days=7)
    broken_dir = tmp_path / "broken"
    broken_dir.mkdir()
    (broken_dir / "job.json").write_text("{not json", encoding="utf-8")

    removed = store.cleanup_expired_jobs(now=datetime.now(UTC))

    assert removed == []
    assert (broken_dir / "job.json").exists()
