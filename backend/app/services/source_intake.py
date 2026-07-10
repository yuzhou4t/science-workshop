"""Source contribution persistence, probing and import helpers.

The source request log is deliberately small and JSON based.  It is shared by
the FastAPI admin inbox and the local Node crawler, so updates are written by
replace rather than by mutating a partially-written file.
"""

from __future__ import annotations

import csv
import io
import ipaddress
import json
import os
import re
import socket
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET

import httpx


MAX_IMPORT_BYTES = 2 * 1024 * 1024
MAX_IMPORT_ROWS = 500
MAX_PROBE_BYTES = 2 * 1024 * 1024
PROBE_TIMEOUT = httpx.Timeout(8.0, connect=3.0)
MAX_REDIRECTS = 4
MAX_PENDING_PROBES_PER_USER = 5
PENDING_PROBE_STATUSES = {"pending_auto_probe", "probing"}

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="source-probe")
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def _lock_for(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _locks_guard:
        return _locks.setdefault(key, threading.RLock())


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def read_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    result: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                result.append(value)
    return result


def append_record(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_for(path):
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def update_record(path: Path, request_id: str, **changes: Any) -> dict[str, Any] | None:
    """Atomically replace one record and return the resulting record."""
    with _lock_for(path):
        records = read_records(path)
        found: dict[str, Any] | None = None
        for record in records:
            if record.get("request_id") == request_id:
                record.update(changes)
                found = record
                break
        if found is None:
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        tmp.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in records), encoding="utf-8")
        os.replace(tmp, path)
        return found


def runtime_sources_path(settings: Any) -> Path:
    configured = getattr(settings, "science_workshop_runtime_sources_path", None)
    if configured:
        return Path(configured).expanduser().resolve()
    # backend/app/services/source_intake.py -> repository root/data
    return Path(__file__).resolve().parents[3] / "data" / "community-sources.json"


def append_runtime_source(settings: Any, record: dict[str, Any]) -> dict[str, Any]:
    """Atomically add an approved source to the Node-readable runtime registry."""
    path = runtime_sources_path(settings)
    with _lock_for(path):
        existing: list[dict[str, Any]] = []
        if path.exists():
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(value, list):
                    existing = value
                elif isinstance(value, dict):
                    existing = value.get("sources", [])
                else:
                    existing = []
                existing = [item for item in existing if isinstance(item, dict)]
            except (json.JSONDecodeError, OSError):
                existing = []
        key = source_identity_values(record)
        duplicate = next((item for item in existing if key and key.intersection(source_identity_values(item))), None)
        if duplicate is not None:
            return duplicate
        probe_report = record.get("probe_report") if isinstance(record.get("probe_report"), dict) else {}
        candidate_type = record.get("candidate_type") or probe_report.get("candidate_type", "")
        source_url = record.get("source_url") or probe_report.get("final_url", "")
        source = {
            "source_id": record.get("request_id"),
            "request_id": record.get("request_id"),
            "status": "approved",
            "decision": "approved",
            "journal_name": record.get("journal_name", ""),
            "issn": record.get("issn", ""),
            "homepage_url": record.get("homepage_url", ""),
            "archive_url": record.get("archive_url", ""),
            "sample_article_url": record.get("sample_article_url", ""),
            "feed_url": record.get("feed_url", ""),
            "source_url": source_url,
            "candidate_type": candidate_type,
            "probe_report": probe_report,
            "source_type": record.get("source_type", "自动识别"),
            "refresh_interval": record.get("refresh_interval", "每周检查"),
            "notes": record.get("notes", ""),
            "approved_at": record.get("decided_at", utc_now()),
        }
        existing.append(source)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        return source


def source_key(record: dict[str, Any]) -> tuple[str, str, str, str]:
    def norm(value: Any) -> str:
        return str(value or "").strip().lower().rstrip("/")

    return (
        norm(record.get("issn")),
        norm(record.get("feed_url")),
        norm(record.get("homepage_url")),
        norm(record.get("journal_name")),
    )


def source_identity_values(record: dict[str, Any]) -> set[str]:
    """Stable identifiers used to detect duplicate submissions."""
    def norm(value: Any) -> str:
        return str(value or "").strip().lower().rstrip("/")

    values: set[str] = set()
    for field in ("issn", "feed_url", "homepage_url", "archive_url", "sample_article_url"):
        value = norm(record.get(field))
        if value:
            values.add(f"{field}:{value}")
    if not values:
        journal = norm(record.get("journal_name"))
        if journal:
            values.add(f"journal:{journal}")
    return values


def append_pending_source_request(path: Path, record: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """Atomically deduplicate and cap public pending probe work per submitter."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_for(path):
        existing = read_records(path)
        identity = source_identity_values(record)
        duplicate = next(
            (item for item in existing if identity and identity.intersection(source_identity_values(item))),
            None,
        )
        if duplicate is not None:
            return "duplicate", duplicate

        submitter = str(record.get("submitter") or "anonymous")
        pending_count = sum(
            1
            for item in existing
            if str(item.get("submitter") or "anonymous") == submitter
            and item.get("intake_status") in PENDING_PROBE_STATUSES
        )
        if pending_count >= MAX_PENDING_PROBES_PER_USER:
            return "limit", None

        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        return "created", record


def _host_ips(hostname: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    if hostname.lower() in {"localhost", "localhost.localdomain"}:
        raise ValueError("localhost is not allowed")
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"DNS lookup failed: {exc}") from exc
    addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in infos:
        try:
            addresses.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    if not addresses:
        raise ValueError("DNS lookup returned no address")
    for address in addresses:
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast or address.is_unspecified:
            raise ValueError("private, loopback or reserved address is not allowed")
    return addresses


def validate_probe_url(url: str) -> str:
    _validated_probe_target(url)
    return url


def _validated_probe_target(url: str) -> tuple[str, dict[str, str], dict[str, str]]:
    """Resolve once, then connect to that exact public address.

    Resolving for validation and letting the HTTP client resolve again leaves a
    DNS-rebinding window.  The request therefore uses a validated IP as its
    transport target while retaining the original Host header and TLS SNI.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("only public http(s) URLs are allowed")
    if parsed.port and not (1 <= parsed.port <= 65535):
        raise ValueError("invalid URL port")
    addresses = _host_ips(parsed.hostname)
    address = next((item for item in addresses if isinstance(item, ipaddress.IPv4Address)), addresses[0])
    pinned_host = f"[{address}]" if isinstance(address, ipaddress.IPv6Address) else str(address)
    pinned_authority = f"{pinned_host}:{parsed.port}" if parsed.port is not None else pinned_host
    pinned_url = parsed._replace(netloc=pinned_authority).geturl()

    original_host = parsed.hostname.encode("idna").decode("ascii")
    host_header = f"[{original_host}]" if ":" in original_host else original_host
    if parsed.port is not None:
        host_header = f"{host_header}:{parsed.port}"
    extensions = {"sni_hostname": original_host} if parsed.scheme == "https" else {}
    return pinned_url, {"Host": host_header}, extensions


def _fetch_limited(url: str) -> tuple[int, str, str, bytes, list[dict[str, Any]]]:
    current = url
    redirects: list[dict[str, Any]] = []
    with httpx.Client(timeout=PROBE_TIMEOUT, follow_redirects=False, trust_env=False, headers={"User-Agent": "ScienceWorkshopSourceProbe/1.0"}) as client:
        for attempt in range(MAX_REDIRECTS + 1):
            pinned_url, headers, extensions = _validated_probe_target(current)
            with client.stream("GET", pinned_url, headers=headers, extensions=extensions) as response:
                status = response.status_code
                location = response.headers.get("location", "")
                redirects.append({"url": current, "status": status, "location": location})
                if status in {301, 302, 303, 307, 308} and location:
                    if attempt >= MAX_REDIRECTS:
                        raise ValueError("too many redirects")
                    current = urljoin(current, location)
                    continue
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > MAX_PROBE_BYTES:
                            raise ValueError("response exceeds probe size limit")
                    except ValueError as exc:
                        if str(exc) == "response exceeds probe size limit":
                            raise
                        raise ValueError("invalid response content length") from exc
                content_type = response.headers.get("content-type", "")
                media_type = content_type.split(";", 1)[0].strip().lower()
                allowed_types = {"", "application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/plain", "application/json", "application/feed+json", "text/html", "application/xhtml+xml"}
                if media_type not in allowed_types:
                    raise ValueError(f"unsupported content type: {media_type}")
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_PROBE_BYTES:
                        raise ValueError("response exceeds probe size limit")
                    chunks.append(chunk)
                return status, current, content_type, b"".join(chunks), redirects
    raise ValueError("unable to fetch URL")


def _is_feed(content_type: str, body: bytes) -> tuple[bool, str]:
    sample = body[:MAX_PROBE_BYTES].lstrip()
    lowered = content_type.lower()
    if "json" in lowered or sample.startswith(b"{"):
        try:
            value = json.loads(sample.decode("utf-8-sig"))
            if isinstance(value, dict) and (value.get("version", "").startswith("https://jsonfeed.org") or isinstance(value.get("items"), list)):
                return True, "JSON Feed"
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    if "xml" in lowered or sample.startswith(b"<"):
        try:
            root = ET.fromstring(sample)
            name = root.tag.rsplit("}", 1)[-1].lower()
            if name in {"rss", "feed", "rdf"} or root.find(".//item") is not None or root.find(".//entry") is not None:
                return True, "RSS / Atom"
        except ET.ParseError:
            pass
    return False, ""


def _discover_feed_links(base_url: str, body: bytes) -> list[str]:
    """Extract only standard HTML alternate-feed links (never arbitrary XPath)."""
    try:
        html = body.decode("utf-8", errors="replace")
    except Exception:
        return []
    discovered: list[str] = []
    for tag in re.findall(r"<link\b[^>]*>", html, flags=re.IGNORECASE):
        rel = re.search(r"\brel\s*=\s*[\"']([^\"']+)", tag, flags=re.IGNORECASE)
        kind = re.search(r"\btype\s*=\s*[\"']([^\"']+)", tag, flags=re.IGNORECASE)
        href = re.search(r"\bhref\s*=\s*[\"']([^\"']+)", tag, flags=re.IGNORECASE)
        if not href or not rel or "alternate" not in rel.group(1).lower().split():
            continue
        media = kind.group(1).lower() if kind else ""
        if media not in {"application/rss+xml", "application/atom+xml", "application/xml", "application/feed+json", "application/json"}:
            continue
        discovered.append(urljoin(base_url, href.group(1).strip()))
    return discovered[:5]


def probe_source(record: dict[str, Any]) -> dict[str, Any]:
    """Probe a source without evaluating arbitrary selectors supplied by users."""
    checked_at = utc_now()
    urls: list[tuple[str, str]] = []
    for name in ("feed_url", "homepage_url", "archive_url", "sample_article_url"):
        value = str(record.get(name) or "").strip()
        if value:
            urls.append((name, value))
    report: dict[str, Any] = {
        "checked_at": checked_at,
        "final_url": "",
        "http_status": None,
        "content_type": "",
        "candidate_type": "",
        "sample_articles": [],
        "failure_reason": "",
        "redirects": [],
        "candidates": [],
        "eligible_for_approval": False,
    }
    failures: list[str] = []
    for field, url in urls:
        try:
            status, final_url, content_type, body, redirects = _fetch_limited(url)
            report["redirects"].extend(redirects)
            report["http_status"] = status
            report["final_url"] = final_url
            report["content_type"] = content_type
            if 200 <= status < 300:
                is_feed, candidate_type = _is_feed(content_type, body)
                if is_feed:
                    report["candidate_type"] = candidate_type
                    report["candidates"].append({"type": candidate_type, "url": final_url, "field": field})
                    report["eligible_for_approval"] = True
                    # Keep a few titles for the inbox without attempting to ingest content.
                    if candidate_type == "RSS / Atom":
                        try:
                            root = ET.fromstring(body)
                            for node in (root.findall(".//item") + root.findall(".//entry") + root.findall(".//{*}item") + root.findall(".//{*}entry"))[:3]:
                                title = node.find("title")
                                if title is None:
                                    title = node.find("{*}title")
                                if title is not None and title.text:
                                    report["sample_articles"].append(title.text.strip())
                        except ET.ParseError:
                            pass
                    else:
                        try:
                            value = json.loads(body.decode("utf-8-sig"))
                            report["sample_articles"] = [str(item.get("title", "")) for item in value.get("items", [])[:3] if isinstance(item, dict) and item.get("title")]
                        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                            pass
                    break
                if field != "feed_url":
                    # A normal homepage/archive often advertises a standards
                    # feed in a <link rel="alternate"> tag. Probe those
                    # addresses through the same redirect and SSRF checks.
                    for discovered_url in _discover_feed_links(final_url, body):
                        try:
                            feed_status, feed_final, feed_type, feed_body, feed_redirects = _fetch_limited(discovered_url)
                            report["redirects"].extend(feed_redirects)
                            feed_ok, candidate_type = _is_feed(feed_type, feed_body)
                            if 200 <= feed_status < 300 and feed_ok:
                                report["http_status"] = feed_status
                                report["final_url"] = feed_final
                                report["content_type"] = feed_type
                                report["candidate_type"] = candidate_type
                                report["candidates"].append({"type": candidate_type, "url": feed_final, "field": "discovered_feed"})
                                report["eligible_for_approval"] = True
                                break
                        except (ValueError, httpx.HTTPError) as exc:
                            failures.append(f"发现的 Feed: {exc}")
                    if report["eligible_for_approval"]:
                        break
                    # A page can be a useful lead, but it must be adapted by a human.
                    report["candidate_type"] = "页面列表（需人工适配）"
                    report["candidates"].append({"type": report["candidate_type"], "url": final_url, "field": field})
                    failures.append("页面未发现标准 Feed，需要人工适配")
                else:
                    failures.append("Feed 响应不是 RSS、Atom 或 JSON Feed")
            else:
                failures.append(f"{field} 返回 HTTP {status}")
        except (ValueError, httpx.HTTPError) as exc:
            failures.append(f"{field}: {exc}")
    # ISSN metadata is queried only against fixed, public provider endpoints;
    # it never evaluates a URL supplied by the contributor.
    issn = str(record.get("issn") or "").strip()
    if issn and not report["eligible_for_approval"]:
        for metadata_url, provider in (
            (f"https://api.crossref.org/journals/{issn}/works?rows=3", "Crossref"),
            (f"https://api.openalex.org/sources/issn:{issn}", "OpenAlex"),
        ):
            try:
                status, final_url, content_type, body, redirects = _fetch_limited(metadata_url)
                report["redirects"].extend(redirects)
                if not (200 <= status < 300):
                    failures.append(f"{provider} 返回 HTTP {status}")
                    continue
                value = json.loads(body.decode("utf-8"))
                items = value.get("message", {}).get("items", []) if provider == "Crossref" else [value]
                if items:
                    report["http_status"] = status
                    report["final_url"] = final_url
                    report["content_type"] = content_type
                    report["candidate_type"] = f"开放元数据（{provider}）"
                    report["candidates"].append({"type": report["candidate_type"], "url": final_url, "field": "issn"})
                    report["sample_articles"] = [str(item.get("title", [""])[0] if isinstance(item.get("title"), list) else item.get("title", "")) for item in items[:3] if isinstance(item, dict) and item.get("title")]
                    report["eligible_for_approval"] = True
                    break
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError, httpx.HTTPError) as exc:
                failures.append(f"{provider}: {exc}")
    if report["eligible_for_approval"]:
        report["failure_reason"] = ""
        return report
    report["failure_reason"] = "; ".join(failures) if failures else "未提供可探测地址"
    return report


def run_probe(path: Path, request_id: str) -> None:
    current = next((item for item in read_records(path) if item.get("request_id") == request_id), None)
    if current is None:
        return
    update_record(path, request_id, intake_status="probing", probe_started_at=utc_now())
    try:
        report = probe_source(current)
        status = "probe_succeeded" if report.get("eligible_for_approval") else ("needs_manual_review" if report.get("candidate_type") else "probe_failed")
        update_record(path, request_id, intake_status=status, probe_report=report, probed_at=utc_now())
    except Exception as exc:  # probing must never kill the worker
        update_record(path, request_id, intake_status="probe_failed", probe_report={"checked_at": utc_now(), "failure_reason": str(exc), "eligible_for_approval": False}, probed_at=utc_now())


def schedule_probe(path: Path, request_id: str) -> None:
    # A tiny delay leaves the durable pending record observable to a caller and
    # keeps the request handler independent of network latency.
    _executor.submit(_delayed_probe, path, request_id)


def resume_pending_probes(path: Path) -> int:
    """Requeue durable requests left pending by a process restart."""
    resumed = 0
    for record in read_records(path):
        if record.get("intake_status") not in {"pending_auto_probe", "probing"}:
            continue
        request_id = str(record.get("request_id") or "")
        if not request_id:
            continue
        update_record(path, request_id, intake_status="pending_auto_probe", resumed_at=utc_now())
        schedule_probe(path, request_id)
        resumed += 1
    return resumed


def _delayed_probe(path: Path, request_id: str) -> None:
    time.sleep(0.01)
    run_probe(path, request_id)


HEADER_ALIASES = {
    "journal_name": {"journal_name", "journal", "期刊名称", "期刊名", "刊名"},
    "issn": {"issn", "国际标准刊号"},
    "homepage_url": {"homepage_url", "homepage", "官网", "官网地址", "主页"},
    "archive_url": {"archive_url", "archive", "过刊页", "过刊地址"},
    "sample_article_url": {"sample_article_url", "sample_article", "样例文章", "样例文章地址"},
    "feed_url": {"feed_url", "feed", "rss", "atom", "订阅地址", "rss地址"},
    "source_type": {"source_type", "类型", "来源类型"},
    "refresh_interval": {"refresh_interval", "刷新频率", "更新频率"},
    "notes": {"notes", "备注", "说明"},
}


def _canonical_headers(headers: list[Any]) -> dict[int, str]:
    result: dict[int, str] = {}
    aliases = {alias.strip().lower(): key for key, values in HEADER_ALIASES.items() for alias in values}
    for index, value in enumerate(headers):
        key = aliases.get(str(value or "").strip().lower())
        if key:
            result[index] = key
    return result


def parse_csv(content: bytes) -> tuple[list[dict[str, str]], list[str]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        return [], [f"CSV 必须是 UTF-8 编码: {exc}"]
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return [], ["文件为空"]
    mapping = _canonical_headers(rows[0])
    if "journal_name" not in mapping.values():
        return [], ["缺少 journal_name/期刊名称 列"]
    result: list[dict[str, str]] = []
    errors: list[str] = []
    for row_number, row in enumerate(rows[1:], 2):
        if not any(str(cell or "").strip() for cell in row):
            continue
        record = {field: str(row[index] if index < len(row) else "").strip() for index, field in mapping.items()}
        record.setdefault("homepage_url", "")
        record.setdefault("feed_url", "")
        result.append(record)
        if len(result) > MAX_IMPORT_ROWS:
            errors.append(f"第 {row_number} 行之后超过 {MAX_IMPORT_ROWS} 行上限")
            break
    return result, errors


def parse_xlsx(content: bytes) -> tuple[list[dict[str, str]], list[str]]:
    """Read the first worksheet without requiring a heavyweight XLSX dependency."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        if any(info.file_size > MAX_IMPORT_BYTES for info in archive.infolist()):
            return [], ["XLSX 解压后单个文件超过大小限制"]
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root:
                shared.append("".join(part.text or "" for part in item.iter() if part.tag.rsplit("}", 1)[-1] == "t"))
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relmap = {item.attrib.get("Id"): item.attrib.get("Target") for item in rels}
        first = next(iter(workbook.findall(".//{*}sheet")), None)
        if first is None:
            return [], ["XLSX 没有工作表"]
        target = relmap.get(first.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"), "worksheets/sheet1.xml")
        sheet_path = target.lstrip("/")
        if not sheet_path.startswith("xl/"):
            sheet_path = "xl/" + sheet_path
        root = ET.fromstring(archive.read(sheet_path))
        rows: list[list[str]] = []
        for row in root.findall(".//{*}row"):
            values: dict[int, str] = {}
            for cell in row.findall("{*}c"):
                ref = cell.attrib.get("r", "A1")
                match = re.match(r"([A-Z]+)", ref)
                if not match:
                    continue
                column = 0
                for char in match.group(1):
                    column = column * 26 + ord(char) - 64
                column -= 1
                value = cell.find("{*}v")
                text = value.text if value is not None and value.text is not None else ""
                if cell.attrib.get("t") == "s" and text.isdigit() and int(text) < len(shared):
                    text = shared[int(text)]
                elif cell.attrib.get("t") == "inlineStr":
                    text = "".join(part.text or "" for part in cell.iter() if part.tag.rsplit("}", 1)[-1] == "t")
                values[column] = text
            rows.append([values.get(index, "") for index in range(max(values.keys(), default=-1) + 1)])
        if not rows:
            return [], ["文件为空"]
        mapping = _canonical_headers(rows[0])
        if "journal_name" not in mapping.values():
            return [], ["缺少 journal_name/期刊名称 列"]
        result = []
        errors: list[str] = []
        for row_number, row in enumerate(rows[1:], 2):
            if not any(str(cell or "").strip() for cell in row):
                continue
            result.append({field: str(row[index] if index < len(row) else "").strip() for index, field in mapping.items()})
            if len(result) > MAX_IMPORT_ROWS:
                errors.append(f"第 {row_number} 行之后超过 {MAX_IMPORT_ROWS} 行上限")
                break
        return result, errors
    except (KeyError, ET.ParseError, zipfile.BadZipFile, ValueError) as exc:
        return [], [f"无法读取 XLSX: {exc}"]


def parse_import(content: bytes, filename: str, content_type: str = "") -> tuple[list[dict[str, str]], list[str]]:
    if len(content) > MAX_IMPORT_BYTES:
        return [], [f"文件超过 {MAX_IMPORT_BYTES // 1024 // 1024} MB 限制"]
    if filename.lower().endswith(".xlsx") or "spreadsheet" in content_type:
        return parse_xlsx(content)
    return parse_csv(content)
