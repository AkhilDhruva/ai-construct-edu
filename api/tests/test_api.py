import json
import time
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from mantle_api.ai import verify_grade
from mantle_api.auth import Principal
from mantle_api.content import load_content
from mantle_api.db import events
from mantle_api.gateway import Gateway, ToolSpec
from mantle_api.ids import ulid
from mantle_api.models import MockModel, ModelReply, ModelSaturated, Usage
from mantle_api.settings import REPO_ROOT

from .conftest import Api, snapshot_for

CONTENT = load_content(REPO_ROOT / "content")
GOLDEN = json.loads(
    (Path(__file__).resolve().parents[1] / "evals" / "golden" / "grader.json").read_text(encoding="utf-8")
)


# ── health, auth and identity ────────────────────────────────────────────────


def test_health_reports_rung_flags_and_models(api: Api) -> None:
    body = api.client.get("/health").json()
    assert body["rung"] == 0
    assert body["flags"] == {"tutor": True, "grader": True, "coach": True, "sync": True}
    assert body["models"] == {"mode": "mock", "primary": "claude-sonnet-5-5", "standby": "claude-haiku-4-5"}


def test_model_mode_off_degrades_to_rung_3(make_api) -> None:
    api = make_api(model_mode="off")
    body = api.client.get("/health").json()
    assert body["rung"] == 3 and body["flags"]["tutor"] is False and body["flags"]["sync"] is True
    h, _ = api.learner()
    r = api.client.post("/v1/tutor/ask", json={"question": "why bound loops?"}, headers=h)
    assert r.status_code == 503 and r.json()["detail"]["rung"] == 3


def test_auth_rejects_missing_and_forged_tokens(api: Api) -> None:
    assert api.client.get("/v1/me").status_code == 401
    assert api.client.get("/v1/me", headers={"authorization": "Bearer not.a.jwt"}).status_code == 401
    import jwt

    forged = jwt.encode(
        {"sub": "x", "exp": int(time.time()) + 60, "aud": "authenticated"},
        "wrong-secret-of-32-bytes-length!",
        algorithm="HS256",
    )
    assert api.client.get("/v1/me", headers={"authorization": f"Bearer {forged}"}).status_code == 401


def test_dev_tokens_are_refused_outside_dev_mode(make_api) -> None:
    api = make_api(auth_mode="hs256", jwt_secret="a-production-style-secret-of-32-bytes!")
    assert api.client.post("/dev/token", json={"sub": "someone"}).status_code == 404
    with pytest.raises(RuntimeError):
        make_api(env="prod", auth_mode="dev")


def test_bind_claims_a_ulid_once_and_second_devices_switch(api: Api) -> None:
    h, lid = api.learner("user-a")
    me = api.client.get("/v1/me", headers=h).json()
    assert me["learnerId"] == lid and me["role"] == "learner"
    # Same account, another device with its own ULID: told to switch to the bound one.
    again = api.client.post("/v1/identity/bind", json={"learnerId": ulid()}, headers=h).json()
    assert again == {"learnerId": lid, "role": "learner", "switched": True}
    # Another account cannot claim this ULID.
    other = api.token("user-b")
    assert api.client.post("/v1/identity/bind", json={"learnerId": lid}, headers=other).status_code == 409
    assert api.client.post("/v1/identity/bind", json={"learnerId": "not-a-ulid"}, headers=other).status_code == 422


def test_data_routes_need_a_bound_learner(api: Api) -> None:
    h = api.token("unbound")
    assert api.client.get("/v1/sync", headers=h).status_code == 409


def test_admin_route_needs_admin_role(make_api) -> None:
    api = make_api(admin_subs=["ops"])
    h, _ = api.learner("user-a")
    assert api.client.get("/v1/admin/usage", headers=h).status_code == 403
    assert api.client.get("/v1/admin/usage", headers=api.token("ops")).status_code == 200


# ── sync ─────────────────────────────────────────────────────────────────────


def test_sync_is_a_union_merge_that_never_overwrites(api: Api) -> None:
    h, lid = api.learner()
    snap = snapshot_for(lid)
    first = api.client.post("/v1/sync", json={"snapshot": snap}, headers=h).json()
    assert first["report"]["attempts"] == 2 and first["report"]["learner"] == "created"
    again = api.client.post("/v1/sync", json={"snapshot": snap}, headers=h).json()
    assert again["report"]["attempts"] == 0 and again["report"]["mastery"] == 0

    # A second device adds one attempt and has an older profile: union on logs, LWW on profile.
    other = snapshot_for(lid, updated_at="2026-10-15T00:00:00.000Z", n_attempts=0)
    other["attempts"] = [{**snap["attempts"][0], "id": ulid(), "at": "2026-10-16T11:00:00.000Z"}]
    other["learner"]["introduced"] = ["what-is-an-agent"]
    merged = api.client.post("/v1/sync", json={"snapshot": other}, headers=h).json()
    assert merged["report"]["attempts"] == 1 and merged["report"]["learner"] == "kept-server"
    assert len(merged["snapshot"]["attempts"]) == 3
    assert sorted(merged["snapshot"]["learner"]["introduced"]) == ["bounded-loop", "what-is-an-agent"]


def test_card_state_with_the_later_review_wins(api: Api) -> None:
    h, lid = api.learner()
    snap = snapshot_for(lid)
    api.client.post("/v1/sync", json={"snapshot": snap}, headers=h)
    older = snapshot_for(lid)
    older["cardStates"][0] = {**older["cardStates"][0], "reps": 99, "last_review": "2026-10-01T00:00:00.000Z"}
    newer = snapshot_for(lid)
    newer["cardStates"][0] = {**newer["cardStates"][0], "reps": 2, "last_review": "2026-10-16T12:00:00.000Z"}
    assert api.client.post("/v1/sync", json={"snapshot": older}, headers=h).json()["report"]["cardStates"] == 0
    out = api.client.post("/v1/sync", json={"snapshot": newer}, headers=h).json()
    assert out["report"]["cardStates"] == 1 and out["snapshot"]["cardStates"][0]["reps"] == 2


def test_sync_rejects_rows_for_another_learner(api: Api) -> None:
    h, lid = api.learner("user-a")
    _, other_lid = api.learner("user-b")
    snap = snapshot_for(lid)
    snap["attempts"][0]["learnerId"] = other_lid
    assert api.client.post("/v1/sync", json={"snapshot": snap}, headers=h).status_code == 403
    assert api.client.post("/v1/sync", json={"snapshot": snapshot_for(other_lid)}, headers=h).status_code == 403


def test_learners_never_see_each_others_data(api: Api) -> None:
    ha, la = api.learner("user-a")
    hb, lb = api.learner("user-b")
    api.client.post("/v1/sync", json={"snapshot": snapshot_for(la)}, headers=ha)
    pulled = api.client.get("/v1/sync", headers=hb).json()["snapshot"]
    assert pulled is None


# ── gateway ──────────────────────────────────────────────────────────────────


def _gateway(timeout: float = 0.2) -> Gateway:
    schema = {
        "type": "object",
        "properties": {"q": {"type": "string"}},
        "required": ["q"],
        "additionalProperties": False,
    }
    tools = [
        ToolSpec("lookup", "test", schema, lambda _p, a: {"hit": a["q"]} if a["q"] != "none" else None),
        ToolSpec("slow", "test", schema, lambda _p, _a: time.sleep(1)),
        ToolSpec("admin_only", "test", schema, lambda _p, _a: {"ok": 1}, roles=frozenset({"admin"})),
    ]
    return Gateway(tools, timeout)


LEARNER = Principal("s", "01HZY00000000000000000000A", "learner")


def test_gateway_authorises_before_validating_so_denied_callers_learn_no_schema() -> None:
    g = _gateway()
    r = g.call(LEARNER, "admin_only", {"wrong": 1})
    assert r.status == "DENIED" and "q" not in (r.error or "")
    assert g.call(LEARNER, "no_such_tool", {}).status == "DENIED"
    assert "admin_only" not in {t["name"] for t in g.definitions_for(LEARNER)}


def test_gateway_types_every_outcome() -> None:
    g = _gateway()
    assert g.call(LEARNER, "lookup", {"q": 1}).status == "INVALID"
    assert g.call(LEARNER, "lookup", {"q": "x", "extra": 1}).status == "INVALID"
    assert g.call(LEARNER, "lookup", {"q": "none"}).status == "EMPTY"
    ok = g.call(LEARNER, "lookup", {"q": "x"})
    assert ok.status == "SUCCESS" and ok.data == {"hit": "x"}
    assert g.call(LEARNER, "slow", {"q": "x"}).status == "UNAVAILABLE"


# ── grader ───────────────────────────────────────────────────────────────────


def test_grader_returns_cited_rubric_scores(api: Api) -> None:
    h, _ = api.learner()
    item = next(i for i in GOLDEN["items"] if i["kind"] == "normal" and sum(i["expected"].values()) == 12)
    r = api.client.post("/v1/grade/drill", json={"drillId": item["drillId"], "answer": item["answer"]}, headers=h)
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    assert res["mock"] is True and res["max"] == 12
    assert [c["id"] for c in res["criteria"]] == [
        "requirements-as-numbers",
        "architecture-with-decision-rule",
        "trade-off-named",
        "measurement-named",
    ]
    for c in res["criteria"]:
        if c["score"] > 0:
            assert c["citationVerified"] and c["citation"] in item["answer"]
    assert res["total"] == sum(c["score"] for c in res["criteria"])
    job = api.client.get(f"/v1/grade/{r.json()['jobId']}", headers=h).json()
    assert job["status"] == "done"


def test_server_zeroes_points_without_a_verbatim_citation() -> None:
    drill = CONTENT.drills["fnd-drill-support-agent"]
    answer = "We need 40,000 tickets per day at 3x peak. I choose a router because most tickets are simple."
    raw = {
        "criteria": [
            {
                "id": "requirements-as-numbers",
                "score": 2,
                "citation": "We need 40,000 tickets per day at 3x peak.",
                "rationale": "r",
            },
            {
                "id": "architecture-with-decision-rule",
                "score": 3,
                "citation": "I pick a planner-executor.",
                "rationale": "invented",
            },
            {"id": "trade-off-named", "score": 3, "citation": "", "rationale": "no citation"},
        ],
        "summary": "s",
    }
    out = verify_grade(drill, answer, raw)
    scores = {c["id"]: (c["score"], c["adjusted"]) for c in out["criteria"]}
    assert scores == {
        "requirements-as-numbers": (2, False),
        "architecture-with-decision-rule": (0, True),
        "trade-off-named": (0, True),
        "measurement-named": (0, False),
    }
    assert out["total"] == 2 and out["passed"] is False


def test_injection_lines_never_earn_points(api: Api) -> None:
    h, _ = api.learner()
    for item in [i for i in GOLDEN["items"] if i["kind"] == "injection"]:
        res = api.client.post(
            "/v1/grade/drill", json={"drillId": item["drillId"], "answer": item["answer"]}, headers=h
        ).json()["result"]
        assert res["total"] < 9, item["id"]
        for c in res["criteria"]:
            assert not any(w in c["citation"].lower() for w in ("grader", "system notice", "ignore all", "override")), (
                item["id"]
            )


def test_slow_grader_queues_the_score_at_rung_1(make_api) -> None:
    api = make_api(model=MockModel(latency_ms=9_000))
    h, _ = api.learner()
    item = GOLDEN["items"][0]
    for _ in range(5):  # warm the latency window with slow calls
        api.client.post("/v1/grade/drill", json={"drillId": item["drillId"], "answer": item["answer"]}, headers=h)
    assert api.client.get("/health").json()["rung"] == 1
    r = api.client.post("/v1/grade/drill", json={"drillId": item["drillId"], "answer": item["answer"]}, headers=h)
    assert r.status_code == 202 and r.json()["status"] == "queued" and r.headers["x-mantle-rung"] == "1"
    # TestClient runs background tasks before returning, so the job is already graded.
    assert api.client.get(f"/v1/grade/{r.json()['jobId']}", headers=h).json()["status"] == "done"


# ── ladder and governor ──────────────────────────────────────────────────────


class SaturatedOnce(MockModel):
    def create(self, **kw: Any) -> ModelReply:
        if not any(c.get("saturated") for c in self.calls):
            self.calls.append({"saturated": True, "model": kw["model"]})
            raise ModelSaturated("529 overloaded")
        return super().create(**kw)


def test_saturation_steps_down_to_the_standby_model(make_api) -> None:
    api = make_api(model=SaturatedOnce())
    h, _ = api.learner()
    r = api.client.post(
        "/v1/coach/rewrite", json={"scenarioId": "meeting-summary", "prompt": "summarise my notes"}, headers=h
    )
    assert r.status_code == 200 and r.json()["rung"] == 2 and r.json()["model"] == "mock:claude-haiku-4-5"
    assert api.client.get("/health").json()["rung"] == 2


def test_budget_is_checked_before_the_call(make_api) -> None:
    api = make_api(daily_token_budget=500)
    h, _ = api.learner()
    r = api.client.post("/v1/tutor/ask", json={"question": "Explain the step ceiling."}, headers=h)
    assert r.status_code == 429 and r.json()["detail"]["rung"] == 3 and r.headers["x-mantle-rung"] == "3"
    assert api.model.calls == []  # nothing was spent


class Pricey(MockModel):
    """Live-like costs so the 3x-median alert can fire."""

    def __init__(self, sizes: list[int]) -> None:
        super().__init__()
        self.sizes = sizes

    def create(self, **kw: Any) -> ModelReply:
        reply = super().create(**kw)
        n = self.sizes[min(len(self.calls) - 1, len(self.sizes) - 1)]
        return ModelReply(
            reply.model.replace("mock:", ""),
            reply.blocks,
            reply.raw_content,
            reply.stop_reason,
            Usage(n, n),
            5,
            mock=False,
        )


def test_cost_alert_fires_at_three_times_the_trailing_median(make_api) -> None:
    api = make_api(model=Pricey([1000] * 5 + [10_000]), daily_token_budget=10_000_000)
    h, lid = api.learner()
    for _ in range(6):
        assert (
            api.client.post(
                "/v1/coach/rewrite", json={"scenarioId": "job-ad", "prompt": "write a job ad"}, headers=h
            ).status_code
            == 200
        )
    with api.client.app.state.db.scope(learner_id=lid) as conn:
        names = [r[0]["name"] for r in conn.execute(select(events.c.payload).where(events.c.learner_id == lid))]
    assert names.count("ai.coach") == 6 and names.count("cost.alert") == 1


# ── tutor ────────────────────────────────────────────────────────────────────


def test_tutor_runs_a_bounded_loop_over_read_only_tools(api: Api) -> None:
    h, lid = api.learner()
    api.client.post("/v1/sync", json={"snapshot": snapshot_for(lid)}, headers=h)
    r = api.client.post(
        "/v1/tutor/ask",
        json={
            "question": "Why did the token budget fire?",
            "conceptId": "bounded-loop",
            "labId": "bounded-loop-sim",
            "labState": {"reason": "token-budget"},
        },
        headers=h,
    ).json()
    assert r["termination"] == "completed"
    assert [s["kind"] for s in r["steps"]] == ["tool", "answer"]
    assert r["steps"][0] == {
        "kind": "tool",
        "tool": "get_concept",
        "status": "SUCCESS",
        "tokens": r["steps"][0]["tokens"],
    }
    assert "bounded loop" in r["answer"].lower()


class AlwaysTool(MockModel):
    def __init__(self, vary: bool) -> None:
        super().__init__()
        self.vary = vary

    def create(self, **kw: Any) -> ModelReply:
        self.calls.append({"route": kw["route"]})
        n = len(self.calls)
        args = {"limit": n if self.vary else 3}
        blocks = [{"type": "tool_use", "id": f"t{n}", "name": "get_my_recent_attempts", "input": args}]
        return ModelReply(f"mock:{kw['model']}", blocks, blocks, "tool_use", Usage(10, 10), 1, mock=True)


def test_tutor_stops_on_the_step_ceiling(make_api) -> None:
    api = make_api(model=AlwaysTool(vary=True), tutor_max_steps=3)
    h, _ = api.learner()
    r = api.client.post("/v1/tutor/ask", json={"question": "loop forever"}, headers=h).json()
    assert r["termination"] == "step-ceiling" and len(r["steps"]) == 3
    assert "stopped before finishing" in r["answer"]


def test_tutor_stops_on_identical_repeated_calls(make_api) -> None:
    api = make_api(model=AlwaysTool(vary=False))
    h, _ = api.learner()
    r = api.client.post("/v1/tutor/ask", json={"question": "repeat yourself"}, headers=h).json()
    assert r["termination"] == "no-progress" and len(r["steps"]) == 2


def test_tutor_token_budget_bound(make_api) -> None:
    api = make_api(model=AlwaysTool(vary=True), tutor_token_budget=25)
    h, _ = api.learner()
    r = api.client.post("/v1/tutor/ask", json={"question": "spend"}, headers=h).json()
    assert r["termination"] == "token-budget" and r["tokens"] >= 25


# ── coach ────────────────────────────────────────────────────────────────────


def test_coach_blocks_sensitive_data_before_any_model_call(api: Api) -> None:
    h, _ = api.learner()
    r = api.client.post(
        "/v1/coach/rewrite",
        json={"scenarioId": "customer-reply", "prompt": "Reply to jane.doe@example.com about her refund"},
        headers=h,
    ).json()
    assert r["status"] == "DENIED" and r["redFlags"]
    assert api.model.calls == []


def test_coach_rewrites_with_the_four_elements(api: Api) -> None:
    h, _ = api.learner()
    r = api.client.post(
        "/v1/coach/rewrite", json={"scenarioId": "meeting-summary", "prompt": "Summarise these notes."}, headers=h
    ).json()
    assert (
        r["status"] == "SUCCESS" and set(r["elementsAdded"]) <= {"role", "task", "context", "format"} and r["rewrite"]
    )


# ── telemetry reaches the learner's own trace ────────────────────────────────


def test_ai_spans_sync_into_the_learner_trace(api: Api) -> None:
    h, lid = api.learner()
    api.client.post("/v1/coach/rewrite", json={"scenarioId": "job-ad", "prompt": "write a job ad"}, headers=h)
    snap = api.client.post("/v1/sync", json={"snapshot": snapshot_for(lid)}, headers=h).json()["snapshot"]
    ai = [e for e in snap["events"] if e["name"] == "ai.coach"]
    assert len(ai) == 1 and ai[0]["learnerId"] == lid and ai[0]["attributes"]["rung"] == 0
    assert "tokens" in ai[0]["attributes"] and "cost" in ai[0]["attributes"]
