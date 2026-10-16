"""API cost model for demos and pilots.

    uv run python -m evals.cost_model                       # estimates from measured prompt sizes
    uv run python -m evals.cost_model --count-tokens        # exact input tokens via the free count_tokens API
    uv run python -m evals.cost_model --markdown ../docs/cost-estimate.md

Inputs are measured from the prompts this API actually sends (system prompts, rubrics,
tool definitions, concept briefs, golden-set answers). Outputs, including adaptive
thinking, cannot be measured without live calls, so they are explicit low / likely /
high assumptions below; replace them with `usage` numbers from a live eval run
(`evals.run --model live --out report.json`) once you have one."""

import argparse
import json
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mantle_api.ai import (
    COACH_SCHEMA,
    COACH_SYSTEM,
    GRADER_SYSTEM,
    TUTOR_SYSTEM,
    grader_schema,
    rubric_text,
    tutor_tools,
)
from mantle_api.content import load_content
from mantle_api.db import Database
from mantle_api.models import PRICES
from mantle_api.settings import REPO_ROOT

HERE = Path(__file__).resolve().parent
PRIMARY, STANDBY = "claude-sonnet-5-5", "claude-haiku-4-5"
CACHE_MIN_TOKENS = 512  # minimum cacheable prompt on claude-sonnet-5-5

# Output tokens per call, including adaptive thinking (billed as output). (low, likely, high)
OUTPUT = {
    "grader": (1_200, 2_600, 5_000),  # effort "medium": ~500 visible JSON + thinking
    "tutor_tool_step": (80, 250, 700),  # effort "low": a tool call, little or no thinking
    "tutor_answer": (250, 500, 1_100),  # effort "low": ~180-word answer + some thinking
    "coach": (250, 450, 900),  # effort "low": rewrite + explanation
}
TUTOR_CALLS = (2, 2, 4)  # model calls per question: tool step(s) + answer
LONG_ANSWER_WORDS = 900  # a real 45-minute drill answer runs longer than the golden items


def est_tokens(text: str) -> int:
    """~4 characters per token for English prose and JSON. Use --count-tokens for exact inputs."""
    return max(1, round(len(text) / 4))


@dataclass
class CallShape:
    name: str
    model: str
    cached_prefix: int  # tokens before the cache breakpoint (system, tools, rubric), re-sent on every call
    dynamic_input: tuple[int, int, int]  # total across all calls of the action, after the breakpoint
    output: tuple[int, int, int]  # total across all calls of the action, thinking included
    calls: tuple[int, int, int] = (1, 1, 1)


def measure(count_tokens: bool) -> dict[str, CallShape]:
    content = load_content(REPO_ROOT / "content")
    golden = json.loads((HERE / "golden" / "grader.json").read_text(encoding="utf-8"))
    drills = list(content.drills.values())
    tools = [t.definition() for t in tutor_tools(Database("sqlite://"), content)]
    concept_briefs = [json.dumps({"status": "SUCCESS", "data": content.concept_brief(cid)}) for cid in content.concepts]

    counter = None
    if count_tokens:
        import anthropic

        client = anthropic.Anthropic()

        def counter(system: str, user: str, tools_: list[dict[str, Any]] | None = None) -> int:
            kwargs: dict[str, Any] = {
                "model": PRIMARY,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            }
            if tools_:
                kwargs["tools"] = tools_
            return client.messages.count_tokens(**kwargs).input_tokens

    def tok(system: str, user: str = ".", tools_: list[dict[str, Any]] | None = None) -> int:
        if counter:
            return counter(system, user, tools_)
        return est_tokens(system) + est_tokens(user) + (est_tokens(json.dumps(tools_)) if tools_ else 0)

    grader_prefix = statistics.mean(
        tok(GRADER_SYSTEM + "\n" + rubric_text(d) + json.dumps(grader_schema(d))) for d in drills
    )
    answers = [tok(".", i["answer"]) for i in golden["items"]]
    long_answer = round(LONG_ANSWER_WORDS * 1.35)  # ~1.35 tokens per English word
    tutor_prefix = tok(TUTOR_SYSTEM, ".", tools)
    brief = statistics.mean(tok(".", b) for b in concept_briefs)
    question = tok(
        ".",
        "<question>Why did the token budget fire before the step ceiling in my lab run?</question> concept_id: bounded-loop",
    )
    coach_prefix = tok(COACH_SYSTEM + json.dumps(COACH_SCHEMA))
    coach_user = statistics.mean(
        tok(
            ".",
            f"Workplace situation: {s.situation} <learner_prompt>Summarise these notes for the team.</learner_prompt>",
        )
        for s in content.coach_scenarios.values()
    )

    def tutor_input(calls: int, step_out: int) -> int:
        # Call i re-sends the question plus every earlier tool call and its result.
        return sum(question + 40 + i * (step_out + round(brief)) for i in range(calls))

    def tutor_output(calls: int, case: int) -> int:
        return (calls - 1) * OUTPUT["tutor_tool_step"][case] + OUTPUT["tutor_answer"][case]

    return {
        "grader": CallShape(
            "AI drill grade",
            PRIMARY,
            round(grader_prefix),
            (min(answers), long_answer, long_answer * 2),
            OUTPUT["grader"],
        ),
        "tutor": CallShape(
            "Tutor question",
            PRIMARY,
            tutor_prefix,
            tuple(tutor_input(TUTOR_CALLS[c], OUTPUT["tutor_tool_step"][c]) for c in range(3)),  # type: ignore[arg-type]
            tuple(tutor_output(TUTOR_CALLS[c], c) for c in range(3)),  # type: ignore[arg-type]
            TUTOR_CALLS,
        ),
        "coach": CallShape(
            "Coach rewrite",
            PRIMARY,
            coach_prefix,
            (round(coach_user), round(coach_user) + 60, round(coach_user) + 300),
            OUTPUT["coach"],
        ),
    }


def call_cost(shape: CallShape, case: int, cache_hit: float) -> float:
    """USD for one user action (which may be several model calls) at case 0/1/2 = low/likely/high."""
    p_in, p_out, p_read, p_write = (p / 1_000_000 for p in PRICES[shape.model])
    calls = shape.calls[case]
    cacheable = shape.cached_prefix >= CACHE_MIN_TOKENS
    # The prefix is re-sent on every call: a cache read when warm, a cache write when cold.
    prefix_cost = shape.cached_prefix * ((cache_hit * p_read + (1 - cache_hit) * p_write) if cacheable else p_in)
    return calls * prefix_cost + shape.dynamic_input[case] * p_in + shape.output[case] * p_out


@dataclass
class Scenario:
    name: str
    learners: int
    per_learner: dict[str, int]  # actions per learner over the scenario
    cache_hit: float
    note: str


SCENARIOS = [
    Scenario(
        "Reviewer walkthrough (1 person, ~30 min)",
        1,
        {"grader": 2, "tutor": 8, "coach": 4},
        0.6,
        "Hiring manager or reviewer clicks through every AI feature.",
    ),
    Scenario(
        "Live workshop (40 people, 90 min)",
        40,
        {"grader": 1, "tutor": 10, "coach": 5},
        0.9,
        "Bursty: caches stay warm while many people use the same prompts.",
    ),
    Scenario(
        "Pilot cohort, 1 month (100 learners)",
        100,
        {"grader": 4, "tutor": 60, "coach": 20},
        0.8,
        "1 drill, 15 tutor questions and 5 coach rewrites per learner per week.",
    ),
    Scenario(
        "Full scale, 1 month (1,000 learners)",
        1_000,
        {"grader": 4, "tutor": 60, "coach": 20},
        0.85,
        "Same per-learner usage as the pilot.",
    ),
    Scenario(
        "CI live grader eval (20 runs a month)",
        1,
        {"grader": 18 * 20},
        0.9,
        "The manual 'Grader eval (live model)' workflow: 18 golden items per run.",
    ),
]


def estimate(shapes: dict[str, CallShape]) -> list[dict[str, Any]]:
    rows = []
    for sc in SCENARIOS:
        costs = [
            sum(sc.learners * n * call_cost(shapes[k], case, sc.cache_hit) for k, n in sc.per_learner.items())
            for case in range(3)
        ]
        actions = sc.learners * sum(sc.per_learner.values())
        rows.append(
            {
                "scenario": sc.name,
                "actions": actions,
                "low": costs[0],
                "likely": costs[1],
                "high": costs[2],
                "note": sc.note,
            }
        )
    return rows


def budget_cap(daily_tokens: int = 200_000) -> dict[str, float]:
    """The governor's per-learner daily cap bounds the worst case regardless of usage."""
    p_in, p_out, _, _ = PRICES[PRIMARY]
    return {
        "allInputUsd": daily_tokens * p_in / 1e6,
        "allOutputUsd": daily_tokens * p_out / 1e6,
        "typicalMixUsd": daily_tokens * (0.75 * p_in + 0.25 * p_out) / 1e6,
    }


def _findings(shapes: dict[str, CallShape]) -> list[str]:
    g = shapes["grader"]
    p_out = PRICES[g.model][1] / 1e6
    out_share = g.output[1] * p_out / call_cost(g, 1, 0.8)
    small = [s.name for s in shapes.values() if s.cached_prefix < CACHE_MIN_TOKENS]
    lines = [
        f"- **Output dominates.** About {out_share:.0%} of a likely grading call is output and thinking. The first lever to measure is grader effort: "
        "re-run the live eval at `low` and keep it only if agreement and the safety gate hold.",
    ]
    if small:
        lines.append(
            f"- **Caching does not apply to: {', '.join(small)}.** Their stable prefixes are under the {CACHE_MIN_TOKENS}-token minimum, so "
            "`cache_control` there has no effect. They are cheap anyway; do not pad prompts to reach the minimum."
        )
    lines.append(
        "- **The live CI eval can run at roughly half price through the Message Batches API** (it is not latency-sensitive), "
        "but the server-side `fallbacks` parameter is rejected on batches, so batch runs need their own refusal handling."
    )
    return lines


def render(shapes: dict[str, CallShape], rows: list[dict[str, Any]], exact: bool) -> str:
    p = PRICES[PRIMARY]
    cap = budget_cap()
    out = [
        "# API cost estimate",
        "",
        f"Generated by `api/evals/cost_model.py` ({'exact input tokens via count_tokens' if exact else 'input sizes estimated at ~4 characters per token'}). "
        f"Prices: `{PRIMARY}` ${p[0]:.2f} input, ${p[1]:.2f} output, ${p[2]:.2f} cache read and ${p[3]:.2f} cache write per million tokens.",
        "",
        "## Per action",
        "",
        "| Action | Model calls | Cached prefix (tokens) | Dynamic input (tokens) | Output incl. thinking (tokens) | Cost, likely |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for s in shapes.values():
        out.append(
            f"| {s.name} | {s.calls[1]} | {s.cached_prefix:,}{'' if s.cached_prefix >= CACHE_MIN_TOKENS else ' (under the 512-token cache minimum)'} | "
            f"{s.dynamic_input[0]:,}–{s.dynamic_input[2]:,} | {s.output[0]:,}–{s.output[2]:,} | ${call_cost(s, 1, 0.8):.4f} |"
        )
    out += [
        "",
        "## Scenarios",
        "",
        "| Scenario | AI actions | Low | Likely | High |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        out.append(
            f"| {r['scenario']} | {r['actions']:,} | ${r['low']:,.2f} | ${r['likely']:,.2f} | ${r['high']:,.2f} |"
        )
    out += [
        "",
        "## Worst case per learner",
        "",
        f"The cost governor caps each learner at 200,000 tokens a day, so one learner can never cost more than about **${cap['allOutputUsd']:.2f} a day** "
        f"(if every token were output), and about ${cap['typicalMixUsd']:.2f} at a typical 3:1 input-to-output mix.",
        "",
        "## Findings",
        "",
        *_findings(shapes),
        "",
        "## Assumptions to replace with measurements",
        "",
        "- Output tokens include adaptive thinking, which is billed as output and is the largest uncertainty. The grader runs at effort `medium`, the tutor and coach at `low`.",
        "- Cache hit rates per scenario are assumptions; verify with `cache_read_input_tokens` in usage.",
        "- Standby (`claude-haiku-4-5`) traffic at rung 2 costs about half and is ignored here; server-side refusal fallbacks are rare and also ignored.",
        "- Hosting is not included (API host, Postgres, identity provider): small demos fit free or entry tiers; check current provider pricing.",
    ]
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--count-tokens",
        action="store_true",
        help="exact input tokens via the free count_tokens API (needs credentials)",
    )
    ap.add_argument("--markdown", type=Path)
    args = ap.parse_args()
    shapes = measure(args.count_tokens)
    rows = estimate(shapes)
    md = render(shapes, rows, args.count_tokens)
    print(md)
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(md, encoding="utf-8")


if __name__ == "__main__":
    main()
