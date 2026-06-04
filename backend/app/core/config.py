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
    workflow_retention_days: int = Field(default=7, alias="WORKFLOW_RETENTION_DAYS")
    workflow_use_mocks: bool = Field(default=False, alias="WORKFLOW_USE_MOCKS")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
