"""Internal FastAPI service (stubs): /health /evaluate /best-move.

Off the hot path; the backend calls here for analysis jobs only. Auth is a
shared internal header (ENGINE_INTERNAL_TOKEN — env key to be formalised in
Phase 04; falls back to refusing when unset in production).
"""
from __future__ import annotations
import os
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from ..evaluation.features import extract, score, FEATURE_VERSION

app = FastAPI(title="project-nexus python-engine (stub)")


def _check_auth(x_internal_token: str | None) -> None:
    expected = os.getenv("ENGINE_INTERNAL_TOKEN", "")
    if not expected:
        if os.getenv("NODE_ENV") == "production":
            raise HTTPException(status_code=503, detail="internal token not configured")
        return  # dev/test without token: allow, warn via health
    if x_internal_token != expected:
        raise HTTPException(status_code=401, detail="bad internal token")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "python-engine-stub", "features": FEATURE_VERSION,
            "auth_configured": bool(os.getenv("ENGINE_INTERNAL_TOKEN"))}


class EvaluateBody(BaseModel):
    state: dict = Field(description="Serialised GameState-ish mapping")
    player: int = Field(ge=0, le=1)


@app.post("/evaluate")
def evaluate(body: EvaluateBody, x_internal_token: str | None = Header(default=None)):
    _check_auth(x_internal_token)
    feats = extract(body.state, body.player)
    return {"features": feats, "score": score(feats), "version": FEATURE_VERSION}


class BestMoveBody(BaseModel):
    state: dict
    player: int = Field(ge=0, le=1)
    depth: int = Field(default=2, ge=1, le=4)


@app.post("/best-move")
def best_move(body: BestMoveBody, x_internal_token: str | None = Header(default=None)):
    _check_auth(x_internal_token)
    # Stub: full search binds in Phase 09; echo heuristic so callers can integrate.
    feats = extract(body.state, body.player)
    return {"stub": True, "score": score(feats),
            "note": "alpha-beta binding lands in Phase 09; no move returned yet."}
