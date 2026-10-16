"""Read-only view of the same content the web app ships. The TypeScript Zod gates in CI
are the source of truth for validity; this loader only picks the fields the API needs."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Criterion:
    id: str
    criterion: str
    levels: list[str]


@dataclass(frozen=True)
class Drill:
    id: str
    title: str
    prompt: str
    pass_mark: int
    rubric: list[Criterion]


@dataclass(frozen=True)
class CoachScenario:
    id: str
    title: str
    situation: str


@dataclass(frozen=True)
class RedFlag:
    id: str
    label: str
    pattern: str
    advice: str


@dataclass
class Content:
    concepts: dict[str, dict[str, Any]]
    drills: dict[str, Drill]
    coach_scenarios: dict[str, CoachScenario]
    coach_elements: list[dict[str, Any]]
    red_flags: list[RedFlag]

    def concept_brief(self, concept_id: str) -> dict[str, Any] | None:
        c = self.concepts.get(concept_id)
        if not c:
            return None
        return {
            "id": c["id"],
            "title": c["title"],
            "point": c["point"],
            "definition": c["definition"],
            "objective": c["objective"]["text"],
            "misconceptions": c["misconceptions"],
            "prerequisites": c["prerequisites"],
        }


def load_content(root: Path) -> Content:
    concepts: dict[str, dict[str, Any]] = {}
    drills: dict[str, Drill] = {}
    coach_scenarios: dict[str, CoachScenario] = {}
    coach_elements: list[dict[str, Any]] = []
    red_flags: list[RedFlag] = []
    for tentacle in sorted((root / "tentacles").iterdir()):
        if not (tentacle / "manifest.json").exists():
            continue
        manifest = json.loads((tentacle / "manifest.json").read_text(encoding="utf-8"))
        for f in sorted((tentacle / "concepts").glob("*.json")):
            c = json.loads(f.read_text(encoding="utf-8"))
            concepts[c["id"]] = c
        drills_file = tentacle / manifest["drills"]
        if drills_file.exists():
            for d in json.loads(drills_file.read_text(encoding="utf-8"))["drills"]:
                drills[d["id"]] = Drill(
                    id=d["id"],
                    title=d["title"],
                    prompt=d["prompt"],
                    pass_mark=d["passMark"],
                    rubric=[Criterion(r["id"], r["criterion"], r["levels"]) for r in d["rubric"]],
                )
        for lab in manifest["labs"]:
            if lab["engine"] != "prompt-coach":
                continue
            s = json.loads((tentacle / lab["scenario"]).read_text(encoding="utf-8"))
            coach_elements = s["elements"]
            red_flags = [RedFlag(f["id"], f["label"], f["pattern"], f["advice"]) for f in s["redFlags"]]
            for sc in s["scenarios"]:
                coach_scenarios[sc["id"]] = CoachScenario(sc["id"], sc["title"], sc["situation"])
    return Content(concepts, drills, coach_scenarios, coach_elements, red_flags)
