from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from mantle_api.ids import ulid
from mantle_api.main import create_app
from mantle_api.models import MockModel, ModelClient
from mantle_api.settings import Settings


def make_settings(tmp_path: Path, **over: Any) -> Settings:
    base = dict(env="test", database_url=f"sqlite:///{tmp_path / 'test.db'}", auth_mode="dev", model_mode="mock")
    base.update(over)
    return Settings(**base)


@dataclass
class Api:
    client: TestClient
    model: Any

    def token(self, sub: str) -> dict[str, str]:
        t = self.client.post("/dev/token", json={"sub": sub}).json()["token"]
        return {"authorization": f"Bearer {t}"}

    def learner(self, sub: str = "user-a") -> tuple[dict[str, str], str]:
        """A signed-in user with a freshly bound learner ULID."""
        h = self.token(sub)
        lid = ulid()
        r = self.client.post("/v1/identity/bind", json={"learnerId": lid}, headers=h)
        assert r.status_code == 200, r.text
        return h, lid


@pytest.fixture
def make_api(tmp_path: Path) -> Callable[..., Api]:
    def _make(model: ModelClient | None = None, **settings: Any) -> Api:
        m = model or MockModel()
        app = create_app(make_settings(tmp_path, **settings), model=m)
        return Api(TestClient(app), m)

    return _make


@pytest.fixture
def api(make_api: Callable[..., Api]) -> Api:
    return make_api()


def snapshot_for(lid: str, *, updated_at: str = "2026-10-16T10:00:00.000Z", n_attempts: int = 2) -> dict[str, Any]:
    learner = {
        "id": lid,
        "createdAt": "2026-10-16T09:00:00.000Z",
        "updatedAt": updated_at,
        "onboarded": True,
        "goal": "interview",
        "horizonWeeks": 6,
        "role": "engineer",
        "weeklyMinutes": 300,
        "introduced": ["bounded-loop"],
    }
    attempts = [
        {
            "id": ulid(),
            "learnerId": lid,
            "sessionId": "s1",
            "kind": "check",
            "itemId": f"fnd-chk-0{i + 1}",
            "conceptIds": ["bounded-loop"],
            "tier": "apply",
            "depth": 2,
            "correct": True,
            "score": 1,
            "answer": "a",
            "latencyMs": 1000,
            "mode": "offline",
            "at": f"2026-10-16T09:0{i}:00.000Z",
        }
        for i in range(n_attempts)
    ]
    mastery = [
        {
            "id": ulid(),
            "learnerId": lid,
            "conceptId": "bounded-loop",
            "version": 1,
            "mastery": 0.62,
            "evidence": attempts[0]["id"] if attempts else "prior",
            "validFrom": "2026-10-16T09:00:00.000Z",
            "recordedAt": "2026-10-16T09:00:01.000Z",
        }
    ]
    card = {
        "learnerId": lid,
        "cardId": "fnd-010",
        "due": "2026-10-17T09:00:00.000Z",
        "stability": 1,
        "difficulty": 5,
        "elapsed_days": 0,
        "scheduled_days": 1,
        "learning_steps": 0,
        "reps": 1,
        "lapses": 0,
        "state": 1,
        "last_review": "2026-10-16T09:05:00.000Z",
        "updatedAt": "2026-10-16T09:05:00.000Z",
    }
    return {
        "learner": learner,
        "cardStates": [card],
        "attempts": attempts,
        "mastery": mastery,
        "plans": [],
        "events": [],
    }
