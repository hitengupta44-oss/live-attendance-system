"""Thin client for Supabase Auth and Storage REST APIs (uses the secret key)."""
from __future__ import annotations

import hashlib
import threading
import time
from urllib.parse import quote

import httpx

from . import config

_client = httpx.Client(timeout=30)


def _svc_headers() -> dict[str, str]:
    h = {"apikey": config.SUPABASE_SECRET_KEY}
    # Legacy service_role keys are JWTs and also go in Authorization.
    # New "sb_secret_…" keys must only be sent as apikey.
    if config.SUPABASE_SECRET_KEY.startswith("eyJ"):
        h["Authorization"] = f"Bearer {config.SUPABASE_SECRET_KEY}"
    return h


def _err(r: httpx.Response) -> str:
    try:
        j = r.json()
        return j.get("msg") or j.get("message") or j.get("error_description") or j.get("error") or r.text
    except ValueError:
        return r.text or r.reason_phrase


class SupabaseError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- auth
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def get_user(access_token: str) -> dict | None:
    """Validate a user's login token with Supabase Auth. Cached for 60 s."""
    key = hashlib.sha256(access_token.encode()).hexdigest()
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    r = _client.get(f"{config.SUPABASE_URL}/auth/v1/user",
                    headers={"apikey": config.SUPABASE_SECRET_KEY, "Authorization": f"Bearer {access_token}"})
    if r.status_code != 200:
        return None
    user = r.json()
    with _cache_lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (now + 60, user)
    return user


def admin_create_user(email: str, password: str, full_name: str) -> str:
    r = _client.post(f"{config.SUPABASE_URL}/auth/v1/admin/users", headers=_svc_headers(),
                     json={"email": email, "password": password, "email_confirm": True,
                           "user_metadata": {"full_name": full_name}})
    if r.status_code not in (200, 201):
        raise SupabaseError(r.status_code, _err(r))
    return r.json()["id"]


def admin_delete_user(user_id: str) -> None:
    _client.delete(f"{config.SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=_svc_headers())


# ---------------------------------------------------------------- storage
def _obj_url(bucket: str, path: str) -> str:
    return f"{config.SUPABASE_URL}/storage/v1/object/{bucket}/{quote(path)}"


def upload(bucket: str, path: str, data: bytes, content_type: str = "image/jpeg") -> None:
    r = _client.post(_obj_url(bucket, path), content=data,
                     headers={**_svc_headers(), "Content-Type": content_type, "x-upsert": "true"})
    if r.status_code not in (200, 201):
        raise SupabaseError(r.status_code, f"Storage upload failed: {_err(r)}")


def download(bucket: str, path: str) -> bytes:
    r = _client.get(_obj_url(bucket, path), headers=_svc_headers())
    if r.status_code != 200:
        raise SupabaseError(r.status_code, f"Storage download failed: {_err(r)}")
    return r.content


def remove(bucket: str, paths: list[str]) -> None:
    if not paths:
        return
    _client.request("DELETE", f"{config.SUPABASE_URL}/storage/v1/object/{bucket}",
                    headers=_svc_headers(), json={"prefixes": paths})
