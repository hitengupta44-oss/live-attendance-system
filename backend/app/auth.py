"""Request authentication: Supabase login token -> staff profile (admin / teacher)."""
from fastapi import Depends, HTTPException, Request

from . import config, supa
from .db import get_db


def current_user(request: Request) -> dict:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Not logged in")
    if not all(config.REQUIRED_SECRETS.values()):
        raise HTTPException(503, "Server is not configured yet (Supabase secrets missing on the Space).")
    auth_user = supa.get_user(header[7:].strip())
    if not auth_user:
        raise HTTPException(401, "Session expired, please log in again")
    with get_db() as conn:
        row = conn.execute("SELECT id::text AS id, full_name, role FROM profiles WHERE id = %s",
                           (auth_user["id"],)).fetchone()
    if not row:
        raise HTTPException(403, "This account is not set up for SmartAttend. Ask your admin.")
    return {**row, "email": auth_user.get("email")}


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Admin only")
    return user
