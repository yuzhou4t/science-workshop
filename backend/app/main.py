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
