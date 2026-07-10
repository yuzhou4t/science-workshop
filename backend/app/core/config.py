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
    workflow_max_running_jobs: int = Field(default=3, alias="WORKFLOW_MAX_RUNNING_JOBS", gt=0)
    workflow_paper_reading_max_running_jobs: int = Field(
        default=1,
        alias="WORKFLOW_PAPER_READING_MAX_RUNNING_JOBS",
        gt=0,
    )
    workflow_wechat_writing_max_running_jobs: int = Field(
        default=2,
        alias="WORKFLOW_WECHAT_WRITING_MAX_RUNNING_JOBS",
        gt=0,
    )
    workflow_max_running_jobs_per_user: int = Field(default=1, alias="WORKFLOW_MAX_RUNNING_JOBS_PER_USER", gt=0)
    workflow_max_queued_jobs_per_user: int = Field(default=2, alias="WORKFLOW_MAX_QUEUED_JOBS_PER_USER", ge=0)
    workflow_paper_reading_daily_quota_per_user: int = Field(
        default=3,
        alias="WORKFLOW_PAPER_READING_DAILY_QUOTA_PER_USER",
        gt=0,
    )
    workflow_wechat_writing_daily_quota_per_user: int = Field(
        default=10,
        alias="WORKFLOW_WECHAT_WRITING_DAILY_QUOTA_PER_USER",
        gt=0,
    )
    workflow_quota_timezone: str = Field(default="Asia/Shanghai", alias="WORKFLOW_QUOTA_TIMEZONE")
    science_workshop_proxy_secret: str = Field(default="", alias="SCIENCE_WORKSHOP_PROXY_SECRET")
    workflow_allow_insecure_direct_access: bool = Field(
        default=False,
        alias="WORKFLOW_ALLOW_INSECURE_DIRECT_ACCESS",
    )
    science_workshop_runtime_sources_path: Path | None = Field(
        default=None,
        alias="SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH",
    )
    paper_reading_max_upload_bytes: int = Field(
        default=25 * 1024 * 1024,
        alias="PAPER_READING_MAX_UPLOAD_BYTES",
        gt=0,
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
