# VeraClause Mantle — AI Construct Education

An offline-first portal that teaches **agentic AI system design** with one interactive lab per concept, and that **runs as a bounded, governed agentic system itself**.

> **Design thesis: eat your own cooking.** Every concept the portal teaches is also part of its runtime. The learning session is a bounded loop with step, token, wall-clock and no-progress limits, and it always ends with a typed reason. Every learner step emits a telemetry span. Mastery is stored bitemporally and append-only. An outage walks down a visible degradation ladder to a fully offline mode instead of breaking.

**Mantle** is the hub: identity, the adaptive engine, progress and telemetry. **Tentacles** are teaching modules that plug into it. You add a tentacle by dropping a folder of JSON into `content/tentacles/`. Mantle's code does not change.

## Status: Phase 1

| Tentacle | Audience | Concepts | Cards | Checks | Drills | Labs (engine) |
| --- | --- | --- | --- | --- | --- | --- |
| Foundations | engineer, architect | 8 | 30 | 12 | 2 | Bounded Loop Simulator (`sequence-stepper`), Design Console (`eight-numbers`) |
| Enablement Basics | non-technical | 6 | 20 | 10 | 0 | Prompt Coach (`prompt-coach`), Workplace Scenarios (`scenario-sim`) |
| Tools, Gateway & MCP | engineer, architect | 6 | 24 | 10 | 1 | Gateway Walkthrough (`gateway-pipeline`) |

Phase 1 added:
- **Enablement Basics**, the non-technical track. It has an RTCF Prompt Coach with red-flag detection for sensitive data, branching workplace micro-scenarios, and its own 12-item readiness check.
- **Tools, Gateway & MCP**. It builds on Foundations through cross-tentacle prerequisites. Its Gateway Walkthrough shows what a misordered gateway does: leaks the schema, lets an unauthorised caller cause a side effect, runs the tool on invalid input, or returns raw results.
- **Role and audience rules**:
  - Onboarding picks the diagnostic track from role and goal.
  - The planner only schedules concepts in the learner's audience or goal.
  - Non-technical learners are capped at L2 and never see design drills.
- **Content studio** (Settings → Author tools). It has four parts:
  - **Validate**: the CI gates, run in the browser.
  - **Edit**: a JSON editor with live sandbox validation, a preview, a card form over the schema, and semver bumps.
  - **Item health**: flags items with pass rates under 40% or over 95%.
  - **Activity**: adoption telemetry.
- **Concept map**: a React Flow graph of every prerequisite, with one lane per tentacle, coloured by mastery.
- **Re-plan on content updates**: when a new tentacle or version ships, existing learners re-plan on their next visit, with the reason shown.

New tentacles that reuse existing lab engines need no code changes. A new kind of interactive lab, such as the three engines added in this phase, is an addition to Mantle's shared engine kit. Tentacles never ship their own rendering code.

### Phase 0 success criteria

| Success criterion | Status | How it's checked |
| --- | --- | --- |
| A learner completes the Foundations lab and passes the 80% knowledge check | ✅ The full path works in the UI | `e2e/learner.spec.ts` drives the lab and then the 12-item check to 12/12. The 45-minute target still needs a timed test with a real user. |
| Works fully offline (no network, no API key) | ✅ | E2E installs the service worker, goes offline, reloads, and runs a lab and Settings |
| Adding a tentacle needs zero Mantle code changes | ✅ Proven at the registry and engine level | `tests/content.test.ts` plugs in a second tentacle that has cross-tentacle prerequisites |
| An API outage degrades to offline grading within one request | ⚪ Rung 4 by construction | No API exists in Phase 0. The health probe (1.5 s timeout) defaults every capability flag to off. |
| Every learner action emits a telemetry span | ✅ | `tests/runtime.test.ts`; you can see them on the `/trace` page |
| Accessibility: keyboard-complete, reduced-motion safe, WCAG 2.2 AA | ✅ axe passes on every main page in CI | Lighthouse 95+ has not been measured yet |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Run every gate locally, the same way CI does:

```bash
npm run ci           # lint → typecheck → content gates → unit → build → e2e (Playwright + axe)
```

The npm scripts call `node <tool>` directly instead of going through the `node_modules/.bin` shims. That way they also work in Windows folders whose path contains `&`.

## Architecture

```
content/                      ← data, not code (validated by one Zod schema set)
  tentacles/<id>/manifest.json, concepts/*.json, labs/*.json, cards.json, checks.json, drills.json
  onboarding/diagnostic*.json ← one 12-item readiness check per track (technical, enablement)
  engine/rules.json           ← adaptive-engine weights and thresholds
src/mantle/
  content/   schemas.ts (Zod) · load.ts (discover, validate, cross-ref, cycle check, publication gates) · registry.ts
  engine/    plan.ts (rules-v1 planner, pure, < 50 ms) · bkt.ts (mastery) · graph.ts (concept DAG)
  store/     types.ts (repository interface) · dexie-store.ts (IndexedDB) · memory-store.ts (test fake) · sync.ts (union merge)
  identity/  bundle.ts (export/import: PBKDF2 → AES-GCM + HMAC)
  session/   session.ts (bounded session loop) · rung.ts (degradation ladder, capability flags)
  cards/     scheduler.ts (FSRS via ts-fsrs)
  runtime.ts ← the application core: evidence → mastery → re-plan → span
src/labs/    engine kit: sequence-stepper, eight-numbers, gateway-pipeline, prompt-coach, scenario-sim; lazy-loaded
src/mantle/studio/  item health, activity, semver helpers for the content studio
src/routes/  onboarding, plan, tentacle, concept, lab, check, drill, review, map, trace, studio, settings
```

Dependencies point downward only. Every layer above storage runs against the in-memory fake in tests, and the browser runs against Dexie.

### The six components, running

| Component | In Mantle | Invariant it keeps |
| --- | --- | --- |
| Orchestrator | Learning session loop (`session.ts`, `runtime.ts`) | Every session terminates with a typed reason (`step-ceiling`, `wall-clock`, `token-budget`, `no-progress`, `idle`) and emits a trace. A reload resumes the open session, and a stale one is closed first. |
| Reasoning model | AI tutor and grader (Phase 2, API mode) | Returns a proposal. A proposed plan is accepted only if `validatePlan` keeps prerequisite order. |
| Tool gateway | AI gateway (Phase 2) | Allowlist, schema validation, timeout, typed result; authorization runs before validation |
| Memory | Repository interface, four stores | Every mastery row carries its evidence id, `validFrom` and `recordedAt`. Logs are append-only. |
| Guardrails | Session bounds, cost governor (Phase 2) | The budget is checked before a step runs, not after |
| Observability | `TelemetryEvent` spans, `/trace` | One span per learner step, carrying rung, tokens and cost |

### Adaptive engine (rules-v1, no API)

`plan(inputs, graph, rules) → CurriculumPlan` is a pure function:

1. Build the frontier: concepts whose prerequisites are already mastered or planned earlier.
2. Score each one: goal relevance × 0.35, leverage × 0.25, mastery gap × 0.25, recency × 0.15.
3. Pick the depth layer: L1 below 0.4, L2 up to 0.7, L3 above that. An interview goal less than 4 weeks away goes straight to L3. Non-technical roles are capped at L2. Remediation drops one level.
4. Fit the plan to the weekly time budget, reserving time for due cards first.
5. Emit a versioned plan with an inputs hash, so an unchanged state never re-plans.

Every re-plan explains itself, for example "Re-planned because mastery on The bounded loop rose above 0.7". The weights live in `content/engine/rules.json`, not in code.

## Add a tentacle

1. Create `content/tentacles/<id>/manifest.json`. The route must be `/t/<id>`, and each lab names an engine from `src/labs/engines.ts`.
2. Add `concepts/*.json`, `cards.json` (at least 3 cards per objective), `checks.json` and `drills.json`.
3. Run `npm run validate:content`. It checks schemas, references, cross-tentacle prerequisites, acyclicity, coverage and language.
4. That's all. The registry discovers the folder, and the plan, radar and routes pick it up.

A package that fails validation is reported and skipped. It never crashes the portal.

## Roadmap

| Phase | Scope |
| --- | --- |
| 0 ✅ | Mantle shell, offline identity, Dexie store with migrations, tentacle registry, Foundations, adaptive engine v1, progress radar, trace view, CI gates |
| **1 (this)** | Enablement Basics (non-technical track), Tools, Gateway & MCP tentacle, audience rules, content studio, concept map |
| 2 | API mode: FastAPI gateway, Postgres with RLS, OAuth 2.1 + PKCE, Claude tutor and grader behind the gateway, golden-set eval harness |
| 3+ | Remaining tentacles (tools & MCP, memory, multi-agent, evaluation, cost, safety…), capstone, 3D map |

## Sources and attribution

The curriculum is structured around *Cracking Agentic AI System Design Interviews* (AI Engineering Insider, 1st ed.). Each tentacle manifest cites its chapters (`bookSource`). All explanations, labs, cards and questions are original wording: no passages or figures are reproduced. Lab ideas may later be ported from the MIT-licensed [`agentic-ai-lab`](https://github.com/lamhotsiagian/agentic-ai-lab) repository, with attribution.
