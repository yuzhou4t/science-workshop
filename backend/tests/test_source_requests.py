import pytest
from fastapi.testclient import TestClient


def test_source_request_submit_and_admin_list(client: TestClient) -> None:
    payload = {
        "journal_name": "测试期刊",
        "homepage_url": "https://example.com",
        "feed_url": "https://example.com/feed.xml",
        "source_type": "RSS / Atom",
        "refresh_interval": "每日检查",
        "notes": "用户提交的共建来源",
    }

    created = client.post(
        "/api/source-requests",
        json=payload,
        headers={"x-workshop-user": "reader", "x-workshop-role": "user"},
    )

    assert created.status_code == 200
    record = created.json()["request"]
    assert record["journal_name"] == "测试期刊"
    assert record["submitter"] == "reader"
    assert record["submitter_role"] == "user"
    assert record["intake_status"] == "pending_auto_probe"
    assert "RSSHub 路由" in record["probe_methods"]
    assert record["request_id"]

    denied = client.get("/api/source-requests", headers={"x-workshop-role": "user"})
    listed = client.get("/api/source-requests", headers={"x-workshop-role": "admin"})

    assert denied.status_code == 403
    assert listed.status_code == 200
    assert listed.json()["requests"][0]["request_id"] == record["request_id"]


def test_source_request_requires_journal_name(client: TestClient) -> None:
    response = client.post("/api/source-requests", json={"journal_name": " "})

    assert response.status_code == 422


@pytest.mark.parametrize(
    "url",
    ["http://[", "http:example.com", "http:///path", "http://example.com\\@evil.test"],
)
def test_source_request_rejects_malformed_urls(client: TestClient, url: str) -> None:
    response = client.post(
        "/api/source-requests",
        json={"journal_name": "测试期刊", "homepage_url": url},
    )

    assert response.status_code == 422
