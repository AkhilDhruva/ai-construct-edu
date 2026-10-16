from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Every knob is an environment variable (prefix MANTLE_), so the same image runs
    locally on SQLite with the mock model and in production on Postgres with Claude."""

    model_config = SettingsConfigDict(env_prefix="MANTLE_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "sqlite:///./mantle.db"
    content_dir: Path = REPO_ROOT / "content"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5317", "http://localhost:4317", "http://localhost:5173"]
    )

    # Auth. "jwks": any OIDC issuer (Supabase Auth's asymmetric keys, Clerk, …).
    # "hs256": a shared-secret issuer (Supabase legacy JWT secret). "dev": local tokens
    # minted by /dev/token; refused when env is prod.
    auth_mode: Literal["jwks", "hs256", "dev"] = "dev"
    jwt_issuer: str | None = None
    jwt_audience: str | None = "authenticated"
    jwks_url: str | None = None
    jwt_secret: str | None = None
    dev_jwt_secret: str = "mantle-dev-only-secret-change-me-32bytes"  # noqa: S105 - dev mode only; refused in prod
    admin_subs: list[str] = Field(default_factory=list)

    # Models. "live" calls Claude through the Anthropic SDK (credentials from the
    # environment); "mock" is deterministic and free, for tests and keyless dev;
    # "off" disables AI features (the portal degrades to its offline floor).
    model_mode: Literal["live", "mock", "off"] = "mock"
    model_primary: str = "claude-sonnet-5-5"
    model_standby: str = "claude-haiku-4-5"
    fallbacks_enabled: bool = True

    # Cost governor and ladder thresholds.
    daily_token_budget: int = 200_000
    cost_alert_multiplier: float = 3.0
    grader_slow_p95_ms: int = 8_000
    saturation_window_s: int = 60

    # Tutor loop bounds (the same four bounds the Foundations lab teaches).
    tutor_max_steps: int = 6
    tutor_token_budget: int = 20_000
    tutor_wall_clock_s: float = 60.0
    tool_timeout_s: float = 2.0

    otel_service_name: str = "mantle-api"


@lru_cache
def get_settings() -> Settings:
    return Settings()
