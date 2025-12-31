"""
Background worker for processing Instagram-to-Nostr video migrations.
Handles concurrent video uploads, Nostr event creation, and relay publishing.
"""

import asyncio
import hashlib
import hmac
import json
import os
import time
from typing import Optional

import httpx
from ecdsa import SECP256k1, SigningKey
from ecdsa.util import number_to_string, string_to_number
import websockets

from db import (
    get_pending_tasks,
    get_task_retry_count,
    init_db,
    update_job_status,
    update_task_status,
)

# Configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
BLOSSOM_SERVER = os.getenv("BLOSSOM_SERVER", "https://blossom.primal.net")
CONCURRENCY = int(os.getenv("CONCURRENCY", "3"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))
NOSTR_RELAYS = os.getenv(
    "NOSTR_RELAYS", "wss://relay.primal.net,wss://relay.damus.io,wss://nos.lol"
).split(",")

# secp256k1 curve parameters
CURVE = SECP256k1
ORDER = CURVE.order
G = CURVE.generator


def get_signing_key(secret_key_hex: str) -> SigningKey:
    """Create an ECDSA signing key from hex string."""
    return SigningKey.from_string(bytes.fromhex(secret_key_hex), curve=SECP256k1)


def get_public_key_bytes(signing_key: SigningKey) -> bytes:
    """Get the x-only public key (32 bytes) from signing key."""
    verifying_key = signing_key.get_verifying_key()
    # Get x coordinate only (first 32 bytes of uncompressed pubkey)
    pubkey_bytes = verifying_key.to_string()
    return pubkey_bytes[:32]


def tagged_hash(tag: str, msg: bytes) -> bytes:
    """BIP-340 tagged hash."""
    tag_hash = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(tag_hash + tag_hash + msg).digest()


def int_from_bytes(b: bytes) -> int:
    """Convert bytes to integer."""
    return int.from_bytes(b, byteorder='big')


def bytes_from_int(x: int) -> bytes:
    """Convert integer to 32 bytes."""
    return x.to_bytes(32, byteorder='big')


def has_even_y(point) -> bool:
    """Check if point has even Y coordinate."""
    return point.y() % 2 == 0


def schnorr_sign(secret_key_hex: str, message: bytes) -> bytes:
    """
    Create a BIP-340 Schnorr signature.
    """
    # Parse secret key
    d = int_from_bytes(bytes.fromhex(secret_key_hex))

    # Get public key point
    P = d * G

    # Negate secret key if public key has odd Y
    if not has_even_y(P):
        d = ORDER - d

    # Get x-only public key
    pk = bytes_from_int(P.x())

    # Generate deterministic nonce using RFC 6979-like approach
    # aux_rand would normally be random, but we use deterministic for reproducibility
    t = bytes_from_int(d)
    aux = hashlib.sha256(message).digest()  # Use message hash as aux

    # BIP-340 nonce generation
    rand = tagged_hash("BIP0340/aux", aux)
    t_xor = bytes(a ^ b for a, b in zip(t, rand))

    k0 = int_from_bytes(tagged_hash("BIP0340/nonce", t_xor + pk + message)) % ORDER
    if k0 == 0:
        raise ValueError("Signature failed - k0 is zero")

    # Calculate R = k0 * G
    R = k0 * G

    # Negate k if R has odd Y
    k = k0 if has_even_y(R) else ORDER - k0

    # Get R's x coordinate
    rx = bytes_from_int(R.x())

    # Calculate challenge e = hash(R.x || P.x || m)
    e = int_from_bytes(tagged_hash("BIP0340/challenge", rx + pk + message)) % ORDER

    # Calculate signature s = k + e * d (mod n)
    s = (k + e * d) % ORDER

    # Return signature (r || s)
    sig = rx + bytes_from_int(s)

    return sig


def sign_event(event: dict, secret_key_hex: str) -> dict:
    """Sign a Nostr event."""
    # Serialize for signing
    serialized = json.dumps(
        [
            0,
            event["pubkey"],
            event["created_at"],
            event["kind"],
            event["tags"],
            event["content"],
        ],
        separators=(",", ":"),
        ensure_ascii=False,
    )

    # Calculate event ID (SHA256 of serialized)
    event_id = hashlib.sha256(serialized.encode()).hexdigest()
    event["id"] = event_id

    # Sign with Schnorr
    msg_hash = bytes.fromhex(event_id)
    sig = schnorr_sign(secret_key_hex, msg_hash)
    event["sig"] = sig.hex()

    return event


def create_blossom_auth_event(
    public_key_hex: str,
    secret_key_hex: str,
    file_hash: str,
) -> str:
    """Create a Kind 24242 Blossom authorization event."""
    now = int(time.time())

    event = {
        "kind": 24242,
        "pubkey": public_key_hex,
        "created_at": now,
        "tags": [
            ["t", "upload"],
            ["x", file_hash],
            ["expiration", str(now + 300)],  # 5 minute expiration
        ],
        "content": "Upload video to Blossom",
    }

    signed = sign_event(event, secret_key_hex)
    return "Nostr " + json.dumps(signed)


def create_video_event(
    public_key_hex: str,
    secret_key_hex: str,
    blossom_url: str,
    caption: Optional[str],
    original_date: Optional[str],
    width: Optional[int],
    height: Optional[int],
    duration: Optional[float],
    file_hash: str,
    file_size: int,
    mime_type: str,
) -> dict:
    """Create a Kind 1 Nostr event with imeta tag for the video."""
    # Build imeta tag
    imeta_parts = [
        "imeta",
        f"url {blossom_url}",
        f"x {file_hash}",
        f"m {mime_type}",
        f"size {file_size}",
    ]

    if width and height:
        imeta_parts.append(f"dim {width}x{height}")

    # Build content
    content = caption or ""
    if blossom_url and blossom_url not in content:
        content = f"{content}\n\n{blossom_url}".strip()

    # Use original date if available, otherwise current time
    if original_date:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(original_date.replace("Z", "+00:00"))
            created_at = int(dt.timestamp())
        except (ValueError, TypeError):
            created_at = int(time.time())
    else:
        created_at = int(time.time())

    event = {
        "kind": 1,
        "pubkey": public_key_hex,
        "created_at": created_at,
        "tags": [imeta_parts],
        "content": content,
    }

    return sign_event(event, secret_key_hex)


async def publish_to_relay(event: dict, relay_url: str) -> bool:
    """Publish a Nostr event to a relay."""
    try:
        async with websockets.connect(relay_url, close_timeout=10) as ws:
            message = json.dumps(["EVENT", event])
            await ws.send(message)

            # Wait for OK response
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=10)
                data = json.loads(response)
                if data[0] == "OK" and data[1] == event["id"]:
                    return data[2]  # True if accepted
            except asyncio.TimeoutError:
                pass

            return False
    except Exception as e:
        print(f"Error publishing to {relay_url}: {e}")
        return False


async def publish_to_relays(event: dict) -> list[str]:
    """Publish event to all configured relays."""
    successful_relays = []

    tasks = [publish_to_relay(event, relay) for relay in NOSTR_RELAYS]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for relay, result in zip(NOSTR_RELAYS, results):
        if result is True:
            successful_relays.append(relay)

    return successful_relays


async def process_task(task: dict) -> None:
    """Process a single video task."""
    task_id = task["id"]
    job_id = task["job_id"]

    print(f"Processing task {task_id}")

    try:
        # Update status to uploading
        update_task_status(task_id, "uploading")

        # Get keys
        secret_key_hex = task["secret_key_hex"]
        public_key_hex = task["public_key_hex"]

        # We need to first fetch the video to get its hash for Blossom auth
        # The backend will handle the streaming upload
        async with httpx.AsyncClient(timeout=300.0) as client:
            # First, download the video to calculate hash
            video_response = await client.get(task["instagram_url"], follow_redirects=True)
            video_response.raise_for_status()
            video_content = video_response.content
            file_hash = hashlib.sha256(video_content).hexdigest()
            file_size = len(video_content)

            # Create Blossom auth header
            auth_header = create_blossom_auth_event(public_key_hex, secret_key_hex, file_hash)

            # Upload to Blossom via backend
            upload_response = await client.post(
                f"{BACKEND_URL}/stream-upload",
                json={
                    "video_url": task["instagram_url"],
                    "auth_header": auth_header,
                },
                timeout=300.0,
            )

            if upload_response.status_code != 200:
                raise Exception(f"Upload failed: {upload_response.text}")

            upload_data = upload_response.json()
            blossom_url = upload_data["blossom_url"]
            mime_type = upload_data.get("mime_type", "video/mp4")

        # Update status to publishing
        update_task_status(task_id, "publishing", blossom_url=blossom_url)

        # Create and sign Nostr event
        event = create_video_event(
            public_key_hex=public_key_hex,
            secret_key_hex=secret_key_hex,
            blossom_url=blossom_url,
            caption=task.get("caption"),
            original_date=task.get("original_date"),
            width=task.get("width"),
            height=task.get("height"),
            duration=task.get("duration"),
            file_hash=file_hash,
            file_size=file_size,
            mime_type=mime_type,
        )

        # Publish to relays
        successful_relays = await publish_to_relays(event)

        if not successful_relays:
            raise Exception("Failed to publish to any relay")

        # Success!
        update_task_status(
            task_id,
            "complete",
            blossom_url=blossom_url,
            nostr_event_id=event["id"],
        )
        print(f"Task {task_id} completed successfully")

    except Exception as e:
        error_msg = str(e)
        print(f"Task {task_id} failed: {error_msg}")

        retry_count = get_task_retry_count(task_id)
        if retry_count < MAX_RETRIES:
            # Schedule for retry with exponential backoff
            update_task_status(
                task_id,
                "pending",
                error=error_msg,
                increment_retry=True,
            )
            # Backoff delay is handled by the polling interval
        else:
            # Max retries exceeded
            update_task_status(
                task_id,
                "error",
                error=f"Max retries exceeded: {error_msg}",
            )

    finally:
        # Update job status
        update_job_status(job_id)


async def worker_loop():
    """Main worker loop - polls for tasks and processes them."""
    print(f"Worker started with concurrency={CONCURRENCY}, max_retries={MAX_RETRIES}")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Blossom server: {BLOSSOM_SERVER}")
    print(f"Relays: {NOSTR_RELAYS}")

    # Initialize database
    init_db()

    # Semaphore for concurrency limiting
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def process_with_semaphore(task):
        async with semaphore:
            await process_task(task)

    while True:
        try:
            # Get pending tasks
            tasks = get_pending_tasks(limit=CONCURRENCY * 2)

            if tasks:
                print(f"Found {len(tasks)} pending tasks")

                # Process tasks concurrently (up to CONCURRENCY limit)
                await asyncio.gather(
                    *[process_with_semaphore(task) for task in tasks],
                    return_exceptions=True,
                )
            else:
                # No tasks, wait before polling again
                await asyncio.sleep(POLL_INTERVAL)

        except Exception as e:
            print(f"Worker loop error: {e}")
            await asyncio.sleep(POLL_INTERVAL)


def main():
    """Entry point."""
    asyncio.run(worker_loop())


if __name__ == "__main__":
    main()
