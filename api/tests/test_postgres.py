"""Row-level security on a real Postgres. Runs in CI (a postgres service container) or
locally when MANTLE_TEST_PG_URL points at a disposable database with a superuser:
    MANTLE_TEST_PG_URL=postgresql+psycopg://postgres:postgres@localhost:5432/mantle"""

import os
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from mantle_api.db import Database, attempts
from mantle_api.ids import ulid
from mantle_api.main import create_app
from mantle_api.migrate import migrate
from mantle_api.settings import Settings

from .conftest import snapshot_for

PG = os.environ.get("MANTLE_TEST_PG_URL")
pytestmark = [pytest.mark.postgres, pytest.mark.skipif(not PG, reason="MANTLE_TEST_PG_URL not set")]


@pytest.fixture(scope="module")
def app_url() -> str:
    """Migrate as the owner, then connect the app as a login role that is only a member of
    mantle_app: it cannot bypass RLS, exactly like production."""
    assert PG
    migrate(PG)
    password = secrets.token_hex(12)
    owner = create_engine(PG, future=True)
    with owner.begin() as conn:
        conn.execute(text("drop role if exists mantle_app_test"))
        conn.execute(text(f"create role mantle_app_test login password '{password}' in role mantle_app"))
    owner.dispose()
    return make_url(PG).set(username="mantle_app_test", password=password).render_as_string(hide_password=False)


def _row(lid: str) -> dict:
    a = snapshot_for(lid)["attempts"][0]
    return {"id": a["id"], "learner_id": lid, "payload": a, "at": a["at"]}


def test_rls_isolates_learners_even_without_api_filters(app_url: str) -> None:
    db = Database(app_url)
    a, b = ulid(), ulid()
    with db.scope(learner_id=a) as conn:
        conn.execute(insert(attempts).values(**_row(a)))
    # Learner B's transaction sees nothing of A's, even with no WHERE clause at all.
    with db.scope(learner_id=b) as conn:
        assert conn.execute(select(attempts.c.id).where(attempts.c.learner_id == a)).all() == []
        assert all(r.learner_id == b for r in conn.execute(select(attempts.c.learner_id)))
    # And B cannot write a row that claims to be A's.
    with pytest.raises(DBAPIError), db.scope(learner_id=b) as conn:
        conn.execute(insert(attempts).values(**_row(a)))
    # No principal set: nothing is visible.
    with db.scope() as conn:
        assert conn.execute(select(attempts.c.id)).all() == []


def test_full_api_flow_runs_under_rls(app_url: str, tmp_path) -> None:
    settings = Settings(env="test", database_url=app_url, auth_mode="dev", model_mode="mock")
    client = TestClient(create_app(settings))
    tok = lambda sub: {"authorization": "Bearer " + client.post("/dev/token", json={"sub": sub}).json()["token"]}  # noqa: E731
    ha, hb = tok(f"pg-a-{ulid()}"), tok(f"pg-b-{ulid()}")
    la, lb = ulid(), ulid()
    assert client.post("/v1/identity/bind", json={"learnerId": la}, headers=ha).status_code == 200
    assert client.post("/v1/identity/bind", json={"learnerId": lb}, headers=hb).status_code == 200
    # RLS hides A's identity row from B, so the unique constraint reports the conflict.
    assert client.post("/v1/identity/bind", json={"learnerId": la}, headers=tok(f"pg-c-{ulid()}")).status_code == 409
    out = client.post("/v1/sync", json={"snapshot": snapshot_for(la)}, headers=ha).json()
    assert out["report"]["attempts"] == 2
    assert client.get("/v1/sync", headers=hb).json()["snapshot"] is None
    r = client.post("/v1/coach/rewrite", json={"scenarioId": "job-ad", "prompt": "write a job ad"}, headers=ha)
    assert r.status_code == 200 and r.json()["status"] == "SUCCESS"
