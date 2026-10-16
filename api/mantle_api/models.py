"""Model access. Every call names a route (grader, tutor, coach) so the governor, the
ladder and telemetry can attribute cost and latency. Two implementations share one
interface: LiveModel (Claude through the Anthropic SDK) and MockModel (deterministic,
free, used by tests, CI evals and keyless local development)."""

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import anthropic

Route = Literal["grader", "tutor", "coach"]

# $ per million tokens: input, output, cache read, 5-minute cache write.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-sonnet-5": (2.00, 10.00, 0.20, 2.50),
    "claude-haiku-4-5": (1.00, 5.00, 0.10, 1.25),
}


class ModelSaturated(Exception):
    """429 or 529 from the provider: the ladder steps down to the standby model."""


class ModelUnavailable(Exception):
    """Network failure, timeout or 5xx: the caller returns a typed UNAVAILABLE."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens + self.cache_read_tokens + self.cache_write_tokens


@dataclass
class ModelReply:
    model: str
    blocks: list[dict[str, Any]]
    """Normalised blocks: {"type": "text", "text"} or {"type": "tool_use", "id", "name", "input"}."""
    raw_content: Any
    """What to append as the assistant turn (SDK blocks for live: thinking blocks pass back unchanged)."""
    stop_reason: str
    usage: Usage
    latency_ms: int
    mock: bool = False
    fallback_used: bool = False

    @property
    def text(self) -> str:
        return "".join(b["text"] for b in self.blocks if b["type"] == "text")

    @property
    def tool_uses(self) -> list[dict[str, Any]]:
        return [b for b in self.blocks if b["type"] == "tool_use"]

    def cost_usd(self) -> float:
        if self.mock:
            return 0.0
        p_in, p_out, p_read, p_write = PRICES.get(self.model, PRICES["claude-sonnet-5-5"])
        u = self.usage
        return (
            u.input_tokens * p_in
            + u.output_tokens * p_out
            + u.cache_read_tokens * p_read
            + u.cache_write_tokens * p_write
        ) / 1_000_000


class ModelClient(Protocol):
    mode: str

    def create(
        self,
        *,
        route: Route,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        effort: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        json_schema: dict[str, Any] | None = None,
    ) -> ModelReply: ...


def _supports_effort(model: str) -> bool:
    # Haiku 4.5 rejects output_config.effort; current Sonnet/Opus models accept it.
    return not model.startswith("claude-haiku")


class LiveModel:
    mode = "live"

    def __init__(self, fallbacks: bool = True, timeout_s: float = 45.0) -> None:
        # Credentials resolve from the environment (ANTHROPIC_API_KEY or an `ant` profile).
        # The ladder handles degradation, so SDK retries stay low to fail fast.
        self.client = anthropic.Anthropic(timeout=timeout_s, max_retries=1)
        self.fallbacks = fallbacks

    def create(self, *, route, model, system, messages, max_tokens, effort=None, tools=None, json_schema=None):
        kwargs: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        output_config: dict[str, Any] = {}
        if json_schema:
            output_config["format"] = {"type": "json_schema", "schema": json_schema}
        if effort and _supports_effort(model):
            output_config["effort"] = effort
        if output_config:
            kwargs["output_config"] = output_config
        betas: list[str] = []
        if self.fallbacks and model == "claude-sonnet-5-5":
            # Server-side refusal fallback: a declined request re-runs on the model
            # Anthropic recommends for that refusal category, inside the same call.
            betas.append("server-side-fallback-2026-07-01")
            kwargs["fallbacks"] = "default"
        if betas:
            kwargs["betas"] = betas
        started = time.perf_counter()
        try:
            resp = self.client.beta.messages.create(**kwargs)
        except (anthropic.RateLimitError, anthropic.OverloadedError) as e:
            raise ModelSaturated(str(e)) from e
        except (anthropic.APITimeoutError, anthropic.APIConnectionError, anthropic.InternalServerError) as e:
            raise ModelUnavailable(str(e)) from e
        latency = int((time.perf_counter() - started) * 1000)
        blocks: list[dict[str, Any]] = []
        for b in resp.content:
            if b.type == "text":
                blocks.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                blocks.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
        u = resp.usage
        usage = Usage(
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
        )
        fallback_used = any(
            getattr(it, "type", None) == "fallback_message" for it in (getattr(u, "iterations", None) or [])
        )
        return ModelReply(
            model=resp.model,
            blocks=blocks,
            raw_content=resp.content,
            stop_reason=resp.stop_reason or "end_turn",
            usage=usage,
            latency_ms=latency,
            fallback_used=fallback_used,
        )


# ── Deterministic mock ───────────────────────────────────────────────────────

_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_INJECTION = re.compile(
    r"\b(grader|ignore (the|all|previous)|system notice|award|score this|automatically score)\b", re.I
)
_NUMBER = re.compile(
    r"\d[\d,.]*\s*(%|ms|s\b|seconds?|minutes?|tokens?|per (day|minute|second|run)|/s|k\b|\$)|\$\s?\d", re.I
)
_SIGNALS: dict[str, list[re.Pattern[str]]] = {
    "requirements-as-numbers": [_NUMBER],
    "architecture-with-decision-rule": [
        re.compile(r"\b(because|rather than|instead of|so that|choose|chose|decision rule|over a)\b", re.I),
        re.compile(r"\b(loop|router|pipeline|gateway|planner|cascade|queue|cache|verifier)\b", re.I),
    ],
    "trade-off-named": [re.compile(r"\b(trade-?off|accept|at the cost of|in exchange|give up|costs? us)\b", re.I)],
    "measurement-named": [
        re.compile(
            r"\b(measure|metric|p95|p99|rate|alert|dashboard|would show|tells? me|if .* (rises|drops|exceeds))\b", re.I
        )
    ],
}


def mock_grade(answer: str, criteria: list[str]) -> dict[str, Any]:
    sentences = [s.strip() for s in _SENTENCE.split(answer) if s.strip() and not _INJECTION.search(s)]
    out = []
    for cid in criteria:
        pats = _SIGNALS.get(cid, [])
        # A sentence "hits" on the primary signal; it is "strong" when every signal agrees.
        hits = [s for s in sentences if pats and pats[0].search(s)]
        strong = [s for s in hits if all(p.search(s) for p in pats)]
        score = min(3, len(strong))
        if score == 0 and hits:
            score = 1
        cite = (strong or hits or [""])[0]
        out.append({"id": cid, "score": score, "citation": cite, "rationale": f"{len(hits)} matching sentence(s)"})
    return {"criteria": out, "summary": "Deterministic mock grading by sentence-level signals."}


def _mock_tutor_answer(tool_result: str) -> str:
    """Readable text from whatever the one tool call returned (no model involved)."""
    try:
        data = json.loads(tool_result).get("data")
    except (json.JSONDecodeError, AttributeError):
        data = None
    if isinstance(data, dict) and "point" in data:
        mis = data.get("misconceptions") or [{}]
        return (
            f"(mock tutor) {data['title']}: {data['point']} {data.get('definition', '')} "
            f"A common mistake: {mis[0].get('claim', '')} {mis[0].get('correction', '')} "
            f"Check yourself: {data.get('objective', '')}"
        ).strip()
    if isinstance(data, list) and data:
        rows = ", ".join(
            f"{d.get('conceptId')} {round(d.get('mastery', 0) * 100)}%" for d in data[:6] if isinstance(d, dict)
        )
        return f"(mock tutor) Your current mastery: {rows}. Start with the lowest one."
    return "(mock tutor) I could not find anything to ground an answer in. Open the concept explainer first."


def _approx_tokens(obj: Any) -> int:
    return max(1, len(json.dumps(obj, default=str)) // 4)


@dataclass
class MockModel:
    """Deterministic stand-in. It never follows instructions inside learner text, which
    is what the injection items in the eval set check for."""

    mode: str = "mock"
    latency_ms: int = 5
    calls: list[dict[str, Any]] = field(default_factory=list)

    def create(self, *, route, model, system, messages, max_tokens, effort=None, tools=None, json_schema=None):
        self.calls.append({"route": route, "model": model})
        if route == "grader":
            text = (
                messages[-1]["content"]
                if isinstance(messages[-1]["content"], str)
                else messages[-1]["content"][0]["text"]
            )
            answer = text.split("<learner_answer>")[-1].split("</learner_answer>")[0].strip()
            criteria = json_schema["properties"]["criteria"]["items"]["properties"]["id"]["enum"] if json_schema else []
            blocks = [{"type": "text", "text": json.dumps(mock_grade(answer, criteria))}]
        elif route == "coach":
            text = (
                messages[-1]["content"]
                if isinstance(messages[-1]["content"], str)
                else messages[-1]["content"][0]["text"]
            )
            prompt = text.split("<learner_prompt>")[-1].split("</learner_prompt>")[0].strip()
            rewrite = (
                "You are an experienced colleague in this team. "
                f"Task: {prompt.rstrip('.')}. "
                "Context: the audience is the project team and the goal is a clear, accurate result. "
                "Format: up to 5 bullet points, under 150 words, plain language."
            )
            body = {
                "rewrite": rewrite,
                "explanation": "Added a role, stated the audience and goal, and fixed the output format.",
                "elementsAdded": ["role", "context", "format"],
            }
            blocks = [{"type": "text", "text": json.dumps(body)}]
        else:  # tutor: one read-only tool call, then an answer built from its result
            last = messages[-1]
            had_tool_result = isinstance(last["content"], list) and any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in last["content"]
            )
            if not had_tool_result and tools:
                ctx = json.dumps(messages[0]["content"])
                m = re.search(r'concept_id[\\"]*:\s*[\\"]*([a-z0-9-]+)', ctx)
                name, args = ("get_concept", {"concept_id": m.group(1)}) if m else ("get_my_mastery", {})
                if name not in {t["name"] for t in tools}:
                    name, args = tools[0]["name"], {}
                blocks = [{"type": "tool_use", "id": f"toolu_mock_{len(self.calls)}", "name": name, "input": args}]
            else:
                result = last["content"][0].get("content", "") if had_tool_result else ""
                blocks = [{"type": "text", "text": _mock_tutor_answer(str(result))}]
        stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
        usage = Usage(input_tokens=_approx_tokens([system, messages]), output_tokens=_approx_tokens(blocks))
        return ModelReply(
            model=f"mock:{model}",
            blocks=blocks,
            raw_content=blocks,
            stop_reason=stop,
            usage=usage,
            latency_ms=self.latency_ms,
            mock=True,
        )
