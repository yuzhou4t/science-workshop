import secrets

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import issue_toc_export, jobs, paper_reading, wechat_writing
from app.core.config import get_settings
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.scheduler import WorkflowScheduler

PROTECTED_PREFIXES = ("/api/workflows", "/api/jobs")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Science Workshop Workflow API")
    app.state.settings = settings
    app.state.job_store = JobStore(settings.workflow_storage_dir, settings.workflow_retention_days)
    app.state.event_broker = EventBroker()
    app.state.workflow_scheduler = WorkflowScheduler(app.state.job_store, settings, app.state.event_broker)
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

    @app.middleware("http")
    async def require_proxy_secret(request: Request, call_next):
        proxy_secret = request.app.state.settings.science_workshop_proxy_secret
        if proxy_secret and request.url.path.startswith(PROTECTED_PREFIXES):
            header_secret = request.headers.get("x-science-workshop-proxy-secret", "")
            if not secrets.compare_digest(header_secret, proxy_secret):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

    app.include_router(jobs.router)
    app.include_router(paper_reading.router)
    app.include_router(wechat_writing.router)
    app.include_router(issue_toc_export.router)

    return app


app = create_app()
