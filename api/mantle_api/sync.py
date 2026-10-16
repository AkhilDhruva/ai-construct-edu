"""Offline-first sync. The browser's IndexedDB stays the working copy; the server keeps
the durable copy. Both sides merge the same way as src/mantle/store/sync.ts: append-only
logs by union on id, the learner profile last-write-wins, card states latest review wins.
Nothing is ever overwritten or deleted by a sync."""

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Connection, Table, insert, select, update

from .db import attempts, card_states, events, learners, mastery, plans

LOGS: dict[str, tuple[Table, str, str]] = {
    "attempts": (attempts, "at", "at"),
    "mastery": (mastery, "recorded_at", "recordedAt"),
    "plans": (plans, "generated_at", "generatedAt"),
    "events": (events, "start", "start"),
}
MAX_ROWS = 20_000


def _ts(s: str | None) -> float:
    if not s:
        return 0.0
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _check_owner(snap: dict[str, Any], learner_id: str) -> None:
    learner = snap.get("learner") or {}
    if learner.get("id") != learner_id:
        raise HTTPException(403, "snapshot belongs to a different learner")
    for key in ("cardStates", *LOGS):
        rows = snap.get(key) or []
        if not isinstance(rows, list) or len(rows) > MAX_ROWS:
            raise HTTPException(422, f"{key} must be a list of at most {MAX_ROWS} rows")
        for r in rows:
            if not isinstance(r, dict) or r.get("learnerId") != learner_id:
                raise HTTPException(403, f"{key} contains rows for another learner")
            if key != "cardStates" and not isinstance(r.get("id"), str):
                raise HTTPException(422, f"{key} rows need an id")


def merge(conn: Connection, learner_id: str, snap: dict[str, Any]) -> dict[str, int | str]:
    _check_owner(snap, learner_id)
    report: dict[str, int | str] = {}

    incoming = snap["learner"]
    row = conn.execute(select(learners.c.payload).where(learners.c.id == learner_id)).first()
    if row is None:
        conn.execute(
            insert(learners).values(
                id=learner_id, learner_id=learner_id, payload=incoming, updated_at=incoming.get("updatedAt", "")
            )
        )
        report["learner"] = "created"
    else:
        local = row[0]
        introduced = sorted(set(local.get("introduced", [])) | set(incoming.get("introduced", [])))
        newer = _ts(incoming.get("updatedAt")) > _ts(local.get("updatedAt"))
        winner = {**(incoming if newer else local), "introduced": introduced}
        conn.execute(
            update(learners)
            .where(learners.c.id == learner_id)
            .values(payload=winner, updated_at=winner.get("updatedAt", ""))
        )
        report["learner"] = "took-incoming" if newer else "kept-server"

    changed = 0
    existing = {
        r.card_id: r.reviewed_at
        for r in conn.execute(
            select(card_states.c.card_id, card_states.c.reviewed_at).where(card_states.c.learner_id == learner_id)
        )
    }
    for cs in snap.get("cardStates") or []:
        reviewed = cs.get("last_review") or cs.get("updatedAt") or ""
        cid = cs.get("cardId")
        if cid not in existing:
            conn.execute(
                insert(card_states).values(learner_id=learner_id, card_id=cid, payload=cs, reviewed_at=reviewed)
            )
            changed += 1
        elif _ts(reviewed) > _ts(existing[cid]):
            conn.execute(
                update(card_states)
                .where(card_states.c.learner_id == learner_id, card_states.c.card_id == cid)
                .values(payload=cs, reviewed_at=reviewed)
            )
            changed += 1
    report["cardStates"] = changed

    for key, (table, col, field) in LOGS.items():
        rows = snap.get(key) or []
        have = {r[0] for r in conn.execute(select(table.c.id).where(table.c.learner_id == learner_id))}
        fresh = [r for r in rows if r["id"] not in have]
        if fresh:
            conn.execute(
                insert(table),
                [{"id": r["id"], "learner_id": learner_id, "payload": r, col: r.get(field, "")} for r in fresh],
            )
        report[key] = len(fresh)
    return report


def snapshot(conn: Connection, learner_id: str) -> dict[str, Any] | None:
    row = conn.execute(select(learners.c.payload).where(learners.c.id == learner_id)).first()
    if row is None:
        return None
    out: dict[str, Any] = {"learner": row[0]}
    out["cardStates"] = [
        r[0] for r in conn.execute(select(card_states.c.payload).where(card_states.c.learner_id == learner_id))
    ]
    for key, (table, col, _f) in LOGS.items():
        out[key] = [
            r[0]
            for r in conn.execute(
                select(table.c.payload).where(table.c.learner_id == learner_id).order_by(table.c[col])
            )
        ]
    return out
