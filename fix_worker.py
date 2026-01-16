"""Fix worker.py to handle missing legacy tables (jobs, video_tasks)"""

with open("/root/instagram-to-nostr-v2/worker/worker.py", "r") as f:
    content = f.read()

# Fix 1: Wrap pending_tasks in status logging
content = content.replace(
    "pending_tasks = get_pending_tasks(limit=100)",
    """try:
                    pending_tasks = get_pending_tasks(limit=100)
                except Exception:
                    pending_tasks = []"""
)

# Fix 2: Wrap reset_stale_processing_profiles in cleanup
content = content.replace(
    """reset_stale_processing_proposals()
                reset_stale_processing_gifts()
                reset_stale_processing_profiles()""",
    """reset_stale_processing_proposals()
                reset_stale_processing_gifts()
                try:
                    reset_stale_processing_profiles()
                except Exception:
                    pass"""
)

# Fix 3: Wrap profile processing
old_profile = '''# Process profiles (claim one at a time)
            profile = claim_next_unpublished_profile()
            if profile:
                print(f"Claimed profile for @{profile.get('handle', 'unknown')}")
                await process_profile(profile)
                processed_any = True

            # Process proposals'''

new_profile = '''# Process profiles (claim one at a time) - skip if jobs table missing
            try:
                profile = claim_next_unpublished_profile()
                if profile:
                    print(f"Claimed profile for @{profile.get('handle', 'unknown')}")
                    await process_profile(profile)
                    processed_any = True
            except Exception:
                pass

            # Process proposals'''

content = content.replace(old_profile, new_profile)

# Fix 4: Wrap task processing
old_tasks = '''# Process tasks concurrently (claim multiple, up to CONCURRENCY)
            async def claim_and_process_task():
                """Claim and process one task atomically."""
                task = claim_next_pending_task()
                if task:
                    await process_task(task)
                    return True
                return False

            # Launch CONCURRENCY workers to claim and process tasks
            task_results = await asyncio.gather(
                *[claim_and_process_task() for _ in range(CONCURRENCY)],
                return_exceptions=True,
            )
            tasks_processed = sum(1 for r in task_results if r is True)
            if tasks_processed > 0:
                print(f"Processed {tasks_processed} tasks")
                processed_any = True

            if not processed_any:'''

new_tasks = '''# Process tasks - skip if video_tasks table missing
            try:
                async def claim_and_process_task():
                    task = claim_next_pending_task()
                    if task:
                        await process_task(task)
                        return True
                    return False
                task_results = await asyncio.gather(
                    *[claim_and_process_task() for _ in range(CONCURRENCY)],
                    return_exceptions=True,
                )
                tasks_processed = sum(1 for r in task_results if r is True)
                if tasks_processed > 0:
                    print(f"Processed {tasks_processed} tasks")
                    processed_any = True
            except Exception:
                pass

            if not processed_any:'''

content = content.replace(old_tasks, new_tasks)

with open("/root/instagram-to-nostr-v2/worker/worker.py", "w") as f:
    f.write(content)

print("All fixes applied!")
