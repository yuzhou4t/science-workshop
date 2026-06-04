import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pydantic import ValidationError

from app.models.job import Artifact, NodeState, NodeStatus, WorkflowJob, WorkflowType


class JobNotFoundError(Exception):
    pass


class JobStore:
    def __init__(self, root: Path, retention_days: int) -> None:
        self.root = root.resolve()
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
        return self._safe_job_dir(job_id)

    def _safe_job_dir(self, job_id: str) -> Path:
        path = (self.root / job_id).resolve()
        if Path(job_id).name != job_id or path.parent != self.root:
            raise JobNotFoundError(job_id)
        return path

    def _artifact_path(self, job: WorkflowJob, relative_path: str) -> Path:
        requested_path = Path(relative_path)
        if requested_path.is_absolute():
            raise ValueError("Artifact path must be relative")
        root = self.job_dir(job.job_id).resolve()
        path = (root / requested_path).resolve()
        if root not in path.parents:
            raise ValueError("Artifact path must stay inside the job directory")
        return path

    def save_job(self, job: WorkflowJob) -> None:
        job.updated_at = datetime.now(UTC)
        job_dir = self.job_dir(job.job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "job.json").write_text(job.model_dump_json(indent=2), encoding="utf-8")

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
        path = self._artifact_path(job, relative_path)
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
            try:
                job = WorkflowJob.model_validate_json(job_file.read_text(encoding="utf-8"))
            except (OSError, ValidationError, ValueError):
                continue
            if job.expires_at <= current_time:
                try:
                    shutil.rmtree(job_file.parent)
                except OSError:
                    continue
                removed.append(job.job_id)
        return removed
