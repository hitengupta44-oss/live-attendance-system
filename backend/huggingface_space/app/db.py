"""Postgres (Supabase) connection pool. The schema lives in supabase/01_schema.sql."""
from __future__ import annotations

from contextlib import contextmanager

import numpy as np
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config

_pool: ConnectionPool | None = None


def open_pool() -> None:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            config.DATABASE_URL, min_size=1, max_size=5, open=True, timeout=20,
            # prepare_threshold=None keeps it working through Supabase's pooler in any mode
            kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": False},
        )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def get_db():
    """One transaction: commits on success, rolls back on any exception."""
    if _pool is None:
        raise RuntimeError("Database is not configured (DATABASE_URL secret missing)")
    with _pool.connection() as conn:
        yield conn


def vec(e: np.ndarray) -> str:
    """numpy embedding -> pgvector text literal."""
    return "[" + ",".join(f"{float(x):.7f}" for x in e) + "]"


def audit(conn, user_id: str | None, action: str, **details) -> None:
    conn.execute("INSERT INTO audit_log (user_id, action, details) VALUES (%s, %s, %s)",
                 (user_id, action, Jsonb(details)))
