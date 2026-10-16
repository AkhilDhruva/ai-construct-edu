"""The AI tool gateway: the only path from a model's proposed tool call to an effect.
Order is fixed: authorise -> validate arguments -> execute with a timeout -> typed
result. Authorisation runs first so a denied principal never learns a tool's schema."""

import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from typing import Any, Literal

from jsonschema import Draft202012Validator

from .auth import Principal, Role

Status = Literal["SUCCESS", "EMPTY", "DENIED", "UNAVAILABLE", "INVALID"]


@dataclass(frozen=True)
class TypedResult:
    status: Status
    data: Any = None
    error: str | None = None

    def to_json(self) -> str:
        body: dict[str, Any] = {"status": self.status}
        if self.data is not None:
            body["data"] = self.data
        if self.error:
            body["error"] = self.error
        return json.dumps(body, default=str)

    @property
    def is_error(self) -> bool:
        return self.status in ("DENIED", "UNAVAILABLE", "INVALID")


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[Principal, dict[str, Any]], Any]
    roles: frozenset[Role] = field(default_factory=lambda: frozenset({"learner", "mentor", "admin"}))

    def definition(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema, "strict": True}


class Gateway:
    def __init__(self, tools: list[ToolSpec], timeout_s: float) -> None:
        self.tools = {t.name: t for t in tools}
        self.validators = {t.name: Draft202012Validator(t.input_schema) for t in tools}
        self.timeout_s = timeout_s
        self.pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tool")

    def definitions_for(self, principal: Principal) -> list[dict[str, Any]]:
        """Only allowlisted tools are ever shown to the model for this principal. Sorted
        so the tools block is byte-stable for prompt caching."""
        return [t.definition() for name, t in sorted(self.tools.items()) if principal.role in t.roles]

    def call(self, principal: Principal, name: str, args: Any) -> TypedResult:
        tool = self.tools.get(name)
        # 1. Authorise. Unknown tools and tools outside the principal's allowlist look the same.
        if tool is None or principal.role not in tool.roles:
            return TypedResult("DENIED", error=f"tool '{name}' is not available to this principal")
        # 2. Validate arguments against the tool's schema.
        errors = sorted(self.validators[name].iter_errors(args if isinstance(args, dict) else {}), key=str)
        if not isinstance(args, dict) or errors:
            msg = errors[0].message if errors else "arguments must be an object"
            return TypedResult("INVALID", error=msg)
        # 3. Execute under the caller's identity, with a per-call timeout.
        future = self.pool.submit(tool.handler, principal, args)
        try:
            data = future.result(timeout=self.timeout_s)
        except FutureTimeout:
            return TypedResult("UNAVAILABLE", error=f"timed out after {self.timeout_s:.1f} s")
        except Exception as e:  # noqa: BLE001 - every failure becomes a typed result
            return TypedResult("UNAVAILABLE", error=type(e).__name__)
        # 4. Type the result: an empty answer is EMPTY, not an error.
        if data is None or data == [] or data == {}:
            return TypedResult("EMPTY")
        return TypedResult("SUCCESS", data=data)
