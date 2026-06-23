from fastapi.testclient import TestClient


def test_wechat_draft_import_records_mock_payload(client: TestClient) -> None:
    payload = {
        "title": "【研读非洲｜第X期】测试标题",
        "content_markdown": "# 标题\n\n正文",
        "source_job_id": "job-123",
    }

    created = client.post(
        "/api/wechat-drafts",
        json=payload,
        headers={"x-workshop-user": "reader", "x-workshop-role": "user"},
    )

    assert created.status_code == 200
    draft = created.json()["draft"]
    assert draft["mode"] == "mock"
    assert draft["status"] == "prepared"
    assert draft["submitter"] == "reader"
    assert draft["title"] == payload["title"]
    assert draft["content_markdown"] == payload["content_markdown"]

    denied = client.get("/api/wechat-drafts", headers={"x-workshop-role": "user"})
    listed = client.get("/api/wechat-drafts", headers={"x-workshop-role": "admin"})

    assert denied.status_code == 403
    assert listed.status_code == 200
    assert listed.json()["drafts"][0]["draft_import_id"] == draft["draft_import_id"]


def test_wechat_draft_import_requires_title_and_content(client: TestClient) -> None:
    response = client.post("/api/wechat-drafts", json={"title": "", "content_markdown": ""})

    assert response.status_code == 422
