"""Fix parallel processing by adding time-based stale detection"""
import sqlite3

DB_PATH = "/root/instagram-to-nostr-v2/data/instagram.db"

# Step 1: Add updated_at column to gifts table if it doesn't exist
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Check if updated_at column exists
cursor.execute("PRAGMA table_info(gifts)")
columns = [col[1] for col in cursor.fetchall()]

if 'updated_at' not in columns:
    print("Adding updated_at column to gifts table...")
    cursor.execute("ALTER TABLE gifts ADD COLUMN updated_at DATETIME")
    # Set existing rows to created_at value
    cursor.execute("UPDATE gifts SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)")
    conn.commit()
    print("Column added!")
else:
    print("updated_at column already exists")

conn.close()

# Step 2: Fix db.py - update claim function and reset function
with open("/root/instagram-to-nostr-v2/worker/db.py", "r") as f:
    content = f.read()

# Fix claim_next_pending_gift to set updated_at when claiming
old_claim = '''            # Try to claim it atomically
            cursor = conn.execute(
                """
                UPDATE gifts
                SET status = 'processing'
                WHERE id = ? AND status = 'pending'
                """,
                (gift['id'],),
            )'''

new_claim = '''            # Try to claim it atomically (also set updated_at for stale detection)
            cursor = conn.execute(
                """
                UPDATE gifts
                SET status = 'processing', updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
                """,
                (gift['id'],),
            )'''

content = content.replace(old_claim, new_claim)

# Fix reset_stale_processing_gifts to only reset gifts processing for > 30 min
old_reset = '''def reset_stale_processing_gifts() -> int:
    """
    Reset gifts stuck in 'processing' status back to 'pending'.
    This handles cases where the worker was restarted mid-processing.
    Also resets any 'uploading' posts back to 'pending'.
    """
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

        return count'''

new_reset = '''def reset_stale_processing_gifts(older_than_minutes: int = 30) -> int:
    """
    Reset gifts stuck in 'processing' status back to 'pending'.
    Only resets gifts that have been processing for longer than older_than_minutes.
    This handles crashed workers without disrupting active processing.
    """
    with get_connection() as conn:
        # Count truly stale gifts (processing for > N minutes)
        cursor = conn.execute(
            """
            SELECT COUNT(*) as count FROM gifts
            WHERE status = 'processing'
            AND updated_at < datetime('now', ? || ' minutes')
            """,
            (f"-{older_than_minutes}",)
        )
        count = cursor.fetchone()["count"]

        if count > 0:
            # Reset gift_posts that were uploading for stale gifts only
            conn.execute(
                """
                UPDATE gift_posts
                SET status = 'pending'
                WHERE status = 'uploading'
                AND gift_id IN (
                    SELECT id FROM gifts
                    WHERE status = 'processing'
                    AND updated_at < datetime('now', ? || ' minutes')
                )
                """,
                (f"-{older_than_minutes}",)
            )
            # Reset only stale gifts
            conn.execute(
                """
                UPDATE gifts
                SET status = 'pending'
                WHERE status = 'processing'
                AND updated_at < datetime('now', ? || ' minutes')
                """,
                (f"-{older_than_minutes}",)
            )

        return count'''

content = content.replace(old_reset, new_reset)

with open("/root/instagram-to-nostr-v2/worker/db.py", "w") as f:
    f.write(content)

print("db.py updated with time-based stale detection!")
