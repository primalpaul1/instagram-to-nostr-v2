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
    blossom_urls: Optional[str] = None,  # JSON string for multi-media
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
                SET status = ?, blossom_url = ?, blossom_urls = ?, nostr_event_id = ?, error = ?,
                    retry_count = retry_count + 1
                WHERE id = ?
                """,
                (status, blossom_url, blossom_urls, nostr_event_id, error, task_id),
            )
        else:
            conn.execute(
                """
                UPDATE video_tasks
                SET status = ?, blossom_url = ?, blossom_urls = ?, nostr_event_id = ?, error = ?
                WHERE id = ?
                """,
                (status, blossom_url, blossom_urls, nostr_event_id, error, task_id),
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

        # Delete secret key when job completes (security: don't store keys longer than needed)
        if new_status in ("complete", "error"):
            conn.execute(
                """
                UPDATE jobs
                SET status = ?, secret_key_hex = 'DELETED', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (new_status, job_id),
            )
        else:
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


# ============================================
# Proposal functions for third-party migrations
# ============================================


def get_pending_proposals(limit: int = 10) -> list[dict]:
    """Get pending proposals that need media processing."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM proposals
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]


def get_proposal_posts(proposal_id: str) -> list[dict]:
    """Get all posts for a proposal."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM proposal_posts
            WHERE proposal_id = ?
            ORDER BY id ASC
            """,
            (proposal_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_proposal_status(proposal_id: str, status: str):
    """Update a proposal's status."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE proposals SET status = ? WHERE id = ?",
            (status, proposal_id),
        )


def update_proposal_post_status(
    post_id: int,
    status: str,
    blossom_urls: Optional[str] = None,
):
    """Update a proposal post's status and optionally blossom URLs."""
    with get_connection() as conn:
        if blossom_urls:
            conn.execute(
                """
                UPDATE proposal_posts
                SET status = ?, blossom_urls = ?
                WHERE id = ?
                """,
                (status, blossom_urls, post_id),
            )
        else:
            conn.execute(
                "UPDATE proposal_posts SET status = ? WHERE id = ?",
                (status, post_id),
            )


def cleanup_expired_proposals() -> int:
    """Delete proposals that have expired and weren't claimed."""
    with get_connection() as conn:
        # Get count first
        cursor = conn.execute(
            """
            SELECT COUNT(*) as count FROM proposals
            WHERE expires_at < datetime('now') AND status != 'claimed'
            """
        )
        count = cursor.fetchone()["count"]

        if count > 0:
            # Delete proposal posts first (foreign key)
            conn.execute(
                """
                DELETE FROM proposal_posts
                WHERE proposal_id IN (
                    SELECT id FROM proposals
                    WHERE expires_at < datetime('now') AND status != 'claimed'
                )
                """
            )
            # Delete proposals
            conn.execute(
                "DELETE FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'"
            )

        return count


def reset_stale_processing_proposals() -> int:
    """
    Reset proposals stuck in 'processing' status back to 'pending'.
    This handles cases where the worker was restarted mid-processing.
    Also resets any 'uploading' posts back to 'pending'.
    """
    with get_connection() as conn:
        # Count stale proposals
        cursor = conn.execute(
            "SELECT COUNT(*) as count FROM proposals WHERE status = 'processing'"
        )
        count = cursor.fetchone()["count"]

        if count > 0:
            # Reset proposal_posts that were uploading
            conn.execute(
                """
                UPDATE proposal_posts
                SET status = 'pending'
                WHERE status = 'uploading'
                AND proposal_id IN (SELECT id FROM proposals WHERE status = 'processing')
                """
            )
            # Reset proposals
            conn.execute(
                "UPDATE proposals SET status = 'pending' WHERE status = 'processing'"
            )

        return count
