"""Storage. The canonical model is stored as JSON documents with key columns, so the
schema can grow without migrations for every new field (the "morphable" model). The
same SQLAlchemy tables run on SQLite (local, tests) and Postgres (production), where
row-level security policies (migrations/postgres) enforce learner isolation in the
database itself; the API also filters by learner in every query."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import (
    JSON,
    Column,
    Connection,
    Engine,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

Doc = JSON().with_variant(JSONB(), "postgresql")
metadata = MetaData()

identities = Table(
    "identities",
    metadata,
    Column("sub", String, primary_key=True),
    Column("learner_id", String(26), nullable=False, unique=True),
    Column("role", String, nullable=False, default="learner"),
    Column("created_at", String, nullable=False),
)
learners = Table(
    "learners",
    metadata,
    Column("id", String(26), primary_key=True),
    Column("learner_id", String(26), nullable=False, index=True),
    Column("payload", Doc, nullable=False),
    Column("updated_at", String, nullable=False),
)
card_states = Table(
    "card_states",
    metadata,
    Column("learner_id", String(26), primary_key=True),
    Column("card_id", String, primary_key=True),
    Column("payload", Doc, nullable=False),
    Column("reviewed_at", String, nullable=False),
)


def _log(name: str, at: str) -> Table:
    return Table(
        name,
        metadata,
        Column("id", String, primary_key=True),
        Column("learner_id", String(26), nullable=False, index=True),
        Column("payload", Doc, nullable=False),
        Column(at, String, nullable=False),
    )


attempts = _log("attempts", "at")
mastery = _log("mastery", "recorded_at")
plans = _log("plans", "generated_at")
events = _log("events", "start")

ai_usage = Table(
    "ai_usage",
    metadata,
    Column("id", String, primary_key=True),
    Column("learner_id", String(26), nullable=False, index=True),
    Column("day", String(10), nullable=False, index=True),
    Column("route", String, nullable=False),
    Column("model", String, nullable=False),
    Column("input_tokens", Integer, nullable=False),
    Column("output_tokens", Integer, nullable=False),
    Column("cache_read_tokens", Integer, nullable=False, default=0),
    Column("cache_write_tokens", Integer, nullable=False, default=0),
    Column("cost_usd", Float, nullable=False),
    Column("latency_ms", Integer, nullable=False),
    Column("rung", Integer, nullable=False),
    Column("at", String, nullable=False),
)
grade_jobs = Table(
    "grade_jobs",
    metadata,
    Column("id", String, primary_key=True),
    Column("learner_id", String(26), nullable=False, index=True),
    Column("drill_id", String, nullable=False),
    Column("status", String, nullable=False),
    Column("request", Doc, nullable=False),
    Column("result", Doc),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
)

LEARNER_TABLES = [learners, card_states, attempts, mastery, plans, events, ai_usage, grade_jobs]


class Database:
    def __init__(self, url: str) -> None:
        self.url = url
        kwargs: dict[str, Any] = {}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        self.engine: Engine = create_engine(url, future=True, **kwargs)
        self.is_postgres = self.engine.dialect.name == "postgresql"
        if url.startswith("sqlite"):

            @event.listens_for(self.engine, "connect")
            def _pragmas(dbapi_conn: Any, _rec: Any) -> None:
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.close()

    def create_all(self) -> None:
        """Local and test databases only. Postgres is migrated with migrations/postgres."""
        metadata.create_all(self.engine)

    @contextmanager
    def scope(
        self, *, sub: str | None = None, learner_id: str | None = None, role: str | None = None
    ) -> Iterator[Connection]:
        """One transaction with the principal set for row-level security. On Postgres the
        policies read these settings; set_config(..., true) scopes them to the transaction."""
        with self.engine.begin() as conn:
            if self.is_postgres:
                conn.execute(text("select set_config('mantle.sub', :v, true)"), {"v": sub or ""})
                conn.execute(text("select set_config('mantle.learner_id', :v, true)"), {"v": learner_id or ""})
                conn.execute(text("select set_config('mantle.role', :v, true)"), {"v": role or ""})
            yield conn
