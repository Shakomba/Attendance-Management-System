from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Sequence

try:
    import pyodbc  # type: ignore
except Exception:  # pragma: no cover
    pyodbc = None

from .config import settings


def build_connection_string() -> str:
    if settings.sql_connection_string:
        return settings.sql_connection_string

    trust_value = "yes" if settings.sql_trust_server_cert else "no"
    return (
        f"DRIVER={{{settings.sql_driver}}};"
        f"SERVER={settings.sql_server},{settings.sql_port};"
        f"DATABASE={settings.sql_database};"
        f"UID={settings.sql_user};"
        f"PWD={settings.sql_password};"
        f"TrustServerCertificate={trust_value};"
    )


@contextmanager
def get_connection(autocommit: bool = False):
    if pyodbc is None:
        raise RuntimeError(
            "pyodbc is not installed. Install SQL dependencies or run with DEMO_MODE=true."
        )
    conn = pyodbc.connect(build_connection_string(), autocommit=autocommit)
    try:
        yield conn
    finally:
        conn.close()


def _rows_to_dicts(cursor: Any, rows: Iterable[Any]) -> List[Dict[str, Any]]:
    columns = [column[0] for column in cursor.description] if cursor.description else []
    output: List[Dict[str, Any]] = []
    for row in rows:
        output.append({columns[idx]: row[idx] for idx in range(len(columns))})
    return output


def fetch_all(query: str, params: Optional[Sequence[Any]] = None) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params or [])
        rows = cursor.fetchall()
        return _rows_to_dicts(cursor, rows)


def fetch_one(query: str, params: Optional[Sequence[Any]] = None) -> Optional[Dict[str, Any]]:
    rows = fetch_all(query, params)
    return rows[0] if rows else None


def execute(query: str, params: Optional[Sequence[Any]] = None) -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params or [])
        affected = cursor.rowcount
        conn.commit()
        return affected


def execute_many(query: str, params_seq: Sequence[Sequence[Any]]) -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.fast_executemany = True
        cursor.executemany(query, params_seq)
        affected = cursor.rowcount
        conn.commit()
        return affected
