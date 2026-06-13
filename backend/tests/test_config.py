from app.core.config import Settings


def test_workflow_retention_defaults_to_three_days() -> None:
    settings = Settings(_env_file=None)

    assert settings.workflow_retention_days == 3
