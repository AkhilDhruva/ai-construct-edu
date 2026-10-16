"""Identity. The browser mints the learner ULID offline; signing in proves who owns it.
The API verifies the identity provider's JWT (OAuth 2.1 + PKCE happens between the
browser and the provider), then binds the token subject to the ULID once. Every
request carries the principal down to the storage row (see db.Database.scope)."""

import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from .db import Database, identities
from .settings import Settings

ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
Role = Literal["learner", "mentor", "admin"]


@dataclass(frozen=True)
class Principal:
    sub: str
    learner_id: str | None
    role: Role


class TokenVerifier:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._jwks: jwt.PyJWKClient | None = None
        if settings.auth_mode == "dev" and settings.env == "prod":
            raise RuntimeError("auth_mode=dev is refused in prod")
        if settings.auth_mode == "jwks":
            if not settings.jwks_url:
                raise RuntimeError("auth_mode=jwks needs MANTLE_JWKS_URL")
            self._jwks = jwt.PyJWKClient(settings.jwks_url, cache_keys=True)
        if settings.auth_mode == "hs256" and not settings.jwt_secret:
            raise RuntimeError("auth_mode=hs256 needs MANTLE_JWT_SECRET")

    def verify(self, token: str) -> dict:
        opts = {"require": ["sub", "exp"]}
        aud = self.s.jwt_audience
        try:
            if self.s.auth_mode == "jwks":
                assert self._jwks is not None
                key = self._jwks.get_signing_key_from_jwt(token).key
                return jwt.decode(
                    token, key, algorithms=["RS256", "ES256"], audience=aud, issuer=self.s.jwt_issuer, options=opts
                )
            secret = self.s.jwt_secret if self.s.auth_mode == "hs256" else self.s.dev_jwt_secret
            return jwt.decode(token, secret, algorithms=["HS256"], audience=aud, issuer=self.s.jwt_issuer, options=opts)
        except jwt.PyJWTError as e:
            raise HTTPException(401, f"invalid token: {e}") from e

    def mint_dev(self, sub: str, minutes: int = 60) -> str:
        if self.s.auth_mode != "dev":
            raise HTTPException(404, "not found")
        now = int(time.time())
        claims = {"sub": sub, "iat": now, "exp": now + minutes * 60, "aud": self.s.jwt_audience}
        if self.s.jwt_issuer:
            claims["iss"] = self.s.jwt_issuer
        return jwt.encode(claims, self.s.dev_jwt_secret, algorithm="HS256")


def bearer(request: Request) -> str:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    return h[7:].strip()


def resolve_principal(db: Database, settings: Settings, claims: dict) -> Principal:
    sub = str(claims["sub"])
    with db.scope(sub=sub) as conn:
        row = conn.execute(select(identities).where(identities.c.sub == sub)).first()
    role: Role = "admin" if sub in settings.admin_subs else (row.role if row else "learner")
    return Principal(sub=sub, learner_id=row.learner_id if row else None, role=role)


def bind_learner(db: Database, principal: Principal, learner_id: str) -> Principal:
    """First sign-in claims the browser's ULID. Later sign-ins return the bound ULID so a
    second device switches to it instead of creating a split identity."""
    if not ULID_RE.match(learner_id):
        raise HTTPException(422, "learnerId must be a ULID")
    if principal.learner_id:
        return principal
    with db.scope(sub=principal.sub, learner_id=learner_id) as conn:
        taken = conn.execute(select(identities.c.sub).where(identities.c.learner_id == learner_id)).first()
        if taken and taken.sub != principal.sub:
            raise HTTPException(409, "this learner ID is bound to another account")
        try:
            conn.execute(
                insert(identities).values(
                    sub=principal.sub,
                    learner_id=learner_id,
                    role=principal.role,
                    created_at=datetime.now(UTC).isoformat(),
                )
            )
        except IntegrityError as e:
            # On Postgres, RLS hides other accounts' identity rows, so the unique
            # constraint is what reports a learner ID already claimed elsewhere.
            raise HTTPException(409, "this learner ID is bound to another account") from e
    return Principal(principal.sub, learner_id, principal.role)


def require_role(*roles: Role):
    def dep(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
        if principal.role not in roles:
            raise HTTPException(403, "forbidden")
        return principal

    return dep


def current_principal(request: Request) -> Principal:
    app = request.app.state
    claims = app.verifier.verify(bearer(request))
    return resolve_principal(app.db, app.settings, claims)


def bound_principal(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
    """Routes that touch learner data need a bound learner ID."""
    if not principal.learner_id:
        raise HTTPException(409, "bind a learner ID first (POST /v1/identity/bind)")
    return principal
