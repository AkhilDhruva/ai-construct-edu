"""Apply migrations/postgres/*.sql in order, once each. Usage:
MANTLE_DATABASE_URL=postgresql+psycopg://... python -m mantle_api.migrate"""

import sys
from pathlib import Path

from sqlalchemy import create_engine, text

from .settings import get_settings

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations" / "postgres"


def migrate(url: str) -> list[str]:
    engine = create_engine(url, future=True)
    if engine.dialect.name != "postgresql":
        raise SystemExit("migrations target Postgres; SQLite databases are created by the app")
    applied: list[str] = []
    with engine.begin() as conn:
        conn.execute(
            text(
                "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())"
            )
        )
        done = {r[0] for r in conn.execute(text("select name from schema_migrations"))}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.name in done:
                continue
            conn.exec_driver_sql(f.read_text(encoding="utf-8"))
            conn.execute(text("insert into schema_migrations (name) values (:n)"), {"n": f.name})
            applied.append(f.name)
    return applied


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else get_settings().database_url
    print("applied:", migrate(url) or "nothing new")
