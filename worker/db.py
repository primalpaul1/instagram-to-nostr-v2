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


def claim_next_pending_task() -> Optional[dict]:
    """Atomically claim one pending task for processing.

    Returns the claimed task or None if no tasks available.
    Safe for concurrent workers - only one worker can claim each task.
    """
    with get_connection() as conn:
        while True:
            # Find a candidate
            cursor = conn.execute(
                """
                SELECT vt.*, j.public_key_hex, j.secret_key_hex
                FROM video_tasks vt
                JOIN jobs j ON vt.job_id = j.id
                WHERE vt.status = 'pending'
                ORDER BY vt.created_at ASC
                LIMIT 1
                """
            )
            row = cursor.fetchone()

            if not row:
                return None  # No pending tasks

            task = dict(row)

            # Try to claim it atomically
            cursor = conn.execute(
                """
                UPDATE video_tasks
                SET status = 'uploading'
                WHERE id = ? AND status = 'pending'
                """,
                (task['id'],),
            )

            if cursor.rowcount > 0:
                # We successfully claimed it
                return task

            # Someone else claimed it, try again


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


def claim_next_unpublished_profile() -> Optional[dict]:
    """Atomically claim one unpublished profile for processing.

    Returns the claimed profile or None if none available.
    Safe for concurrent workers - only one worker can claim each profile.
    Uses profile_published: 0=unpublished, -1=processing, 1=published
    """
    with get_connection() as conn:
        while True:
            # Find a candidate
            cursor = conn.execute(
                """
                SELECT id, handle, public_key_hex, secret_key_hex,
                       profile_name, profile_bio, profile_picture_url, profile_blossom_url
                FROM jobs
                WHERE profile_published = 0
                  AND profile_name IS NOT NULL
                ORDER BY created_at ASC
                LIMIT 1
                """
            )
            row = cursor.fetchone()

            if not row:
                return None  # No unpublished profiles

            profile = dict(row)

            # Try to claim it atomically (set to -1 = processing)
            cursor = conn.execute(
                """
                UPDATE jobs
                SET profile_published = -1
                WHERE id = ? AND profile_published = 0
                """,
                (profile['id'],),
            )

            if cursor.rowcount > 0:
                # We successfully claimed it
                return profile

            # Someone else claimed it, try again


def reset_stale_processing_profiles(older_than_minutes: int = 10) -> int:
    """Reset profiles stuck in processing state back to unpublished.

    Called periodically to handle crashed workers.
    """
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE jobs
            SET profile_published = 0
            WHERE profile_published = -1
              AND updated_at < datetime('now', ? || ' minutes')
            """,
            (f"-{older_than_minutes}",),
        )
        return cursor.rowcount


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


def claim_next_pending_proposal() -> Optional[dict]:
    """Atomically claim one pending proposal for processing.

    Returns the claimed proposal or None if none available.
    Safe for concurrent workers - only one worker can claim each proposal.
    """
    try:
        with get_connection() as conn:
            while True:
                # Find a candidate
                cursor = conn.execute(
                    """
                    SELECT * FROM proposals
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                )
                row = cursor.fetchone()

                if not row:
                    return None  # No pending proposals

                proposal = dict(row)

                # Try to claim it atomically
                cursor = conn.execute(
                    """
                    UPDATE proposals
                    SET status = 'processing'
                    WHERE id = ? AND status = 'pending'
                    """,
                    (proposal['id'],),
                )

                if cursor.rowcount > 0:
                    # We successfully claimed it
                    return proposal

                # Someone else claimed it, try again
    except Exception as e:
        if "no such table" in str(e):
            return None  # Table doesn't exist yet
        raise


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


def get_proposal_articles(proposal_id: str) -> list[dict]:
    """Get all articles for a proposal."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM proposal_articles
            WHERE proposal_id = ?
            ORDER BY id ASC
            """,
            (proposal_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_proposal_article_images(
    article_id: int,
    blossom_image_url: Optional[str],
    content_markdown: str,
    inline_image_urls: Optional[str] = None,
):
    """Update article after image processing."""
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE proposal_articles
            SET blossom_image_url = ?,
                content_markdown = ?,
                inline_image_urls = ?
            WHERE id = ?
            """,
            (blossom_image_url, content_markdown, inline_image_urls, article_id),
        )


def update_proposal_article_status(article_id: int, status: str):
    """Update a proposal article's status."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE proposal_articles SET status = ? WHERE id = ?",
            (status, article_id),
        )


def increment_proposal_article_attempts(article_id: int) -> int:
    """Increment upload_attempts for a proposal article and return the new value."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE proposal_articles SET upload_attempts = COALESCE(upload_attempts, 0) + 1 WHERE id = ?",
            (article_id,),
        )
        cursor = conn.execute(
            "SELECT upload_attempts FROM proposal_articles WHERE id = ?",
            (article_id,),
        )
        row = cursor.fetchone()
        return row[0] if row else 0


def cleanup_expired_proposals() -> int:
    """
    Delete proposals that:
    - Have expired and weren't claimed, OR
    - Were claimed more than 7 days ago (no longer needed)
    """
    try:
        with get_connection() as conn:
            # Get count first
            cursor = conn.execute(
                """
                SELECT COUNT(*) as count FROM proposals
                WHERE (expires_at < datetime('now') AND status != 'claimed')
                   OR (status = 'claimed' AND claimed_at < datetime('now', '-7 days'))
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
                        WHERE (expires_at < datetime('now') AND status != 'claimed')
                           OR (status = 'claimed' AND claimed_at < datetime('now', '-7 days'))
                    )
                    """
                )
                # Delete proposals
                conn.execute(
                    """
                    DELETE FROM proposals
                    WHERE (expires_at < datetime('now') AND status != 'claimed')
                       OR (status = 'claimed' AND claimed_at < datetime('now', '-7 days'))
                    """
                )

            return count
    except Exception as e:
        if "no such table" in str(e):
            return 0  # Table doesn't exist yet
        raise


def reset_stale_processing_proposals() -> int:
    """
    Reset proposals stuck in 'processing' status back to 'pending'.
    This handles cases where the worker was restarted mid-processing.
    Also resets any 'uploading' posts back to 'pending'.
    """
    try:
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
    except Exception as e:
        if "no such table" in str(e):
            return 0  # Table doesn't exist yet, nothing to reset
        raise


# ============================================
# Gift functions for deterministic key derivation
# ============================================


def get_pending_gifts(limit: int = 10) -> list[dict]:
    """Get pending gifts that need media processing."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM gifts
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]


def claim_next_pending_gift() -> Optional[dict]:
    """Atomically claim one pending gift for processing.

    Returns the claimed gift or None if none available.
    Safe for concurrent workers - only one worker can claim each gift.
    """
    try:
        with get_connection() as conn:
            while True:
                # Find a candidate
                cursor = conn.execute(
                    """
                    SELECT * FROM gifts
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                )
                row = cursor.fetchone()

                if not row:
                    return None  # No pending gifts

                gift = dict(row)

                # Try to claim it atomically
                cursor = conn.execute(
                    """
                    UPDATE gifts
                    SET status = 'processing'
                    WHERE id = ? AND status = 'pending'
                    """,
                    (gift['id'],),
                )

                if cursor.rowcount > 0:
                    # We successfully claimed it
                    return gift

                # Someone else claimed it, try again
    except Exception as e:
        if "no such table" in str(e):
            return None  # Table doesn't exist yet
        raise


def get_gift_posts(gift_id: str) -> list[dict]:
    """Get all posts for a gift."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM gift_posts
            WHERE gift_id = ?
            ORDER BY id ASC
            """,
            (gift_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_gift_status(gift_id: str, status: str):
    """Update a gift's status."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE gifts SET status = ? WHERE id = ?",
            (status, gift_id),
        )


def update_gift_profile_data(gift_id: str, profile_data: str):
    """Update a gift's profile_data JSON."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE gifts SET profile_data = ? WHERE id = ?",
            (profile_data, gift_id),
        )


def update_gift_post_status(
    post_id: int,
    status: str,
    blossom_urls: Optional[str] = None,
):
    """Update a gift post's status and optionally blossom URLs."""
    with get_connection() as conn:
        if blossom_urls:
            conn.execute(
                """
                UPDATE gift_posts
                SET status = ?, blossom_urls = ?
                WHERE id = ?
                """,
                (status, blossom_urls, post_id),
            )
        else:
            conn.execute(
                "UPDATE gift_posts SET status = ? WHERE id = ?",
                (status, post_id),
            )


def cleanup_expired_gifts() -> int:
    """
    Delete gifts that:
    - Have expired and weren't claimed, OR
    - Were claimed more than 7 days ago (no longer needed)
    """
    try:
        with get_connection() as conn:
            # Get count first
            cursor = conn.execute(
                """
                SELECT COUNT(*) as count FROM gifts
                WHERE (expires_at < datetime('now') AND status != 'claimed')
                   OR (status = 'claimed' AND claimed_at < datetime('now', '-7 days'))
                """
            )
            count = cursor.fetchone()["count"]

            if count > 0:
                # Delete gift posts first (foreign key)
                conn.execute(
                    """
                    DELETE FROM gift_posts
                    WHERE gift_id IN (
                        SELECT id FROM gifts
                        WHERE (expires_at < datetime('now') AND status != 'claimed')
                           OR (status = 'claimed' AND claimed_at < datetime('now', '-7 days'))
                    )
                    """
                )
                # Delete gifts
                conn.execute(
                    """
                    DELETE FROM gifts
                    WHERE (expires_at < datetime('now') AND status != 'claimed')
                       OR (status = 'claimed' AND claimed_at < datetime('now', '-7 days'))
                    """
                )

            return count
    except Exception as e:
        if "no such table" in str(e):
            return 0  # Table doesn't exist yet
        raise


def reset_stale_processing_gifts() -> int:
    """
    Reset gifts stuck in 'processing' status back to 'pending'.
    This handles cases where the worker was restarted mid-processing.
    Also resets any 'uploading' posts back to 'pending'.
    """
    try:
        with get_connection() as conn:
            # Count stale gifts
            cursor = conn.execute(
                "SELECT COUNT(*) as count FROM gifts WHERE status = 'processing'"
            )
            count = cursor.fetchone()["count"]

            if count > 0:
                # Reset gift_posts that were uploading
                conn.execute(
                    """
                    UPDATE gift_posts
                    SET status = 'pending'
                    WHERE status = 'uploading'
                    AND gift_id IN (SELECT id FROM gifts WHERE status = 'processing')
                    """
                )
                # Reset gifts
                conn.execute(
                    "UPDATE gifts SET status = 'pending' WHERE status = 'processing'"
                )

            return count
    except Exception as e:
        if "no such table" in str(e):
            return 0  # Table doesn't exist yet, nothing to reset
        raise


# ============================================
# Gift article functions for RSS/blog gifts
# ============================================


def get_gift_articles(gift_id: str) -> list[dict]:
    """Get all articles for a gift with their image data."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM gift_articles
            WHERE gift_id = ?
            ORDER BY id ASC
            """,
            (gift_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_gift_article_images(
    article_id: int,
    blossom_image_url: Optional[str],
    content_markdown: str,
    inline_image_urls: Optional[str] = None,
):
    """Update article after image processing - sets blossom URL, updated content, and URL mappings."""
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE gift_articles
            SET blossom_image_url = ?,
                content_markdown = ?,
                inline_image_urls = ?
            WHERE id = ?
            """,
            (blossom_image_url, content_markdown, inline_image_urls, article_id),
        )


def update_gift_article_status(article_id: int, status: str):
    """Update a gift article's status (pending → ready → published)."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE gift_articles SET status = ? WHERE id = ?",
            (status, article_id),
        )


def increment_gift_article_attempts(article_id: int) -> int:
    """Increment upload_attempts for a gift article and return the new value."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE gift_articles SET upload_attempts = COALESCE(upload_attempts, 0) + 1 WHERE id = ?",
            (article_id,),
        )
        cursor = conn.execute(
            "SELECT upload_attempts FROM gift_articles WHERE id = ?",
            (article_id,),
        )
        row = cursor.fetchone()
        return row[0] if row else 0


# ============================================
# Migration functions for client-side signing flow
# ============================================


def claim_next_pending_migration() -> Optional[dict]:
    """Atomically claim one pending migration for processing.

    Returns the claimed migration or None if none available.
    Safe for concurrent workers - only one worker can claim each migration.
    """
    try:
        with get_connection() as conn:
            while True:
                # Find a candidate
                cursor = conn.execute(
                    """
                    SELECT * FROM migrations
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                )
                row = cursor.fetchone()

                if not row:
                    return None  # No pending migrations

                migration = dict(row)

                # Try to claim it atomically (also set updated_at for stale detection)
                cursor = conn.execute(
                    """
                    UPDATE migrations
                    SET status = 'processing', updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status = 'pending'
                    """,
                    (migration['id'],),
                )

                if cursor.rowcount > 0:
                    # We successfully claimed it
                    return migration

                # Someone else claimed it, try again
    except Exception as e:
        if "no such table" in str(e):
            return None  # Table doesn't exist yet
        raise


def get_migration_posts(migration_id: str) -> list[dict]:
    """Get all posts for a migration."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM migration_posts
            WHERE migration_id = ?
            ORDER BY id ASC
            """,
            (migration_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def get_migration_articles(migration_id: str) -> list[dict]:
    """Get all articles for a migration."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT * FROM migration_articles
            WHERE migration_id = ?
            ORDER BY id ASC
            """,
            (migration_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


def update_migration_status(migration_id: str, status: str):
    """Update a migration's status."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE migrations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, migration_id),
        )


def update_migration_profile_data(migration_id: str, profile_data: str):
    """Update a migration's profile_data JSON."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE migrations SET profile_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (profile_data, migration_id),
        )


def update_migration_post_status(
    post_id: int,
    status: str,
    blossom_urls: Optional[str] = None,
):
    """Update a migration post's status and optionally blossom URLs."""
    with get_connection() as conn:
        if blossom_urls:
            conn.execute(
                """
                UPDATE migration_posts
                SET status = ?, blossom_urls = ?
                WHERE id = ?
                """,
                (status, blossom_urls, post_id),
            )
        else:
            conn.execute(
                "UPDATE migration_posts SET status = ? WHERE id = ?",
                (status, post_id),
            )


def update_migration_article_images(
    article_id: int,
    blossom_image_url: Optional[str],
    content_markdown: str,
    inline_image_urls: Optional[str] = None,
):
    """Update article after image processing."""
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE migration_articles
            SET blossom_image_url = ?,
                content_markdown = ?,
                inline_image_urls = ?
            WHERE id = ?
            """,
            (blossom_image_url, content_markdown, inline_image_urls, article_id),
        )


def update_migration_article_status(article_id: int, status: str):
    """Update a migration article's status."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE migration_articles SET status = ? WHERE id = ?",
            (status, article_id),
        )


def increment_migration_article_attempts(article_id: int) -> int:
    """Increment upload_attempts for a migration article and return the new value."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE migration_articles SET upload_attempts = COALESCE(upload_attempts, 0) + 1 WHERE id = ?",
            (article_id,),
        )
        cursor = conn.execute(
            "SELECT upload_attempts FROM migration_articles WHERE id = ?",
            (article_id,),
        )
        row = cursor.fetchone()
        return row[0] if row else 0


def reset_stale_processing_migrations(older_than_minutes: int = 30) -> int:
    """
    Reset migrations stuck in 'processing' status back to 'pending'.
    Only resets migrations that have been processing for longer than older_than_minutes.
    This handles crashed workers without disrupting active processing.
    """
    try:
        with get_connection() as conn:
            # Count truly stale migrations (processing for > N minutes)
            cursor = conn.execute(
                """
                SELECT COUNT(*) as count FROM migrations
                WHERE status = 'processing'
                AND updated_at < datetime('now', ? || ' minutes')
                """,
                (f"-{older_than_minutes}",)
            )
            count = cursor.fetchone()["count"]

            if count > 0:
                # Reset migration_posts that were uploading for stale migrations only
                conn.execute(
                    """
                    UPDATE migration_posts
                    SET status = 'pending'
                    WHERE status = 'uploading'
                    AND migration_id IN (
                        SELECT id FROM migrations
                        WHERE status = 'processing'
                        AND updated_at < datetime('now', ? || ' minutes')
                    )
                    """,
                    (f"-{older_than_minutes}",)
                )
                # Reset migration_articles that were uploading for stale migrations only
                conn.execute(
                    """
                    UPDATE migration_articles
                    SET status = 'pending'
                    WHERE status = 'uploading'
                    AND migration_id IN (
                        SELECT id FROM migrations
                        WHERE status = 'processing'
                        AND updated_at < datetime('now', ? || ' minutes')
                    )
                    """,
                    (f"-{older_than_minutes}",)
                )
                # Reset only stale migrations
                conn.execute(
                    """
                    UPDATE migrations
                    SET status = 'pending'
                    WHERE status = 'processing'
                    AND updated_at < datetime('now', ? || ' minutes')
                    """,
                    (f"-{older_than_minutes}",)
                )

            return count
    except Exception as e:
        if "no such table" in str(e):
            return 0  # Table doesn't exist yet, nothing to reset
        raise


def cleanup_completed_migrations(older_than_days: int = 7) -> int:
    """
    Delete migrations that have been complete for more than N days.
    """
    try:
        with get_connection() as conn:
            # Get count first
            cursor = conn.execute(
                """
                SELECT COUNT(*) as count FROM migrations
                WHERE status = 'complete'
                AND updated_at < datetime('now', ? || ' days')
                """,
                (f"-{older_than_days}",)
            )
            count = cursor.fetchone()["count"]

            if count > 0:
                # Delete migration posts first (foreign key)
                conn.execute(
                    """
                    DELETE FROM migration_posts
                    WHERE migration_id IN (
                        SELECT id FROM migrations
                        WHERE status = 'complete'
                        AND updated_at < datetime('now', ? || ' days')
                    )
                    """,
                    (f"-{older_than_days}",)
                )
                # Delete migration articles
                conn.execute(
                    """
                    DELETE FROM migration_articles
                    WHERE migration_id IN (
                        SELECT id FROM migrations
                        WHERE status = 'complete'
                        AND updated_at < datetime('now', ? || ' days')
                    )
                    """,
                    (f"-{older_than_days}",)
                )
                # Delete migrations
                conn.execute(
                    """
                    DELETE FROM migrations
                    WHERE status = 'complete'
                    AND updated_at < datetime('now', ? || ' days')
                    """,
                    (f"-{older_than_days}",)
                )

            return count
    except Exception as e:
        if "no such table" in str(e):
            return 0  # Table doesn't exist yet
        raise
