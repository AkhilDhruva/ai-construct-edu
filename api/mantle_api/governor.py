"""Cost governor and degradation ladder. The budget is checked before a call, not after;
a violation degrades the rung instead of failing the request."""

import statistics
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Connection, func, insert, select

from .db import ai_usage
from .ids import ulid
from .models import ModelReply, Route
from .settings import Settings


class BudgetExceeded(Exception):
    def __init__(self, used: int, limit: int) -> None:
        super().__init__(f"daily AI budget spent: {used} of {limit} tokens")
        self.used, self.limit = used, limit


def today() -> str:
    return datetime.now(UTC).date().isoformat()


@dataclass
class UsageRecord:
    cost_usd: float
    alert: bool
    median_usd: float | None


class Governor:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def tokens_today(self, conn: Connection, learner_id: str) -> int:
        q = select(
            func.coalesce(
                func.sum(
                    ai_usage.c.input_tokens
                    + ai_usage.c.output_tokens
                    + ai_usage.c.cache_read_tokens
                    + ai_usage.c.cache_write_tokens
                ),
                0,
            )
        ).where(ai_usage.c.learner_id == learner_id, ai_usage.c.day == today())
        return int(conn.execute(q).scalar_one())

    def check(self, conn: Connection, learner_id: str, estimate: int) -> None:
        used = self.tokens_today(conn, learner_id)
        if used + estimate > self.s.daily_token_budget:
            raise BudgetExceeded(used, self.s.daily_token_budget)

    def record(self, conn: Connection, learner_id: str, route: Route, reply: ModelReply, rung: int) -> UsageRecord:
        cost = reply.cost_usd()
        recent = [
            r.cost_usd
            for r in conn.execute(
                select(ai_usage.c.cost_usd)
                .where(ai_usage.c.learner_id == learner_id)
                .order_by(ai_usage.c.at.desc())
                .limit(50)
            )
        ]
        median = statistics.median(recent) if len(recent) >= 5 else None
        alert = bool(median and median > 0 and cost > self.s.cost_alert_multiplier * median)
        u = reply.usage
        conn.execute(
            insert(ai_usage).values(
                id=ulid(),
                learner_id=learner_id,
                day=today(),
                route=route,
                model=reply.model,
                input_tokens=u.input_tokens,
                output_tokens=u.output_tokens,
                cache_read_tokens=u.cache_read_tokens,
                cache_write_tokens=u.cache_write_tokens,
                cost_usd=cost,
                latency_ms=reply.latency_ms,
                rung=rung,
                at=datetime.now(UTC).isoformat(),
            )
        )
        return UsageRecord(cost_usd=cost, alert=alert, median_usd=median)


class Ladder:
    """Process-local health signals. A multi-instance deployment would back these with a
    shared store; the rung semantics stay the same.

    Rung 0 healthy · 1 grader slow (queue grading) · 2 saturated (standby model) ·
    3 budget spent or AI not configured · 4 unreachable (decided by the client)."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._lock = threading.Lock()
        self._grader_ms: deque[int] = deque(maxlen=20)
        self._saturated_until = 0.0

    def note_latency(self, route: Route, ms: int) -> None:
        if route == "grader":
            with self._lock:
                self._grader_ms.append(ms)

    def note_saturation(self) -> None:
        with self._lock:
            self._saturated_until = time.monotonic() + self.s.saturation_window_s

    def grader_p95(self) -> int | None:
        with self._lock:
            xs = sorted(self._grader_ms)
        if len(xs) < 5:
            return None
        return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))]

    def global_rung(self) -> int:
        if self.s.model_mode == "off":
            return 3
        if time.monotonic() < self._saturated_until:
            return 2
        p95 = self.grader_p95()
        if p95 is not None and p95 > self.s.grader_slow_p95_ms:
            return 1
        return 0

    def model_for(self, route: Route) -> str:
        return self.s.model_standby if self.global_rung() == 2 else self.s.model_primary
