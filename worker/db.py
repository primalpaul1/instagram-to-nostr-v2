"""
SQLite database helpers for the worker service.
"""

import os
import sqlite3
from contextlib import contextmanager
from typing import Optional

DATABASE_PATH = os.getenv("DATABASE_PATH", "/data/instagram.db")


def init_db():
    """Initialize the database with schema."""
    # Try local schema first, then parent directory
    schema_paths = [
        os.path.join(os.path.dirname(__file__), "schema.sql"),
        os.path.join(os.path.dirname(__file__), "..", "schema.sql"),
        "/app/schema.sql",
    ]
    for schema_path in schema_paths:
        if os.path.exists(schema_path):
            with get_connection() as conn:
                with open(schema_path, "r") as f:
                    conn.executescript(f.read())
            return


@contextmanager
def get_connection():
    """Get a database connection with proper settings."""
    conn = sqlite3.connect(DATABASE_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_pending_tasks(limit: int = 10) -> list[dict]:
    """Get pending video tasks that are ready for processing."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT vt.*, j.public_key_hex, j.secret_key_hex
            FROM video_tasks vt
            JOIN jobs j ON vt.job_id = j.id
            WHERE vt.status = 'pending'
            ORDER BY vt.created_at ASC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_task_status(
    task_id: str,
    status: str,
    blossom_url: Optional[str] = None,
    nostr_event_id: Optional[str] = None,
    error: Optional[str] = None,
    increment_retry: bool = False,
):
    """Update a video task's status."""
    with get_connection() as conn:
        if increment_retry:
            conn.execute(
                """
                UPDATE video_tasks
                SET status = ?, blossom_url = ?, nostr_event_id = ?, error = ?,
                    retry_count = retry_count + 1
                WHERE id = ?
                """,
                (status, blossom_url, nostr_event_id, error, task_id),
            )
        else:
            conn.execute(
                """
                UPDATE video_tasks
                SET status = ?, blossom_url = ?, nostr_event_id = ?, error = ?
                WHERE id = ?
                """,
                (status, blossom_url, nostr_event_id, error, task_id),
            )


def get_task_retry_count(task_id: str) -> int:
    """Get the retry count for a task."""
    with get_connection() as conn:
        cursor = conn.execute(
            "SELECT retry_count FROM video_tasks WHERE id = ?",
            (task_id,),
        )
        row = cursor.fetchone()
        return row["retry_count"] if row else 0


def update_job_status(job_id: str):
    """Update job status based on its video tasks."""
    with get_connection() as conn:
        # Check if all tasks are complete
        cursor = conn.execute(
            """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
            FROM video_tasks
            WHERE job_id = ?
            """,
            (job_id,),
        )
        row = cursor.fetchone()

        if row["total"] == row["completed"]:
            new_status = "complete"
        elif row["total"] == row["completed"] + row["errors"]:
            new_status = "complete" if row["completed"] > 0 else "error"
        else:
            new_status = "processing"

        conn.execute(
            """
            UPDATE jobs
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_status, job_id),
        )


def get_jobs_with_unpublished_profiles(limit: int = 10) -> list[dict]:
    """Get jobs that have profile data but haven't published the profile event yet."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT id, handle, public_key_hex, secret_key_hex,
                   profile_name, profile_bio, profile_picture_url, profile_blossom_url
            FROM jobs
            WHERE profile_published = 0
              AND profile_name IS NOT NULL
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_job_profile_published(
    job_id: str,
    profile_blossom_url: Optional[str] = None,
):
    """Mark job's profile as published."""
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE jobs
            SET profile_published = 1,
                profile_blossom_url = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (profile_blossom_url, job_id),
        )
