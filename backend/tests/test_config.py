from app.core.config import Settings


def test_workflow_retention_defaults_to_three_days() -> None:
    settings = Settings(_env_file=None)

    assert settings.workflow_retention_days == 3


def test_workflow_concurrency_defaults_match_workshop_capacity_plan() -> None:
    settings = Settings(_env_file=None)

    assert settings.workflow_max_running_jobs == 3
    assert settings.workflow_paper_reading_max_running_jobs == 1
    assert settings.workflow_wechat_writing_max_running_jobs == 2
    assert settings.workflow_max_running_jobs_per_user == 1
    assert settings.workflow_max_queued_jobs_per_user == 2
    assert settings.workflow_paper_reading_daily_quota_per_user == 3
    assert settings.workflow_wechat_writing_daily_quota_per_user == 10


def test_protected_api_defaults_to_secure_proxy_mode() -> None:
    settings = Settings(_env_file=None)

    assert settings.workflow_allow_insecure_direct_access is False
