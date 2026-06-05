import asyncio

import httpx

DEEPSEEK_MAX_ATTEMPTS = 3
DEEPSEEK_RETRY_DELAY_SECONDS = 1

RETRYABLE_DEEPSEEK_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
)


def _extract_message_content(data: dict) -> str:
    try:
        choices = data["choices"]
        message = choices[0]["message"]
        content = message["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("DeepSeek response missing message content") from exc
    if not isinstance(content, str):
        raise RuntimeError("DeepSeek response missing message content")
    return content


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str, model: str, use_mock: bool = False) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.use_mock = use_mock

    async def generate(self, node_id: str, prompt: str) -> str:
        if self.use_mock:
            return f"# {node_id}\n\nMock output for prompt length {len(prompt)}."
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is required when mock mode is disabled")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "你是严谨的中文学术编辑，只输出可直接保存的 Markdown。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        last_error: Exception | None = None
        for attempt in range(1, DEEPSEEK_MAX_ATTEMPTS + 1):
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    return _extract_message_content(data)
            except RETRYABLE_DEEPSEEK_ERRORS as exc:
                last_error = exc
                if attempt == DEEPSEEK_MAX_ATTEMPTS:
                    break
                await asyncio.sleep(DEEPSEEK_RETRY_DELAY_SECONDS)
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text[:300] if exc.response is not None else ""
                message = f"DeepSeek request failed: HTTP {exc.response.status_code}"
                if detail:
                    message = f"{message}: {detail}"
                raise RuntimeError(message) from exc
        error_name = type(last_error).__name__ if last_error is not None else "UnknownError"
        raise RuntimeError(f"DeepSeek request failed: {error_name}") from last_error
