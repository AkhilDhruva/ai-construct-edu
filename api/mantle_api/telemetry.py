"""Observability: OpenTelemetry spans for every request and model call (exported over
OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set, e.g. to Langfuse), plus the same steps
persisted as learner events so they sync into the learner's own trace view."""

import os
from datetime import UTC, datetime
from typing import Any

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy import Connection, insert

from .db import events
from .ids import ulid

_configured = False


def setup_tracing(service_name: str) -> trace.Tracer:
    global _configured
    if not _configured:
        provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
        if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)
        _configured = True
    return trace.get_tracer("mantle_api")


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def record_event(
    conn: Connection,
    learner_id: str,
    name: str,
    attributes: dict[str, Any],
    duration_ms: int = 0,
    parent_id: str | None = None,
) -> str:
    """Persist a span in the canonical TelemetryEvent shape the web app renders."""
    eid = ulid()
    start = now_iso()
    payload = {
        "id": eid,
        "learnerId": learner_id,
        "sessionId": "api",
        "name": name,
        "start": start,
        "durationMs": duration_ms,
        "attributes": {k: v for k, v in attributes.items() if isinstance(v, str | int | float | bool)},
    }
    if parent_id:
        payload["parentId"] = parent_id
    conn.execute(insert(events).values(id=eid, learner_id=learner_id, payload=payload, start=start))
    return eid
