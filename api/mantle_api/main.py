"""HTTP surface of API mode. The web app stays fully usable without this service; when it
is reachable and healthy, the app turns on sync, the AI tutor, the rubric grader and the
live prompt coach, and walks down the degradation ladder when it is not."""

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, insert, select, update

from . import __version__
from .ai import AiService, GradeRefused, ask_tutor, coach_rewrite, grade, tutor_tools
from .auth import Principal, TokenVerifier, bind_learner, bound_principal, current_principal, require_role
from .content import load_content
from .db import Database, ai_usage, grade_jobs
from .gateway import Gateway
from .governor import BudgetExceeded, Governor, Ladder
from .ids import ulid
from .models import LiveModel, MockModel, ModelClient, ModelUnavailable
from .settings import Settings, get_settings
from .sync import merge, snapshot
from .telemetry import setup_tracing

MAX_BODY_BYTES = 8_000_000


class BindIn(BaseModel):
    learnerId: str


class SyncIn(BaseModel):
    snapshot: dict[str, Any]


class GradeIn(BaseModel):
    drillId: str
    answer: str = Field(min_length=40, max_length=20_000)


class TutorIn(BaseModel):
    question: str = Field(min_length=3, max_length=2_000)
    conceptId: str | None = None
    labId: str | None = None
    labState: Any = None


class CoachIn(BaseModel):
    scenarioId: str
    prompt: str = Field(min_length=3, max_length=4_000)


class DevTokenIn(BaseModel):
    sub: str = Field(min_length=3, max_length=200)


def create_app(settings: Settings | None = None, model: ModelClient | None = None) -> FastAPI:
    s = settings or get_settings()
    setup_tracing(s.otel_service_name)
    db = Database(s.database_url)
    if not db.is_postgres:
        db.create_all()  # Postgres is migrated by migrations/postgres, never by the app.
    content = load_content(s.content_dir)
    if model is None:
        model = LiveModel(fallbacks=s.fallbacks_enabled) if s.model_mode == "live" else MockModel()
    governor, ladder = Governor(s), Ladder(s)
    ai = AiService(db, s, model, governor, ladder)
    gateway = Gateway(tutor_tools(db, content), s.tool_timeout_s)

    app = FastAPI(title="VeraClause Mantle API", version=__version__)
    app.state.settings, app.state.db, app.state.verifier = s, db, TokenVerifier(s)
    app.state.ladder, app.state.ai = ladder, ai
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["authorization", "content-type"],
        expose_headers=["x-mantle-rung"],
    )

    @app.middleware("http")
    async def guard(request: Request, call_next):
        length = int(request.headers.get("content-length") or 0)
        if length > MAX_BODY_BYTES:
            return JSONResponse({"detail": "request body too large"}, status_code=413)
        response = await call_next(request)
        response.headers["x-mantle-rung"] = str(getattr(request.state, "rung", ladder.global_rung()))
        return response

    def ai_enabled() -> None:
        if s.model_mode == "off":
            raise HTTPException(
                503, {"status": "UNAVAILABLE", "rung": 3, "reason": "AI is not configured on this server"}
            )

    def ai_errors(request: Request, fn):
        try:
            return fn()
        except BudgetExceeded as e:
            request.state.rung = 3
            raise HTTPException(
                429, {"status": "DENIED", "rung": 3, "reason": "budget", "used": e.used, "limit": e.limit}
            ) from e
        except ModelUnavailable as e:
            raise HTTPException(
                503, {"status": "UNAVAILABLE", "rung": ladder.global_rung(), "reason": "model unavailable"}
            ) from e

    Bound = Annotated[Principal, Depends(bound_principal)]

    @app.get("/health")
    def health() -> dict[str, Any]:
        rung = ladder.global_rung()
        ai_on = s.model_mode != "off"
        return {
            "status": "ok",
            "version": __version__,
            "rung": rung,
            "flags": {"tutor": ai_on, "grader": ai_on, "coach": ai_on, "sync": True},
            "models": {"mode": s.model_mode, "primary": s.model_primary, "standby": s.model_standby},
            "auth": {"mode": s.auth_mode},
            "graderP95Ms": ladder.grader_p95(),
        }

    @app.post("/dev/token")
    def dev_token(body: DevTokenIn) -> dict[str, str]:
        return {"token": app.state.verifier.mint_dev(body.sub)}

    @app.get("/v1/me")
    def me(principal: Annotated[Principal, Depends(current_principal)]) -> dict[str, Any]:
        used = 0
        if principal.learner_id:
            with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
                used = governor.tokens_today(conn, principal.learner_id)
        return {
            "sub": principal.sub,
            "learnerId": principal.learner_id,
            "role": principal.role,
            "budget": {"usedTokens": used, "limitTokens": s.daily_token_budget},
        }

    @app.post("/v1/identity/bind")
    def bind(body: BindIn, principal: Annotated[Principal, Depends(current_principal)]) -> dict[str, Any]:
        p = bind_learner(db, principal, body.learnerId)
        return {"learnerId": p.learner_id, "role": p.role, "switched": p.learner_id != body.learnerId}

    @app.post("/v1/sync")
    def sync(body: SyncIn, principal: Bound) -> dict[str, Any]:
        with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
            report = merge(conn, principal.learner_id, body.snapshot)
            snap = snapshot(conn, principal.learner_id)
        return {"report": report, "snapshot": snap, "syncedAt": datetime.now(UTC).isoformat()}

    @app.get("/v1/sync")
    def pull(principal: Bound) -> dict[str, Any]:
        with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
            return {"snapshot": snapshot(conn, principal.learner_id)}

    def run_grade_job(job_id: str, principal: Principal, drill_id: str, answer: str) -> dict[str, Any]:
        drill = content.drills[drill_id]
        try:
            result = grade(ai, principal, drill, answer)
            status = "done"
        except GradeRefused as e:
            result, status = {"error": str(e)}, "failed"
        except (BudgetExceeded, ModelUnavailable) as e:
            result, status = {"error": str(e)}, "failed"
        with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
            conn.execute(
                update(grade_jobs)
                .where(grade_jobs.c.id == job_id, grade_jobs.c.learner_id == principal.learner_id)
                .values(status=status, result=result, updated_at=datetime.now(UTC).isoformat())
            )
        return {"jobId": job_id, "status": status, "result": result}

    @app.post("/v1/grade/drill")
    def grade_drill(body: GradeIn, request: Request, background: BackgroundTasks, principal: Bound) -> JSONResponse:
        ai_enabled()
        if body.drillId not in content.drills:
            raise HTTPException(404, "unknown drill")

        def check_budget() -> None:
            with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
                governor.check(conn, principal.learner_id, len(body.answer) // 3 + 3000)

        ai_errors(request, check_budget)  # budget is checked before queueing, not after
        job_id, now = ulid(), datetime.now(UTC).isoformat()
        with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
            conn.execute(
                insert(grade_jobs).values(
                    id=job_id,
                    learner_id=principal.learner_id,
                    drill_id=body.drillId,
                    status="pending",
                    request={"answer": body.answer},
                    result=None,
                    created_at=now,
                    updated_at=now,
                )
            )
        rung = ladder.global_rung()
        request.state.rung = rung
        if rung == 1:
            # Rung 1: the grader is slow, so the score arrives later and the learner self-scores now.
            background.add_task(run_grade_job, job_id, principal, body.drillId, body.answer)
            return JSONResponse({"jobId": job_id, "status": "queued", "rung": 1}, status_code=202)
        out = ai_errors(request, lambda: run_grade_job(job_id, principal, body.drillId, body.answer))
        return JSONResponse(out)

    @app.get("/v1/grade/{job_id}")
    def grade_status(job_id: str, principal: Bound) -> dict[str, Any]:
        with db.scope(sub=principal.sub, learner_id=principal.learner_id) as conn:
            row = conn.execute(
                select(grade_jobs).where(grade_jobs.c.id == job_id, grade_jobs.c.learner_id == principal.learner_id)
            ).first()
        if row is None:
            raise HTTPException(404, "unknown job")
        return {"jobId": row.id, "status": row.status, "result": row.result}

    @app.post("/v1/tutor/ask")
    def tutor(body: TutorIn, request: Request, principal: Bound) -> dict[str, Any]:
        ai_enabled()
        out = ai_errors(
            request,
            lambda: ask_tutor(
                ai,
                gateway,
                principal,
                body.question,
                {"conceptId": body.conceptId, "labId": body.labId, "labState": body.labState},
            ),
        )
        request.state.rung = out["rung"]
        return out

    @app.post("/v1/coach/rewrite")
    def coach(body: CoachIn, request: Request, principal: Bound) -> dict[str, Any]:
        ai_enabled()
        out = ai_errors(request, lambda: coach_rewrite(ai, content, principal, body.scenarioId, body.prompt))
        request.state.rung = out.get("rung", ladder.global_rung())
        return out

    @app.get("/v1/admin/usage")
    def admin_usage(admin: Annotated[Principal, Depends(require_role("admin"))]) -> dict[str, Any]:
        """Cost dashboard for operators. Runs outside learner scope; on Postgres the admin
        connection uses a role with read access to usage, never to learner payloads."""
        with db.scope(sub=admin.sub, role="admin") as conn:
            rows = conn.execute(
                select(
                    ai_usage.c.day,
                    ai_usage.c.route,
                    ai_usage.c.model,
                    func.count().label("calls"),
                    func.sum(ai_usage.c.input_tokens + ai_usage.c.output_tokens).label("tokens"),
                    func.sum(ai_usage.c.cost_usd).label("cost"),
                    func.avg(ai_usage.c.latency_ms).label("avgLatencyMs"),
                )
                .group_by(ai_usage.c.day, ai_usage.c.route, ai_usage.c.model)
                .order_by(ai_usage.c.day.desc())
            ).all()
        return {"rows": [dict(r._mapping) for r in rows]}

    return app


def app_factory() -> FastAPI:
    """Entry point for uvicorn --factory: settings come from MANTLE_* environment variables."""
    return create_app()
