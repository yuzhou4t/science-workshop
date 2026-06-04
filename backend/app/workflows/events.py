import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass(frozen=True)
class WorkflowEvent:
    job_id: str
    event: str
    node_id: str
    message: str
    progress: float
    data: dict[str, Any]
    created_at: str

    def to_sse(self) -> str:
        return f"event: {self.event}\ndata: {json.dumps(self.__dict__, ensure_ascii=False)}\n\n"


class EventBroker:
    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue[WorkflowEvent]]] = defaultdict(set)

    async def publish(
        self,
        job_id: str,
        event: str,
        node_id: str,
        message: str,
        progress: float,
        data: dict[str, Any] | None = None,
    ) -> WorkflowEvent:
        item = WorkflowEvent(
            job_id=job_id,
            event=event,
            node_id=node_id,
            message=message,
            progress=progress,
            data=data or {},
            created_at=datetime.now(UTC).isoformat(),
        )
        for queue in list(self._queues[job_id]):
            await queue.put(item)
        return item

    async def subscribe(self, job_id: str):
        queue: asyncio.Queue[WorkflowEvent] = asyncio.Queue()
        self._queues[job_id].add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._queues[job_id].discard(queue)
