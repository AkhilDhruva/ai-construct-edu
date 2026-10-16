# Mantle API (API mode)

FastAPI service behind VeraClause Mantle's API mode. The web app is complete without it. When it is reachable and healthy, the app turns on:
- sync across devices
- an AI tutor
- a rubric grader
- a live prompt coach

When it isn't, the app walks down the degradation ladder to offline mode.

## Run locally

```bash
cd api
uv sync
uv run uvicorn mantle_api.main:app_factory --factory --port 8318
```

Defaults: SQLite (`./mantle.db`), the **mock model** (deterministic, no provider calls) and **dev auth**. In the web app, open **Settings → API mode**, connect to `http://localhost:8318`, then sign in with any development user name.

To grade and tutor with Claude, set `MANTLE_MODEL_MODE=live`. The Anthropic SDK resolves credentials from the environment (`ANTHROPIC_API_KEY` or an `ant auth login` profile), and nothing is stored in this repo. See `.env.example` for every setting.

## What it does

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Rung (0–3), capability flags, model mode, auth mode |
| `POST /v1/identity/bind` | First sign-in claims the browser's ULID; later devices adopt the bound one |
| `POST /v1/sync`, `GET /v1/sync` | Offline-first union merge (append-only logs by id, profile last-write-wins, latest card review wins) |
| `POST /v1/grade/drill`, `GET /v1/grade/{id}` | Rubric grading with verbatim citations; queued at rung 1 |
| `POST /v1/tutor/ask` | Bounded tutor loop over read-only tools |
| `POST /v1/coach/rewrite` | Live RTCF rewrite; prompts with sensitive data are refused before any model call |
| `GET /v1/admin/usage` | Cost dashboard (admin role) |

## How the governance works

- **Gateway** (`gateway.py`): the order is fixed. Authorise first, then validate the arguments against the JSON Schema, then execute with a timeout, then return a typed result (`SUCCESS`, `EMPTY`, `DENIED`, `UNAVAILABLE` or `INVALID`). A denied caller never sees a tool's schema.
- **Tutor loop** (`ai.py`): it checks four bounds before every model call:
  - steps ≤ 6
  - tokens ≤ 20,000
  - wall clock ≤ 60 s
  - no identical repeated tool call

  It always returns a termination reason and its own step trace. The loop is hand-written rather than built on LangGraph, so the bounds and the gateway stay explicit.
- **Grader**: the model proposes, the server decides.
  - A point stands only if its citation is a verbatim sentence from the answer.
  - Missing criteria score 0, and the total is computed on the server.
  - The answer is untrusted data. The grader has no tools, and its output must match a JSON schema (structured outputs).
- **Cost governor** (`governor.py`):
  - A per-learner daily token budget, checked **before** each call.
  - Every call's usage and cost is recorded.
  - A `cost.alert` span fires when one call costs more than 3× the trailing median.
- **Ladder**:
  - Rung 1: grader p95 above 8 s, so grading is queued.
  - Rung 2: 429/529 from the provider, so the call moves to the standby model (`claude-haiku-4-5`).
  - Rung 3: budget spent or AI off.
  - Rung 4: the API is unreachable. The browser decides this rung, not the server.
- **Models**: `claude-sonnet-5-5` for the grader, tutor and coach, with `fallbacks: "default"` (server-side refusal fallback). `claude-haiku-4-5` is the standby. The stable system prompts and rubrics are prompt-cached.
- **Telemetry**: every AI call produces an OpenTelemetry span (exported over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, for example to Langfuse). It also becomes a learner event, which syncs into that learner's own `/trace` view.
- **Row-level security** (`migrations/postgres`): every learner-keyed table has `FORCE ROW LEVEL SECURITY` with a policy on `mantle.learner_id`, set per transaction. A bug in the API still cannot read another learner's rows.

## Postgres

```bash
MANTLE_DATABASE_URL=postgresql+psycopg://owner:...@host:5432/db uv run python -m mantle_api.migrate
```

Then connect the API as a login role that is a member of `mantle_app`. It must not be the owner or a superuser.

## Tests and evals

```bash
uv run pytest -q                       # SQLite; Postgres RLS tests run when MANTLE_TEST_PG_URL is set (CI does this)
uv run python -m evals.run --model mock
uv run python -m evals.run --model live    # spends money; also available as the "Grader eval (live model)" workflow
```

The golden set (`evals/golden/grader.json`) has 18 labelled drill answers: 4 per drill across the quality range, plus 2 prompt-injection attempts per drill.

The eval has three gates:
- **Safety**: on injection items the score must not be inflated and no injected sentence may be cited. Any failure fails the run.
- **Quality**: errors are compared with the committed baseline using a one-sided sign test. A regression fails the run only at p < 0.05.
- **Cost**: reported as a ratio against the baseline.

**The labels are drafts that still need a human review.** The design target is 40 graded drills.
