"""
Background worker for processing Instagram-to-Nostr video migrations.
Handles concurrent video uploads, Nostr event creation, and relay publishing.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
from typing import Optional

import httpx
from ecdsa import SECP256k1, SigningKey
from ecdsa.util import number_to_string, string_to_number
import websockets

import re

from db import (
    get_pending_tasks,
    claim_next_pending_task,
    get_task_retry_count,
    get_jobs_with_unpublished_profiles,
    claim_next_unpublished_profile,
    reset_stale_processing_profiles,
    init_db,
    update_job_status,
    update_job_profile_published,
    update_task_status,
    # Proposal functions
    get_pending_proposals,
    claim_next_pending_proposal,
    get_proposal_posts,
    get_proposal_articles,
    update_proposal_status,
    update_proposal_post_status,
    update_proposal_article_images,
    update_proposal_article_status,
    increment_proposal_article_attempts,
    cleanup_expired_proposals,
    reset_stale_processing_proposals,
    # Gift functions
    get_pending_gifts,
    claim_next_pending_gift,
    get_gift_posts,
    get_gift_articles,
    update_gift_status,
    update_gift_profile_data,
    update_gift_post_status,
    update_gift_article_images,
    update_gift_article_status,
    increment_gift_article_attempts,
    cleanup_expired_gifts,
    reset_stale_processing_gifts,
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
PRIMAL_CACHE_URL = os.getenv("PRIMAL_CACHE_URL", "wss://cache1.primal.net/v1")


def resolve_ytdl_url(ytdl_url: str) -> str:
    """Resolve a ytdl: URL to actual video URL using yt-dlp."""
    # Remove ytdl: prefix
    actual_url = ytdl_url[5:] if ytdl_url.startswith("ytdl:") else ytdl_url

    try:
        result = subprocess.run(
            ["yt-dlp", "--cookies-from-browser", "chrome", "-g", actual_url],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0 and result.stdout.strip():
            # yt-dlp -g returns the direct video URL
            return result.stdout.strip().split("\n")[0]
    except Exception as e:
        print(f"Failed to resolve ytdl URL: {e}")

    return actual_url


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
    # Base64 encode the JSON event as per Blossom spec
    event_json = json.dumps(signed)
    event_base64 = base64.b64encode(event_json.encode()).decode()
    return "Nostr " + event_base64


def create_post_event(
    public_key_hex: str,
    secret_key_hex: str,
    media_uploads: list[dict],  # List of {url, hash, size, mime_type, width, height}
    caption: Optional[str],
    original_date: Optional[str],
) -> dict:
    """Create a Kind 1 Nostr event with imeta tags for all media."""
    # Build imeta tags for each media item
    tags = []
    urls = []

    for media in media_uploads:
        imeta_parts = [
            "imeta",
            f"url {media['url']}",
            f"x {media['hash']}",
            f"m {media['mime_type']}",
            f"size {media['size']}",
        ]

        if media.get('width') and media.get('height'):
            imeta_parts.append(f"dim {media['width']}x{media['height']}")

        tags.append(imeta_parts)
        urls.append(media['url'])

    # Build content
    content = caption or ""
    # Add all media URLs to content
    url_text = "\n".join(urls)
    if url_text and url_text not in content:
        content = f"{content}\n\n{url_text}".strip()

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
        "tags": tags,
        "content": content,
    }

    return sign_event(event, secret_key_hex)


def create_profile_event(
    public_key_hex: str,
    secret_key_hex: str,
    name: str,
    about: Optional[str],
    picture_url: Optional[str],
) -> dict:
    """Create a Kind 0 Nostr profile metadata event."""
    content = {
        "name": name,
    }
    if about:
        content["about"] = about
    if picture_url:
        content["picture"] = picture_url

    event = {
        "kind": 0,
        "pubkey": public_key_hex,
        "created_at": int(time.time()),
        "tags": [],
        "content": json.dumps(content),
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


async def import_to_primal_cache(events: list[dict]) -> bool:
    """
    Import events directly to Primal's cache server.
    This ensures events appear in Primal immediately, even with old timestamps.
    """
    if not events:
        return False

    try:
        import uuid
        sub_id = str(uuid.uuid4())[:12]

        async with websockets.connect(PRIMAL_CACHE_URL, close_timeout=15) as ws:
            # Send import_events request
            message = json.dumps([
                "REQ",
                sub_id,
                {"cache": ["import_events", {"events": events}]}
            ])
            await ws.send(message)

            # Wait for response
            try:
                response = await asyncio.wait_for(ws.recv(), timeout=15)
                data = json.loads(response)
                print(f"Primal cache import response: {data}")

                # Close the subscription
                await ws.send(json.dumps(["CLOSE", sub_id]))
                return True
            except asyncio.TimeoutError:
                print("Primal cache import timed out")
                return False

    except Exception as e:
        print(f"Error importing to Primal cache: {e}")
        return False


async def upload_media_to_blossom(
    client: httpx.AsyncClient,
    media_url: str,
    media_type: str,  # "video" or "image"
    public_key_hex: str,
    secret_key_hex: str,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> dict:
    """
    Upload a single media item to Blossom.
    Returns dict with url, hash, size, mime_type, width, height.
    """
    # Resolve ytdl: URLs for videos
    if media_url.startswith("ytdl:"):
        print(f"Resolving ytdl URL: {media_url}")
        media_url = resolve_ytdl_url(media_url)
        print(f"Resolved to: {media_url}")

    # Download the media to calculate hash
    response = await client.get(media_url, follow_redirects=True)
    response.raise_for_status()
    content = response.content
    file_hash = hashlib.sha256(content).hexdigest()
    file_size = len(content)

    # Determine content type
    content_type = response.headers.get("content-type", "")
    if media_type == "video":
        mime_type = content_type if "video" in content_type else "video/mp4"
    else:
        mime_type = content_type if "image" in content_type else "image/jpeg"

    # Create Blossom auth header
    auth_header = create_blossom_auth_event(public_key_hex, secret_key_hex, file_hash)

    if media_type == "video":
        # Use backend streaming upload for videos
        upload_response = await client.post(
            f"{BACKEND_URL}/stream-upload",
            json={
                "video_url": media_url,
                "auth_header": auth_header,
            },
            timeout=300.0,
        )

        if upload_response.status_code != 200:
            raise Exception(f"Upload failed: {upload_response.text}")

        upload_data = upload_response.json()
        blossom_url = upload_data["blossom_url"]
        mime_type = upload_data.get("mime_type", mime_type)
    else:
        # Direct upload for images
        upload_response = await client.put(
            f"{BLOSSOM_SERVER}/upload",
            content=content,
            headers={
                "Authorization": auth_header,
                "Content-Type": mime_type,
                "X-SHA-256": file_hash,
            },
        )

        if upload_response.status_code not in (200, 201):
            raise Exception(f"Upload failed: {upload_response.text}")

        upload_data = upload_response.json()
        blossom_url = upload_data.get("url") or f"{BLOSSOM_SERVER}/{file_hash}"

    return {
        "url": blossom_url,
        "hash": file_hash,
        "size": file_size,
        "mime_type": mime_type,
        "width": width,
        "height": height,
    }


async def process_task(task: dict) -> None:
    """Process a single post task (reel, image, or carousel)."""
    task_id = task["id"]
    job_id = task["job_id"]
    post_type = task.get("post_type", "reel")

    print(f"Processing task {task_id} (type: {post_type})")

    try:
        # Update status to uploading
        update_task_status(task_id, "uploading")

        # Get keys
        secret_key_hex = task["secret_key_hex"]
        public_key_hex = task["public_key_hex"]

        # Parse media items
        media_items_json = task.get("media_items")
        if media_items_json:
            media_items = json.loads(media_items_json)
        else:
            # Backwards compatibility: single video
            media_items = [{
                "url": task["instagram_url"],
                "media_type": "video",
                "width": task.get("width"),
                "height": task.get("height"),
            }]

        # Upload all media items in parallel for faster carousel processing
        async with httpx.AsyncClient(timeout=300.0) as client:
            async def upload_item(item):
                print(f"Uploading {item['media_type']} for task {task_id}")
                return await upload_media_to_blossom(
                    client=client,
                    media_url=item["url"],
                    media_type=item["media_type"],
                    public_key_hex=public_key_hex,
                    secret_key_hex=secret_key_hex,
                    width=item.get("width"),
                    height=item.get("height"),
                )
            media_uploads = await asyncio.gather(*[upload_item(item) for item in media_items])

        # Get primary blossom URL (first item)
        primary_blossom_url = media_uploads[0]["url"] if media_uploads else None
        all_blossom_urls = [m["url"] for m in media_uploads]

        # Update status to publishing
        update_task_status(
            task_id,
            "publishing",
            blossom_url=primary_blossom_url,
            blossom_urls=json.dumps(all_blossom_urls) if len(all_blossom_urls) > 1 else None,
        )

        # Create and sign Nostr event with all media
        event = create_post_event(
            public_key_hex=public_key_hex,
            secret_key_hex=secret_key_hex,
            media_uploads=media_uploads,
            caption=task.get("caption"),
            original_date=task.get("original_date"),
        )

        # Publish to relays
        successful_relays = await publish_to_relays(event)

        if not successful_relays:
            raise Exception("Failed to publish to any relay")

        # Also import to Primal cache for immediate visibility
        cache_imported = await import_to_primal_cache([event])
        if cache_imported:
            print(f"Task {task_id} imported to Primal cache")

        # Success!
        update_task_status(
            task_id,
            "complete",
            blossom_url=primary_blossom_url,
            blossom_urls=json.dumps(all_blossom_urls) if len(all_blossom_urls) > 1 else None,
            nostr_event_id=event["id"],
        )
        print(f"Task {task_id} completed successfully ({len(media_uploads)} media items)")

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


async def process_profile(job: dict) -> None:
    """Process a job's profile - upload picture to Blossom and publish Kind 0 event."""
    job_id = job["id"]
    print(f"Processing profile for job {job_id}")

    try:
        secret_key_hex = job["secret_key_hex"]
        public_key_hex = job["public_key_hex"]
        profile_name = job["profile_name"]
        profile_bio = job.get("profile_bio")
        profile_picture_url = job.get("profile_picture_url")

        blossom_picture_url = None

        # If there's a profile picture, upload it to Blossom
        if profile_picture_url:
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    # Download the profile picture
                    pic_response = await client.get(profile_picture_url, follow_redirects=True)
                    pic_response.raise_for_status()
                    pic_content = pic_response.content
                    pic_hash = hashlib.sha256(pic_content).hexdigest()

                    # Determine content type
                    content_type = pic_response.headers.get("content-type", "image/jpeg")
                    if "image" not in content_type:
                        content_type = "image/jpeg"

                    # Create Blossom auth header
                    auth_header = create_blossom_auth_event(public_key_hex, secret_key_hex, pic_hash)

                    # Upload to Blossom
                    upload_response = await client.put(
                        f"{BLOSSOM_SERVER}/upload",
                        content=pic_content,
                        headers={
                            "Authorization": auth_header,
                            "Content-Type": content_type,
                            "X-SHA-256": pic_hash,
                        },
                    )

                    if upload_response.status_code in (200, 201):
                        upload_data = upload_response.json()
                        blossom_picture_url = upload_data.get("url") or f"{BLOSSOM_SERVER}/{pic_hash}"
                        print(f"Profile picture uploaded to {blossom_picture_url}")
                    else:
                        print(f"Failed to upload profile picture: {upload_response.text}")
            except Exception as e:
                print(f"Error uploading profile picture: {e}")
                # Continue without the profile picture

        # Create and publish Kind 0 profile event
        event = create_profile_event(
            public_key_hex=public_key_hex,
            secret_key_hex=secret_key_hex,
            name=profile_name,
            about=profile_bio,
            picture_url=blossom_picture_url,
        )

        # Publish to relays
        successful_relays = await publish_to_relays(event)

        if successful_relays:
            print(f"Profile published to {len(successful_relays)} relays for job {job_id}")

            # Also import to Primal cache for immediate visibility
            cache_imported = await import_to_primal_cache([event])
            if cache_imported:
                print(f"Profile imported to Primal cache for job {job_id}")

            update_job_profile_published(job_id, blossom_picture_url)
        else:
            print(f"Failed to publish profile to any relay for job {job_id}")

    except Exception as e:
        print(f"Error processing profile for job {job_id}: {e}")


def generate_temp_keypair() -> tuple[str, str]:
    """Generate a temporary keypair for Blossom uploads."""
    import secrets
    secret_key_bytes = secrets.token_bytes(32)
    secret_key_hex = secret_key_bytes.hex()

    # Get public key from secret
    signing_key = SigningKey.from_string(secret_key_bytes, curve=SECP256k1)
    verifying_key = signing_key.get_verifying_key()
    public_key_hex = verifying_key.to_string()[:32].hex()

    return public_key_hex, secret_key_hex


async def process_proposal(proposal: dict) -> None:
    """
    Process a proposal - download media and upload to Blossom.
    Uses a temporary keypair for Blossom auth (content-addressed, so same URL for same content).
    """
    proposal_id = proposal["id"]
    print(f"Processing proposal {proposal_id} for @{proposal['ig_handle']}")

    try:
        # Mark as processing
        update_proposal_status(proposal_id, "processing")

        # Generate temp keypair for Blossom uploads
        temp_public_key, temp_secret_key = generate_temp_keypair()

        # Get all posts for this proposal
        posts = get_proposal_posts(proposal_id)
        print(f"Processing {len(posts)} posts for proposal {proposal_id}")

        async with httpx.AsyncClient(timeout=300.0) as client:
            for post in posts:
                post_id = post["id"]
                post_type = post["post_type"]

                try:
                    update_proposal_post_status(post_id, "uploading")

                    # Parse media items
                    media_items = json.loads(post["media_items"])

                    # Upload each media item
                    blossom_urls = []
                    for item in media_items:
                        print(f"Uploading {item['media_type']} for proposal post {post_id}")
                        upload_result = await upload_media_to_blossom(
                            client=client,
                            media_url=item["url"],
                            media_type=item["media_type"],
                            public_key_hex=temp_public_key,
                            secret_key_hex=temp_secret_key,
                            width=item.get("width"),
                            height=item.get("height"),
                        )
                        blossom_urls.append(upload_result["url"])

                    # Update post with blossom URLs
                    update_proposal_post_status(
                        post_id,
                        "ready",
                        blossom_urls=json.dumps(blossom_urls),
                    )
                    print(f"Proposal post {post_id} uploaded: {len(blossom_urls)} files")

                except Exception as e:
                    print(f"Failed to process proposal post {post_id}: {e}")
                    # Continue with other posts
                    continue

            # Process articles (upload header and inline images to Blossom)
            articles_ok = await process_proposal_articles(proposal_id, client, temp_public_key, temp_secret_key)
            if not articles_ok:
                print(f"Proposal {proposal_id} has failed article uploads, will retry")
                update_proposal_status(proposal_id, "pending")
                return

        # Mark proposal as ready
        update_proposal_status(proposal_id, "ready")
        print(f"Proposal {proposal_id} is ready for claiming")

    except Exception as e:
        print(f"Failed to process proposal {proposal_id}: {e}")
        # Reset to pending for retry
        update_proposal_status(proposal_id, "pending")


async def process_proposal_articles(
    proposal_id: str,
    client: httpx.AsyncClient,
    temp_public_key: str,
    temp_secret_key: str,
) -> bool:
    """Process all articles for a proposal - upload header and inline images to Blossom.

    Returns True if ALL articles were processed successfully, False if any failed.
    """
    articles = get_proposal_articles(proposal_id)
    if not articles:
        return True  # No articles = success

    print(f"Processing {len(articles)} articles for proposal {proposal_id}")
    all_succeeded = True

    MAX_UPLOAD_ATTEMPTS = 5

    for article in articles:
        article_id = article["id"]
        url_mapping = {}
        blossom_header = None
        upload_failed = False

        # Increment attempt counter at start
        attempts = increment_proposal_article_attempts(article_id)
        print(f"Processing proposal article {article_id} (attempt {attempts})")

        try:
            # 1. Upload header image if exists
            image_url = article.get("image_url")
            existing_blossom = article.get("blossom_image_url")

            if image_url and not existing_blossom:
                try:
                    result = await upload_media_to_blossom(
                        client=client,
                        media_url=image_url,
                        media_type="image",
                        public_key_hex=temp_public_key,
                        secret_key_hex=temp_secret_key,
                    )
                    blossom_header = result["url"]
                    print(f"Uploaded header image for proposal article {article_id}")
                except Exception as e:
                    print(f"Failed to upload header image for proposal article {article_id}: {e}")
                    upload_failed = True
            else:
                blossom_header = existing_blossom

            # 2. Extract inline images from markdown
            content = article.get("content_markdown", "")
            inline_urls = extract_markdown_images(content)

            # 3. Upload each inline image
            for url in inline_urls:
                if url.startswith("data:") or "blossom" in url.lower():
                    continue
                try:
                    result = await upload_media_to_blossom(
                        client=client,
                        media_url=url,
                        media_type="image",
                        public_key_hex=temp_public_key,
                        secret_key_hex=temp_secret_key,
                    )
                    url_mapping[url] = result["url"]
                    print(f"Uploaded inline image for proposal article {article_id}")
                except Exception as e:
                    print(f"Failed to upload inline image {url[:60]}: {e}")
                    upload_failed = True

            # 4. Replace URLs in markdown (use Blossom URLs where available)
            updated_content = content
            if url_mapping:
                updated_content = replace_markdown_images(content, url_mapping)

            # If any upload failed, check if we've hit max attempts
            if upload_failed:
                if attempts >= MAX_UPLOAD_ATTEMPTS:
                    # Max retries reached - mark as ready with CDN fallback for failed images
                    print(f"Proposal article {article_id} hit max retries ({MAX_UPLOAD_ATTEMPTS}), marking ready with CDN fallback")
                    update_proposal_article_images(
                        article_id=article_id,
                        blossom_image_url=blossom_header,  # May be None if header failed
                        content_markdown=updated_content,  # Has Blossom URLs for successful uploads
                        inline_image_urls=json.dumps(url_mapping) if url_mapping else None,
                    )
                    update_proposal_article_status(article_id, "ready")
                else:
                    print(f"Proposal article {article_id} has failed uploads, will retry (attempt {attempts}/{MAX_UPLOAD_ATTEMPTS})")
                    all_succeeded = False
                continue

            # 5. Update database
            update_proposal_article_images(
                article_id=article_id,
                blossom_image_url=blossom_header,
                content_markdown=updated_content,
                inline_image_urls=json.dumps(url_mapping) if url_mapping else None,
            )

            # 6. Mark article as ready
            update_proposal_article_status(article_id, "ready")
            print(f"Proposal article {article_id} processed successfully")

        except Exception as e:
            print(f"Failed to process proposal article {article_id}: {e}")
            all_succeeded = False

    return all_succeeded


# ============================================
# Markdown image processing helpers
# ============================================


def extract_markdown_images(markdown: str) -> list[str]:
    """Extract image URLs from markdown ![alt](url) or ![alt](url "title") syntax."""
    # Match URL up to optional space+title or closing paren
    # Handles: ![alt](url) and ![alt](url "title")
    pattern = r'!\[.*?\]\(([^\s\)]+)'
    return re.findall(pattern, markdown)


def replace_markdown_images(markdown: str, url_mapping: dict) -> str:
    """Replace image URLs in markdown with Blossom URLs."""
    def replacer(match):
        full_match = match.group(0)
        original_url = match.group(1)
        if original_url in url_mapping:
            return full_match.replace(original_url, url_mapping[original_url])
        return full_match

    # Match URL up to optional space+title or closing paren
    pattern = r'!\[.*?\]\(([^\s\)]+)'
    return re.sub(pattern, replacer, markdown)


async def process_gift_articles(
    gift_id: str,
    client: httpx.AsyncClient,
    temp_public_key: str,
    temp_secret_key: str,
) -> bool:
    """Process all articles for a gift - upload header and inline images to Blossom.

    Returns True if ALL articles were processed successfully, False if any failed.
    """
    articles = get_gift_articles(gift_id)

    if not articles:
        return True  # No articles = success

    print(f"Processing {len(articles)} articles for gift {gift_id}")
    all_succeeded = True

    MAX_UPLOAD_ATTEMPTS = 5

    for article in articles:
        article_id = article["id"]
        url_mapping = {}
        blossom_header = None
        upload_failed = False

        # Increment attempt counter at start
        attempts = increment_gift_article_attempts(article_id)
        print(f"Processing gift article {article_id} (attempt {attempts})")

        try:
            # 1. Upload header image if exists and not already on Blossom
            image_url = article.get("image_url")
            existing_blossom = article.get("blossom_image_url")

            if image_url and not existing_blossom:
                try:
                    print(f"Uploading header image for article {article_id}")
                    result = await upload_media_to_blossom(
                        client=client,
                        media_url=image_url,
                        media_type="image",
                        public_key_hex=temp_public_key,
                        secret_key_hex=temp_secret_key,
                    )
                    blossom_header = result["url"]
                    print(f"Header image uploaded: {blossom_header}")
                except Exception as e:
                    print(f"Failed to upload header image for article {article_id}: {e}")
                    upload_failed = True
            else:
                blossom_header = existing_blossom

            # 2. Extract inline images from markdown
            content = article.get("content_markdown", "")
            inline_urls = extract_markdown_images(content)

            if inline_urls:
                print(f"Found {len(inline_urls)} inline images in article {article_id}")

            # 3. Upload each inline image
            for url in inline_urls:
                # Skip data URIs and already-uploaded Blossom URLs
                if url.startswith("data:") or "blossom" in url.lower():
                    continue

                try:
                    print(f"Uploading inline image: {url[:60]}...")
                    result = await upload_media_to_blossom(
                        client=client,
                        media_url=url,
                        media_type="image",
                        public_key_hex=temp_public_key,
                        secret_key_hex=temp_secret_key,
                    )
                    url_mapping[url] = result["url"]
                    print(f"Inline image uploaded: {result['url']}")
                except Exception as e:
                    print(f"Failed to upload inline image {url[:60]}: {e}")
                    upload_failed = True

            # 4. Replace URLs in markdown (use Blossom URLs where available)
            updated_content = content
            if url_mapping:
                updated_content = replace_markdown_images(content, url_mapping)
                print(f"Replaced {len(url_mapping)} image URLs in article {article_id}")

            # If any upload failed, check if we've hit max attempts
            if upload_failed:
                if attempts >= MAX_UPLOAD_ATTEMPTS:
                    # Max retries reached - mark as ready with CDN fallback for failed images
                    print(f"Gift article {article_id} hit max retries ({MAX_UPLOAD_ATTEMPTS}), marking ready with CDN fallback")
                    update_gift_article_images(
                        article_id=article_id,
                        blossom_image_url=blossom_header,  # May be None if header failed
                        content_markdown=updated_content,  # Has Blossom URLs for successful uploads
                        inline_image_urls=json.dumps(url_mapping) if url_mapping else None,
                    )
                    update_gift_article_status(article_id, "ready")
                else:
                    print(f"Gift article {article_id} has failed uploads, will retry (attempt {attempts}/{MAX_UPLOAD_ATTEMPTS})")
                    all_succeeded = False
                continue

            # 5. Update database with processed content
            update_gift_article_images(
                article_id=article_id,
                blossom_image_url=blossom_header,
                content_markdown=updated_content,
                inline_image_urls=json.dumps(url_mapping) if url_mapping else None,
            )

            # 6. Mark article as ready
            update_gift_article_status(article_id, "ready")
            print(f"Gift article {article_id} processed successfully")

        except Exception as e:
            print(f"Failed to process gift article {article_id}: {e}")
            all_succeeded = False

    return all_succeeded


async def process_gift(gift: dict) -> None:
    """
    Process a gift - download media and upload to Blossom.
    Similar to proposals but for deterministic key derivation flow.
    Uses a temporary keypair for Blossom auth (content-addressed, so same URL for same content).
    """
    gift_id = gift["id"]
    print(f"Processing gift {gift_id} for @{gift['ig_handle']}")

    try:
        # Mark as processing
        update_gift_status(gift_id, "processing")

        # Generate temp keypair for Blossom uploads
        temp_public_key, temp_secret_key = generate_temp_keypair()

        # Get all posts for this gift
        posts = get_gift_posts(gift_id)
        print(f"Processing {len(posts)} posts for gift {gift_id}")

        async with httpx.AsyncClient(timeout=300.0) as client:
            # Upload profile picture if present
            profile_data = gift.get("profile_data")
            if profile_data:
                try:
                    profile = json.loads(profile_data)
                    profile_picture_url = profile.get("profile_picture_url")

                    if profile_picture_url and not profile_picture_url.startswith("https://blossom"):
                        print(f"Uploading profile picture for gift {gift_id}")
                        try:
                            # Download profile picture
                            pic_response = await client.get(profile_picture_url, follow_redirects=True)
                            pic_response.raise_for_status()
                            pic_content = pic_response.content
                            pic_hash = hashlib.sha256(pic_content).hexdigest()

                            # Determine content type
                            content_type = pic_response.headers.get("content-type", "image/jpeg")
                            if "image" not in content_type:
                                content_type = "image/jpeg"

                            # Create Blossom auth for upload
                            auth_header = create_blossom_auth_event(temp_public_key, temp_secret_key, pic_hash)

                            # Upload to Blossom
                            upload_response = await client.put(
                                f"{BLOSSOM_SERVER}/upload",
                                content=pic_content,
                                headers={
                                    "Authorization": auth_header,
                                    "Content-Type": content_type,
                                    "X-SHA-256": pic_hash,
                                },
                            )

                            if upload_response.status_code in (200, 201):
                                upload_data = upload_response.json()
                                blossom_pic_url = upload_data.get("url") or f"{BLOSSOM_SERVER}/{pic_hash}"

                                # Update profile with blossom URL
                                profile["profile_picture_url"] = blossom_pic_url
                                update_gift_profile_data(gift_id, json.dumps(profile))
                                print(f"Profile picture uploaded to {blossom_pic_url}")
                            else:
                                print(f"Failed to upload profile picture: {upload_response.text}")
                        except Exception as e:
                            print(f"Error uploading profile picture: {e}")
                            # Continue without the profile picture
                except json.JSONDecodeError:
                    print(f"Failed to parse profile_data for gift {gift_id}")

            # Process posts
            for post in posts:
                post_id = post["id"]
                post_type = post["post_type"]

                try:
                    update_gift_post_status(post_id, "uploading")

                    # Parse media items
                    media_items = json.loads(post["media_items"])

                    # Upload each media item
                    blossom_urls = []
                    for item in media_items:
                        print(f"Uploading {item['media_type']} for gift post {post_id}")
                        upload_result = await upload_media_to_blossom(
                            client=client,
                            media_url=item["url"],
                            media_type=item["media_type"],
                            public_key_hex=temp_public_key,
                            secret_key_hex=temp_secret_key,
                            width=item.get("width"),
                            height=item.get("height"),
                        )
                        blossom_urls.append(upload_result["url"])

                    # Update post with blossom URLs
                    update_gift_post_status(
                        post_id,
                        "ready",
                        blossom_urls=json.dumps(blossom_urls),
                    )
                    print(f"Gift post {post_id} uploaded: {len(blossom_urls)} files")

                except Exception as e:
                    print(f"Failed to process gift post {post_id}: {e}")
                    # Continue with other posts
                    continue

            # Process articles (upload header and inline images to Blossom)
            articles_ok = await process_gift_articles(gift_id, client, temp_public_key, temp_secret_key)
            if not articles_ok:
                print(f"Gift {gift_id} has failed article uploads, will retry")
                update_gift_status(gift_id, "pending")
                return

        # Mark gift as ready
        update_gift_status(gift_id, "ready")
        print(f"Gift {gift_id} is ready for claiming")

    except Exception as e:
        print(f"Failed to process gift {gift_id}: {e}")
        # Reset to pending for retry
        update_gift_status(gift_id, "pending")


async def worker_loop():
    """Main worker loop - polls for tasks and processes them."""
    print(f"Worker started with concurrency={CONCURRENCY}, max_retries={MAX_RETRIES}")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Blossom server: {BLOSSOM_SERVER}")
    print(f"Relays: {NOSTR_RELAYS}")

    # Initialize database
    init_db()

    # Reset any proposals that were stuck in 'processing' from previous runs
    reset_count = reset_stale_processing_proposals()
    if reset_count > 0:
        print(f"Reset {reset_count} stale processing proposals")

    # Reset any gifts that were stuck in 'processing' from previous runs
    gift_reset_count = reset_stale_processing_gifts()
    if gift_reset_count > 0:
        print(f"Reset {gift_reset_count} stale processing gifts")

    # Semaphore for concurrency limiting
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def process_with_semaphore(task):
        async with semaphore:
            await process_task(task)

    # Track last cleanup time
    last_cleanup = 0
    last_status_log = 0
    CLEANUP_INTERVAL = 3600  # Run cleanup every hour
    STATUS_LOG_INTERVAL = 60  # Log queue status every minute
    DISK_WARNING_THRESHOLD = 80  # Warn when disk usage exceeds 80%

    def check_disk_space():
        """Check disk usage and warn if running low."""
        try:
            import shutil
            total, used, free = shutil.disk_usage("/")
            usage_percent = (used / total) * 100
            free_gb = free / (1024 ** 3)

            if usage_percent >= DISK_WARNING_THRESHOLD:
                print(f"WARNING: Disk usage at {usage_percent:.1f}% ({free_gb:.1f} GB free)")
                print("WARNING: Consider cleaning up old data or expanding storage")
                return True
            return False
        except Exception as e:
            print(f"Error checking disk space: {e}")
            return False

    while True:
        try:
            now = time.time()

            # Periodic queue status logging for monitoring
            if now - last_status_log > STATUS_LOG_INTERVAL:
                pending_proposals = get_pending_proposals(limit=100)
                pending_gifts = get_pending_gifts(limit=100)
                pending_tasks = get_pending_tasks(limit=100)
                total_pending = len(pending_proposals) + len(pending_gifts) + len(pending_tasks)
                if total_pending > 0:
                    print(f"[Queue Status] {len(pending_proposals)} proposals, {len(pending_gifts)} gifts, {len(pending_tasks)} tasks pending")
                last_status_log = now

            # Periodic cleanup of expired proposals and gifts
            if now - last_cleanup > CLEANUP_INTERVAL:
                # Check disk space first
                check_disk_space()

                deleted_proposals = cleanup_expired_proposals()
                if deleted_proposals > 0:
                    print(f"Cleaned up {deleted_proposals} expired/old proposals")
                deleted_gifts = cleanup_expired_gifts()
                if deleted_gifts > 0:
                    print(f"Cleaned up {deleted_gifts} expired/old gifts")

                # Reset stale processing items (crashed workers)
                reset_stale_processing_proposals()
                reset_stale_processing_gifts()
                reset_stale_processing_profiles()

                last_cleanup = now

            # Process items using atomic claim functions
            # This ensures multiple workers don't process the same item
            processed_any = False

            # Process profiles (claim one at a time)
            profile = claim_next_unpublished_profile()
            if profile:
                print(f"Claimed profile for @{profile.get('handle', 'unknown')}")
                await process_profile(profile)
                processed_any = True

            # Process proposals (claim one at a time)
            proposal = claim_next_pending_proposal()
            if proposal:
                print(f"Claimed proposal {proposal['id']} for @{proposal.get('ig_handle', 'unknown')}")
                await process_proposal(proposal)
                processed_any = True

            # Process gifts (claim one at a time)
            gift = claim_next_pending_gift()
            if gift:
                print(f"Claimed gift {gift['id']} for @{gift.get('ig_handle', 'unknown')}")
                await process_gift(gift)
                processed_any = True

            # Process tasks concurrently (claim multiple, up to CONCURRENCY)
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

            if not processed_any:
                # No items to process - wait before polling again
                await asyncio.sleep(POLL_INTERVAL)

        except Exception as e:
            print(f"Worker loop error: {e}")
            await asyncio.sleep(POLL_INTERVAL)


def main():
    """Entry point."""
    asyncio.run(worker_loop())


if __name__ == "__main__":
    main()
