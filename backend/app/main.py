import secrets

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import issue_toc_export, jobs, paper_reading, source_requests, wechat_drafts, wechat_writing
from app.core.config import get_settings
from app.storage.job_store import JobStore
from app.workflows.events import EventBroker
from app.workflows.scheduler import WorkflowScheduler

PROTECTED_PREFIXES = ("/api/workflows", "/api/jobs", "/api/source-requests", "/api/wechat-drafts")


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
        request.state.proxy_authenticated = False
        if request.url.path.startswith(PROTECTED_PREFIXES):
            settings = request.app.state.settings
            proxy_secret = settings.science_workshop_proxy_secret
            if proxy_secret:
                header_secret = request.headers.get("x-science-workshop-proxy-secret", "")
                if not secrets.compare_digest(header_secret, proxy_secret):
                    return JSONResponse({"detail": "Unauthorized"}, status_code=401)
                if not request.headers.get("x-workshop-user", "").strip():
                    return JSONResponse({"detail": "Authenticated user is required"}, status_code=401)
                request.state.proxy_authenticated = True
            elif not settings.workflow_allow_insecure_direct_access:
                return JSONResponse(
                    {"detail": "Protected API proxy secret is not configured"},
                    status_code=503,
                )
        return await call_next(request)

    app.include_router(jobs.router)
    app.include_router(paper_reading.router)
    app.include_router(wechat_writing.router)
    app.include_router(issue_toc_export.router)
    app.include_router(source_requests.router)
    app.include_router(wechat_drafts.router)

    return app


app = create_app()
