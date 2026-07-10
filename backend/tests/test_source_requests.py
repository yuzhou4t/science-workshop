import time
import json
import ipaddress
from io import BytesIO
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.api import source_requests
from app.services import source_intake


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


def test_source_request_duplicate_is_not_persisted_or_requeued(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    scheduled: list[str] = []
    monkeypatch.setattr(source_requests, "schedule_probe", lambda _path, request_id: scheduled.append(request_id))
    payload = {
        "journal_name": "重复测试期刊",
        "feed_url": "https://example.com/duplicate-feed.xml",
    }
    headers = {"x-workshop-user": "reader", "x-workshop-role": "user"}

    first = client.post("/api/source-requests", json=payload, headers=headers)
    duplicate = client.post("/api/source-requests", json=payload, headers=headers)

    assert first.status_code == 200
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    assert duplicate.json()["request"]["request_id"] == first.json()["request"]["request_id"]
    assert scheduled == [first.json()["request"]["request_id"]]
    records = client.get(
        "/api/source-requests",
        headers={"x-workshop-user": "admin", "x-workshop-role": "admin"},
    ).json()["requests"]
    assert len(records) == 1


def test_cross_user_duplicate_response_does_not_expose_original_submitter_or_notes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scheduled: list[str] = []
    monkeypatch.setattr(source_requests, "schedule_probe", lambda _path, request_id: scheduled.append(request_id))
    payload = {
        "journal_name": "跨用户重复期刊",
        "feed_url": "https://example.com/shared-feed.xml",
        "notes": "原提交者的私密备注",
    }
    first = client.post(
        "/api/source-requests",
        json=payload,
        headers={"x-workshop-user": "first-reader", "x-workshop-role": "user"},
    )
    duplicate = client.post(
        "/api/source-requests",
        json={**payload, "notes": "第二个用户自己的备注"},
        headers={"x-workshop-user": "second-reader", "x-workshop-role": "user"},
    )

    assert first.status_code == 200
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    duplicate_request = duplicate.json()["request"]
    assert duplicate_request == {
        "request_id": first.json()["request"]["request_id"],
        "intake_status": "pending_auto_probe",
        "journal_name": "跨用户重复期刊",
    }
    assert scheduled == [first.json()["request"]["request_id"]]


def test_source_request_limits_each_users_pending_probes(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    scheduled: list[str] = []
    monkeypatch.setattr(source_requests, "schedule_probe", lambda _path, request_id: scheduled.append(request_id))
    reader_headers = {"x-workshop-user": "reader", "x-workshop-role": "user"}

    for index in range(5):
        response = client.post(
            "/api/source-requests",
            json={"journal_name": f"待探测期刊 {index}", "feed_url": f"https://example.com/feed-{index}.xml"},
            headers=reader_headers,
        )
        assert response.status_code == 200

    blocked = client.post(
        "/api/source-requests",
        json={"journal_name": "超出上限", "feed_url": "https://example.com/feed-over-limit.xml"},
        headers=reader_headers,
    )
    another_user = client.post(
        "/api/source-requests",
        json={"journal_name": "其他用户期刊", "feed_url": "https://example.com/another-user.xml"},
        headers={"x-workshop-user": "another-reader", "x-workshop-role": "user"},
    )

    assert blocked.status_code == 429
    assert "5" in blocked.json()["detail"]
    assert another_user.status_code == 200
    assert len(scheduled) == 6


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


def test_source_request_probe_status_and_admin_decision_write_runtime_registry(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source_requests, "schedule_probe", lambda _path, _request_id: None)
    created = client.post(
        "/api/source-requests",
        json={
            "journal_name": "可批准期刊",
            "issn": "1234-567X",
            "feed_url": "https://example.com/feed.xml",
        },
        headers={"x-workshop-user": "reader", "x-workshop-role": "user"},
    )
    assert created.status_code == 200
    request_id = created.json()["request"]["request_id"]
    path = client.app.state.settings.workflow_storage_dir.resolve() / "source-requests.jsonl"
    source_intake.update_record(
        path,
        request_id,
        intake_status="probe_succeeded",
        probe_report={
            "eligible_for_approval": True,
            "candidate_type": "RSS / Atom",
            "http_status": 200,
            "final_url": "https://example.com/feed.xml",
        },
    )

    denied = client.post(
        f"/api/source-requests/{request_id}/decision",
        json={"decision": "approve"},
        headers={"x-workshop-user": "reader", "x-workshop-role": "user"},
    )
    assert denied.status_code == 403

    approved = client.post(
        f"/api/source-requests/{request_id}/decision",
        json={"decision": "approve"},
        headers={"x-workshop-user": "admin", "x-workshop-role": "admin"},
    )
    assert approved.status_code == 200
    assert approved.json()["request"]["intake_status"] == "approved"
    runtime_path = client.app.state.settings.science_workshop_runtime_sources_path
    assert runtime_path.exists()
    assert runtime_path.read_text(encoding="utf-8").find("可批准期刊") >= 0

    again = client.post(
        f"/api/source-requests/{request_id}/decision",
        json={"decision": "approve"},
        headers={"x-workshop-user": "admin", "x-workshop-role": "admin"},
    )
    assert again.status_code == 200
    assert again.json()["idempotent"] is True


def test_source_import_preview_and_commit_keep_rows_pending(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source_requests, "schedule_probe", lambda _path, _request_id: None)
    csv_body = "期刊名称,ISSN,官网地址,订阅地址\n导入期刊,1234-567X,https://example.com,https://example.com/feed.xml\n"
    headers = {"x-workshop-user": "admin", "x-workshop-role": "admin"}
    preview = client.post(
        "/api/sources/import?mode=preview",
        files={"file": ("sources.csv", csv_body.encode("utf-8-sig"), "text/csv")},
        headers=headers,
    )
    assert preview.status_code == 200
    assert preview.json()["mode"] == "preview"
    assert preview.json()["valid_rows"] == 1
    assert preview.json()["valid_count"] == 1
    assert preview.json()["error_count"] == 0
    assert preview.json()["rows"][0]["journal_name"] == "导入期刊"
    log_path = client.app.state.settings.workflow_storage_dir.resolve() / "source-requests.jsonl"
    assert not log_path.exists()

    committed = client.post(
        "/api/sources/import?mode=commit",
        files={"file": ("sources.csv", csv_body.encode("utf-8-sig"), "text/csv")},
        headers=headers,
    )
    assert committed.status_code == 200
    assert committed.json()["requests_created"] == 1
    assert committed.json()["batch_id"]
    assert committed.json()["requests"][0]["intake_status"] == "pending_auto_probe"


def test_source_probe_rejects_loopback_and_large_redirect_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="private|loopback|reserved"):
        source_intake.validate_probe_url("http://127.0.0.1:8000/feed")

    class RedirectResponse:
        status_code = 302
        headers = {"location": "http://127.0.0.1:8000/feed"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class RedirectClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def stream(self, *_args, **_kwargs):
            return RedirectResponse()

    def resolve_redirect_target(hostname: str):
        if hostname == "127.0.0.1":
            raise ValueError("private, loopback or reserved address is not allowed")
        return [ipaddress.ip_address("93.184.216.34")]

    monkeypatch.setattr(source_intake.httpx, "Client", lambda **_kwargs: RedirectClient())
    monkeypatch.setattr(source_intake, "_host_ips", resolve_redirect_target)
    with pytest.raises(ValueError, match="private|loopback|reserved"):
        source_intake._fetch_limited("https://public.example/feed")


def test_source_probe_connects_to_the_prevalidated_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    public_ip = ipaddress.ip_address("93.184.216.34")
    monkeypatch.setattr(source_intake, "_host_ips", lambda _hostname: [public_ip])

    class Response:
        status_code = 200
        headers = {"content-type": "text/plain"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def iter_bytes(self):
            yield b"ok"

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def stream(self, method, url, **kwargs):
            captured.update({"method": method, "url": url, **kwargs})
            return Response()

    monkeypatch.setattr(source_intake.httpx, "Client", lambda **_kwargs: Client())

    status, final_url, _content_type, body, _redirects = source_intake._fetch_limited(
        "https://public.example/feed?format=rss"
    )

    assert status == 200
    assert final_url == "https://public.example/feed?format=rss"
    assert body == b"ok"
    assert captured["url"] == "https://93.184.216.34/feed?format=rss"
    assert captured["headers"] == {"Host": "public.example"}
    assert captured["extensions"] == {"sni_hostname": "public.example"}


def test_source_probe_stops_streaming_response_at_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    class LargeResponse:
        status_code = 200
        headers = {"content-type": "application/rss+xml"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def iter_bytes(self):
            yield b"x" * (source_intake.MAX_PROBE_BYTES + 1)

    class LargeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def stream(self, *_args, **_kwargs):
            return LargeResponse()

    monkeypatch.setattr(source_intake.httpx, "Client", lambda **_kwargs: LargeClient())
    monkeypatch.setattr(source_intake, "_host_ips", lambda _hostname: [ipaddress.ip_address("93.184.216.34")])
    with pytest.raises(ValueError, match="size limit"):
        source_intake._fetch_limited("https://public.example/feed")


def test_source_probe_can_use_fixed_issn_metadata_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_fetch(url: str):
        return 200, url, "application/json", json.dumps({"message": {"items": [{"title": ["开放元数据样例"]}]}}).encode(), []

    monkeypatch.setattr(source_intake, "_fetch_limited", fake_fetch)
    report = source_intake.probe_source({"journal_name": "ISSN 期刊", "issn": "1234-567X"})
    assert report["eligible_for_approval"] is True
    assert report["candidate_type"] == "开放元数据（Crossref）"
    assert report["sample_articles"] == ["开放元数据样例"]


def test_source_request_probe_and_retry_state(client: TestClient, monkeypatch) -> None:
    """A durable pending record is queued, then transitions without blocking submit."""
    from app.services import source_intake

    monkeypatch.setattr(
        source_intake,
        "probe_source",
        lambda record: {
            "checked_at": "now",
            "candidate_type": "RSS / Atom",
            "eligible_for_approval": True,
            "sample_articles": ["样例"],
            "failure_reason": "",
        },
    )
    created = client.post(
        "/api/source-requests",
        json={"journal_name": "可探测期刊", "feed_url": "https://example.com/feed.xml"},
        headers={"x-workshop-user": "reader", "x-workshop-role": "user"},
    )
    assert created.status_code == 200
    assert created.json()["request"]["intake_status"] == "pending_auto_probe"
    request_id = created.json()["request"]["request_id"]
    admin_headers = {"x-workshop-user": "admin", "x-workshop-role": "admin"}
    for _ in range(30):
        listed = client.get("/api/source-requests", headers=admin_headers).json()["requests"]
        current = next(item for item in listed if item["request_id"] == request_id)
        if current["intake_status"] == "probe_succeeded":
            break
        time.sleep(0.01)
    assert current["intake_status"] == "probe_succeeded"
    assert current["probe_report"]["eligible_for_approval"] is True


def test_source_probe_resume_requeues_pending_and_interrupted_requests(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "source-requests.jsonl"
    source_intake.append_record(path, {"request_id": "pending", "intake_status": "pending_auto_probe"})
    source_intake.append_record(path, {"request_id": "interrupted", "intake_status": "probing"})
    source_intake.append_record(path, {"request_id": "approved", "intake_status": "approved"})
    scheduled: list[str] = []
    monkeypatch.setattr(source_intake, "schedule_probe", lambda _path, request_id: scheduled.append(request_id))

    assert source_intake.resume_pending_probes(path) == 2
    assert scheduled == ["pending", "interrupted"]
    records = {record["request_id"]: record for record in source_intake.read_records(path)}
    assert records["pending"]["intake_status"] == "pending_auto_probe"
    assert records["interrupted"]["intake_status"] == "pending_auto_probe"
    assert records["approved"]["intake_status"] == "approved"


def test_source_import_preview_and_commit(client: TestClient) -> None:
    headers = {"x-workshop-user": "admin", "x-workshop-role": "admin"}
    csv_content = "期刊名称,ISSN,官网地址\n导入期刊,1234-567X,https://example.com\n"
    preview = client.post(
        "/api/sources/import?mode=preview",
        files={"file": ("sources.csv", csv_content.encode("utf-8-sig"), "text/csv")},
        headers=headers,
    )
    assert preview.status_code == 200
    assert preview.json()["valid_rows"] == 1
    assert preview.json()["batch_id"] if "batch_id" in preview.json() else True
    assert client.get("/api/source-requests", headers=headers).json()["requests"] == []

    committed = client.post(
        "/api/sources/import?mode=commit",
        files={"file": ("sources.csv", csv_content.encode("utf-8-sig"), "text/csv")},
        headers=headers,
    )
    assert committed.status_code == 200
    body = committed.json()
    assert body["requests_created"] == 1
    assert body["batch_id"]
    assert body["requests"][0]["intake_status"] == "pending_auto_probe"


def test_source_import_invalid_row_does_not_commit(client: TestClient) -> None:
    headers = {"x-workshop-user": "admin", "x-workshop-role": "admin"}
    response = client.post(
        "/api/sources/import?mode=commit",
        files={"file": ("sources.csv", "journal_name,homepage_url\n坏地址,http://[\n", "text/csv")},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["requests_created"] == 0
    assert client.get("/api/source-requests", headers=headers).json()["requests"] == []


def test_source_import_xlsx_reads_first_sheet(client: TestClient) -> None:
    stream = BytesIO()
    files = {
        "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'.encode(),
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'.encode(),
        "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>期刊名称</t></is></c><c r="B1" t="inlineStr"><is><t>ISSN</t></is></c><c r="C1" t="inlineStr"><is><t>官网地址</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>XLSX 期刊</t></is></c><c r="B2" t="inlineStr"><is><t>1234-567X</t></is></c><c r="C2" t="inlineStr"><is><t>https://example.com</t></is></c></row></sheetData></worksheet>'.encode(),
    }
    with zipfile.ZipFile(stream, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    response = client.post(
        "/api/sources/import?mode=preview",
        files={"file": ("sources.xlsx", stream.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers={"x-workshop-user": "admin", "x-workshop-role": "admin"},
    )
    assert response.status_code == 200
    assert response.json()["valid_rows"] == 1
