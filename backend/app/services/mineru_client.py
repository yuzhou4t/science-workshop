import asyncio
import logging
import shutil
import stat
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from uuid import uuid4

import httpx


MAX_ZIP_FILES = 200
MAX_ZIP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024
COS_SIGNED_URL_EXPIRES_SECONDS = 3600
MINERU_MAX_ATTEMPTS = 3
MINERU_RETRY_DELAY_SECONDS = 1

RETRYABLE_MINERU_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MineruResult:
    markdown: str
    assets: list[Path]


@dataclass(frozen=True)
class CosUpload:
    file_url: str
    object_key: str


def _extract_task_id(body: object) -> str:
    if not isinstance(body, dict):
        raise RuntimeError("MinerU task response missing task_id")
    if body.get("code") != 0:
        message = body.get("msg")
        raise RuntimeError(message if isinstance(message, str) and message else "MinerU task creation failed")
    data = body.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("MinerU task response missing task_id")
    task_id = data.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError("MinerU task response missing task_id")
    return task_id


def _parse_task_state(body: object) -> str | None:
    if not isinstance(body, dict):
        raise RuntimeError("MinerU task query failed")
    if body.get("code") != 0:
        message = body.get("msg")
        raise RuntimeError(message if isinstance(message, str) and message else "MinerU task query failed")
    data = body.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("MinerU task response missing task data")

    state = data.get("state")
    if state == "done":
        zip_url = data.get("full_zip_url")
        if not isinstance(zip_url, str) or not zip_url:
            raise RuntimeError("MinerU task response missing result URL")
        return zip_url
    if state == "failed":
        message = data.get("err_msg")
        raise RuntimeError(message if isinstance(message, str) and message else "MinerU task failed")
    return None


def _validate_zip_members(
    members: list[zipfile.ZipInfo],
    *,
    max_files: int,
    max_uncompressed_bytes: int,
) -> None:
    file_count = 0
    total_size = 0
    for member in members:
        name = member.filename
        path = PurePosixPath(name)
        if not name or path.is_absolute() or ".." in path.parts:
            raise RuntimeError("MinerU zip contains unsafe path")
        if member.is_dir():
            continue
        mode = member.external_attr >> 16
        file_type = stat.S_IFMT(mode)
        if file_type and not stat.S_ISREG(mode):
            raise RuntimeError("MinerU zip contains unsupported entry type")
        file_count += 1
        if file_count > max_files:
            raise RuntimeError("MinerU zip contains too many files")
        total_size += member.file_size
        if total_size > max_uncompressed_bytes:
            raise RuntimeError("MinerU zip is too large")


def _extract_mineru_zip(
    zip_path: Path,
    extract_dir: Path,
    *,
    max_files: int = MAX_ZIP_FILES,
    max_uncompressed_bytes: int = MAX_ZIP_UNCOMPRESSED_BYTES,
) -> None:
    with zipfile.ZipFile(zip_path, "r") as archive:
        members = archive.infolist()
        _validate_zip_members(
            members,
            max_files=max_files,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )
        extract_dir.mkdir(parents=True, exist_ok=True)
        for member in members:
            if member.is_dir():
                continue
            target_path = extract_dir.joinpath(*PurePosixPath(member.filename).parts)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member, "r") as source, target_path.open("wb") as destination:
                shutil.copyfileobj(source, destination)


class MineruClient:
    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://mineru.net",
        use_mock: bool = False,
        cos_secret_id: str = "",
        cos_secret_key: str = "",
        cos_region: str = "ap-guangzhou",
        cos_bucket: str = "",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.use_mock = use_mock
        self.cos_secret_id = cos_secret_id
        self.cos_secret_key = cos_secret_key
        self.cos_region = cos_region
        self.cos_bucket = cos_bucket

    async def parse_pdf_to_markdown(self, pdf_path: Path) -> MineruResult:
        if self.use_mock:
            return MineruResult(
                markdown="# Mock Extracted Paper\n\nThis is mock MinerU Markdown.",
                assets=[],
            )
        if not self.api_key:
            raise RuntimeError("MINERU_API_KEY is required when mock mode is disabled")
        upload_result: CosUpload | None = None
        try:
            upload_result = await self._upload_to_cos(pdf_path)
            task_id = await self._create_task(upload_result.file_url)
            zip_url = await self._wait_for_completion(task_id)
            return await self._download_and_extract(zip_url, pdf_path.parent / "mineru_assets")
        finally:
            if upload_result is not None:
                try:
                    await self._delete_cos_object(upload_result.object_key)
                except Exception:
                    logger.warning("Failed to delete temporary MinerU COS object")

    def _cos_object_key(self, pdf_path: Path) -> str:
        return f"mineru/{uuid4().hex}.pdf"

    def _cos_client(self):
        from qcloud_cos import CosConfig, CosS3Client

        config = CosConfig(
            Region=self.cos_region,
            SecretId=self.cos_secret_id,
            SecretKey=self.cos_secret_key,
            Token=None,
            Scheme="https",
        )
        return CosS3Client(config)

    async def _upload_to_cos(self, pdf_path: Path) -> CosUpload:
        if not all([self.cos_secret_id, self.cos_secret_key, self.cos_bucket]):
            raise RuntimeError("Tencent COS settings are required for MinerU parsing")

        object_key = self._cos_object_key(pdf_path)
        client = self._cos_client()
        if not hasattr(client, "get_presigned_url"):
            raise RuntimeError("Tencent COS client does not support signed URLs")

        def upload_sync() -> str:
            with pdf_path.open("rb") as file_obj:
                client.put_object(
                    Bucket=self.cos_bucket,
                    Body=file_obj.read(),
                    Key=object_key,
                    ContentType="application/pdf",
                )
            return client.get_presigned_url(
                Method="GET",
                Bucket=self.cos_bucket,
                Key=object_key,
                Expired=COS_SIGNED_URL_EXPIRES_SECONDS,
            )

        file_url = await asyncio.get_running_loop().run_in_executor(None, upload_sync)
        return CosUpload(file_url=file_url, object_key=object_key)

    async def _delete_cos_object(self, object_key: str) -> None:
        if not all([self.cos_secret_id, self.cos_secret_key, self.cos_bucket]):
            return

        client = self._cos_client()

        def delete_sync() -> None:
            client.delete_object(Bucket=self.cos_bucket, Key=object_key)

        await asyncio.get_running_loop().run_in_executor(None, delete_sync)

    async def _create_task(self, file_url: str) -> str:
        payload = {
            "url": file_url,
            "model_version": "vlm",
            "enable_formula": True,
            "enable_table": True,
            "language": "ch",
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await self._request_with_retries(
                lambda: client.post(f"{self.base_url}/api/v4/extract/task", headers=headers, json=payload)
            )
            body = response.json()
            return _extract_task_id(body)

    async def _wait_for_completion(self, task_id: str, max_wait: int = 300) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        started = time.time()
        async with httpx.AsyncClient(timeout=30.0) as client:
            while time.time() - started < max_wait:
                response = await self._request_with_retries(
                    lambda: client.get(f"{self.base_url}/api/v4/extract/task/{task_id}", headers=headers)
                )
                body = response.json()
                zip_url = _parse_task_state(body)
                if zip_url is not None:
                    return zip_url
                await asyncio.sleep(5)
        raise TimeoutError("MinerU task timed out")

    async def _download_and_extract(self, zip_url: str, asset_dir: Path) -> MineruResult:
        asset_dir.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await self._request_with_retries(lambda: client.get(zip_url))
        zip_path = asset_dir / "mineru_result.zip"
        zip_path.write_bytes(response.content)
        extract_dir = asset_dir / "extracted"
        _extract_mineru_zip(zip_path, extract_dir)
        markdown_paths = list(extract_dir.glob("**/*.md"))
        markdown = markdown_paths[0].read_text(encoding="utf-8") if markdown_paths else ""
        assets = [
            path
            for path in extract_dir.glob("**/*")
            if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg"}
        ]
        return MineruResult(markdown=markdown, assets=assets)

    async def _request_with_retries(self, request_factory) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(1, MINERU_MAX_ATTEMPTS + 1):
            try:
                response = await request_factory()
                response.raise_for_status()
                return response
            except RETRYABLE_MINERU_ERRORS as exc:
                last_error = exc
                if attempt == MINERU_MAX_ATTEMPTS:
                    break
                await asyncio.sleep(MINERU_RETRY_DELAY_SECONDS)
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text[:300] if exc.response is not None else ""
                message = f"MinerU request failed: HTTP {exc.response.status_code}"
                if detail:
                    message = f"{message}: {detail}"
                raise RuntimeError(message) from exc
        error_name = type(last_error).__name__ if last_error is not None else "UnknownError"
        raise RuntimeError(f"MinerU request failed: {error_name}") from last_error
