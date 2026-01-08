"""
FastAPI backend for Instagram-to-Nostr video migration.
Handles Instagram video metadata fetching and streaming uploads to Blossom.
"""

import asyncio
import hashlib
import json
import os
import subprocess
import tempfile
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Instagram-to-Nostr Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BLOSSOM_SERVER = os.getenv("BLOSSOM_SERVER", "https://blossom.primal.net")
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")


class MediaItem(BaseModel):
    """Individual media item (image or video) within a post."""
    url: str
    media_type: str  # "image" or "video"
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None  # Only for videos
    thumbnail_url: Optional[str] = None


class PostMetadata(BaseModel):
    """Metadata for an Instagram post (reel, image, or carousel)."""
    id: str
    post_type: str  # "reel", "image", or "carousel"
    caption: Optional[str] = None
    original_date: Optional[str] = None
    thumbnail_url: Optional[str] = None
    media_items: list[MediaItem]  # Single item for reel/image, multiple for carousel


# Keep VideoMetadata for backwards compatibility
class VideoMetadata(BaseModel):
    url: str
    filename: str
    caption: Optional[str] = None
    original_date: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None
    thumbnail_url: Optional[str] = None


class ProfileMetadata(BaseModel):
    username: str
    display_name: Optional[str] = None
    bio: Optional[str] = None
    profile_picture_url: Optional[str] = None
    followers: Optional[int] = None
    following: Optional[int] = None


class FetchVideosRequest(BaseModel):
    handle: str


class FetchVideosResponse(BaseModel):
    videos: list[VideoMetadata]  # Kept for backwards compatibility (reels only)
    posts: list[PostMetadata] = []  # All posts including images and carousels
    handle: str
    profile: Optional[ProfileMetadata] = None


class StreamUploadRequest(BaseModel):
    video_url: str
    auth_header: str


class StreamUploadResponse(BaseModel):
    blossom_url: str
    sha256: str
    size: int
    mime_type: str


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/videos-stream/{handle}")
async def fetch_videos_stream(handle: str):
    """
    Stream video fetch progress using Server-Sent Events.
    Sends progress updates after each page, then final data.
    """
    handle = handle.lstrip("@")

    def extract_caption(node):
        """Extract caption text from node."""
        caption_obj = node.get("caption")
        if caption_obj:
            return caption_obj.get("text") if isinstance(caption_obj, dict) else caption_obj
        return None

    def extract_date(node):
        """Extract and format original date from node."""
        taken_at = node.get("taken_at")
        if taken_at:
            from datetime import datetime
            try:
                return datetime.fromtimestamp(int(taken_at)).isoformat()
            except (ValueError, TypeError):
                pass
        return None

    def extract_media_item(item, is_video=False):
        """Extract media item data from a node or carousel item."""
        media_item = {"media_type": "video" if is_video else "image"}

        if is_video:
            video_versions = item.get("video_versions", [])
            if video_versions:
                media_item["url"] = video_versions[0].get("url")
                media_item["width"] = video_versions[0].get("width")
                media_item["height"] = video_versions[0].get("height")
            media_item["duration"] = item.get("video_duration")
        else:
            image_versions = item.get("image_versions2", {}).get("candidates", [])
            if image_versions:
                media_item["url"] = image_versions[0].get("url")
                media_item["width"] = image_versions[0].get("width")
                media_item["height"] = image_versions[0].get("height")

        # Thumbnail
        image_versions = item.get("image_versions2", {}).get("candidates", [])
        if image_versions:
            media_item["thumbnail_url"] = image_versions[0].get("url")

        return media_item if media_item.get("url") else None

    async def generate():
        if not RAPIDAPI_KEY:
            yield f"data: {json.dumps({'error': 'RAPIDAPI_KEY not configured'})}\n\n"
            return

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                profile = None
                videos = []  # Backwards compatibility - reels only
                posts = []   # All posts including images and carousels
                max_id = ""
                max_pages = 50
                page = 0

                while page < max_pages:
                    response = await client.post(
                        "https://instagram120.p.rapidapi.com/api/instagram/posts",
                        json={"username": handle, "maxId": max_id},
                        headers={
                            "Content-Type": "application/json",
                            "x-rapidapi-key": RAPIDAPI_KEY,
                            "x-rapidapi-host": "instagram120.p.rapidapi.com"
                        }
                    )

                    if response.status_code == 404:
                        yield f"data: {json.dumps({'error': f'Instagram user {handle} not found'})}\n\n"
                        return

                    if response.status_code != 200:
                        yield f"data: {json.dumps({'error': f'API error: {response.text}'})}\n\n"
                        return

                    data = response.json()
                    result = data.get("result", {})
                    edges = result.get("edges", [])

                    if not edges:
                        break

                    # Extract profile from posts - check owner first, then coauthors
                    if profile is None:
                        for edge in edges:
                            node = edge.get("node", {})

                            # First check if owner matches
                            user_data = node.get("user") or node.get("owner") or {}
                            if user_data.get("username", "").lower() == handle.lower():
                                profile_pic = user_data.get("profile_pic_url")
                                hd_pic_info = user_data.get("hd_profile_pic_url_info", {})
                                if hd_pic_info and hd_pic_info.get("url"):
                                    profile_pic = hd_pic_info.get("url")
                                profile = {
                                    "username": user_data.get("username", handle),
                                    "display_name": user_data.get("full_name"),
                                    "profile_picture_url": profile_pic,
                                }
                                break

                            # Check coauthors for collab posts
                            coauthors = node.get("coauthor_producers", [])
                            for coauthor in coauthors:
                                if coauthor.get("username", "").lower() == handle.lower():
                                    profile = {
                                        "username": coauthor.get("username", handle),
                                        "display_name": coauthor.get("full_name"),
                                        "profile_picture_url": coauthor.get("profile_pic_url"),
                                    }
                                    break
                            if profile:
                                break

                    # Process ALL edges (not just videos)
                    for edge in edges:
                        node = edge.get("node", {})
                        code = node.get("code", node.get("pk", "post"))
                        caption = extract_caption(node)
                        original_date = extract_date(node)

                        # Get thumbnail from main node
                        thumbnail_url = None
                        image_versions = node.get("image_versions2", {}).get("candidates", [])
                        if image_versions:
                            thumbnail_url = image_versions[0].get("url")

                        # Determine post type and extract media
                        media_type = node.get("media_type", 0)
                        carousel_media = node.get("carousel_media", [])
                        video_versions = node.get("video_versions", [])

                        if carousel_media:
                            # Carousel post - multiple media items
                            media_items = []
                            for item in carousel_media:
                                item_has_video = bool(item.get("video_versions"))
                                media_item = extract_media_item(item, is_video=item_has_video)
                                if media_item:
                                    media_items.append(media_item)

                            if media_items:
                                posts.append({
                                    "id": code,
                                    "post_type": "carousel",
                                    "caption": caption,
                                    "original_date": original_date,
                                    "thumbnail_url": thumbnail_url,
                                    "media_items": media_items,
                                })

                        elif video_versions:
                            # Video/Reel post
                            media_item = extract_media_item(node, is_video=True)
                            if media_item:
                                posts.append({
                                    "id": code,
                                    "post_type": "reel",
                                    "caption": caption,
                                    "original_date": original_date,
                                    "thumbnail_url": thumbnail_url,
                                    "media_items": [media_item],
                                })

                                # Also add to videos for backwards compatibility
                                videos.append({
                                    "url": media_item["url"],
                                    "filename": f"{code}.mp4",
                                    "caption": caption,
                                    "original_date": original_date,
                                    "width": media_item.get("width"),
                                    "height": media_item.get("height"),
                                    "duration": media_item.get("duration"),
                                    "thumbnail_url": thumbnail_url,
                                })

                        else:
                            # Image post
                            media_item = extract_media_item(node, is_video=False)
                            if media_item:
                                posts.append({
                                    "id": code,
                                    "post_type": "image",
                                    "caption": caption,
                                    "original_date": original_date,
                                    "thumbnail_url": thumbnail_url,
                                    "media_items": [media_item],
                                })

                    # Send progress update with all content
                    yield f"data: {json.dumps({'progress': True, 'count': len(posts), 'videos': videos, 'posts': posts, 'profile': profile})}\n\n"

                    # Check for next page
                    page_info = result.get("page_info", {})
                    has_next = page_info.get("has_next_page", False)
                    end_cursor = page_info.get("end_cursor", "")

                    if not has_next or not end_cursor:
                        break

                    max_id = end_cursor
                    page += 1

                # Send final result
                if not profile:
                    profile = {"username": handle}

                yield f"data: {json.dumps({'done': True, 'videos': videos, 'posts': posts, 'handle': handle, 'profile': profile})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/videos", response_model=FetchVideosResponse)
async def fetch_videos(request: FetchVideosRequest):
    """
    Fetch Instagram video metadata using RapidAPI Instagram120.
    Returns list of available videos without downloading them.
    Paginates through all posts to get complete video list.
    """
    handle = request.handle.lstrip("@")

    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="RAPIDAPI_KEY not configured")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            profile = None
            videos = []
            max_id = ""
            max_pages = 50  # Safety limit - allows up to ~600 videos
            page = 0

            while page < max_pages:
                # Fetch posts from Instagram120 API (POST request)
                response = await client.post(
                    "https://instagram120.p.rapidapi.com/api/instagram/posts",
                    json={"username": handle, "maxId": max_id},
                    headers={
                        "Content-Type": "application/json",
                        "x-rapidapi-key": RAPIDAPI_KEY,
                        "x-rapidapi-host": "instagram120.p.rapidapi.com"
                    }
                )

                if response.status_code == 404:
                    raise HTTPException(status_code=404, detail=f"Instagram user '{handle}' not found")

                if response.status_code != 200:
                    raise HTTPException(status_code=response.status_code, detail=f"API error: {response.text}")

                data = response.json()

                # Instagram120 API returns: { "result": { "edges": [...], "page_info": {...} } }
                result = data.get("result", {})
                edges = result.get("edges", [])

                if not edges:
                    break  # No more posts

                # Extract profile from posts - check owner first, then coauthors
                if profile is None:
                    for edge in edges:
                        node = edge.get("node", {})

                        # First check if owner matches
                        user_data = node.get("user") or node.get("owner") or {}
                        if user_data.get("username", "").lower() == handle.lower():
                            profile_pic = user_data.get("profile_pic_url")
                            hd_pic_info = user_data.get("hd_profile_pic_url_info", {})
                            if hd_pic_info and hd_pic_info.get("url"):
                                profile_pic = hd_pic_info.get("url")
                            profile = ProfileMetadata(
                                username=user_data.get("username", handle),
                                display_name=user_data.get("full_name"),
                                profile_picture_url=profile_pic,
                            )
                            break

                        # Check coauthors for collab posts
                        coauthors = node.get("coauthor_producers", [])
                        for coauthor in coauthors:
                            if coauthor.get("username", "").lower() == handle.lower():
                                profile = ProfileMetadata(
                                    username=coauthor.get("username", handle),
                                    display_name=coauthor.get("full_name"),
                                    profile_picture_url=coauthor.get("profile_pic_url"),
                                )
                                break
                        if profile:
                            break

                # Process edges for videos
                for edge in edges:
                    node = edge.get("node", {})

                    # Check if it has video_versions (means it's a video)
                    video_versions = node.get("video_versions", [])
                    if not video_versions:
                        continue

                    video_url = video_versions[0].get("url") if video_versions else None
                    if not video_url:
                        continue

                    width = video_versions[0].get("width")
                    height = video_versions[0].get("height")

                    caption = None
                    caption_obj = node.get("caption")
                    if caption_obj:
                        caption = caption_obj.get("text") if isinstance(caption_obj, dict) else caption_obj

                    taken_at = node.get("taken_at")
                    original_date = None
                    if taken_at:
                        from datetime import datetime
                        try:
                            original_date = datetime.fromtimestamp(int(taken_at)).isoformat()
                        except (ValueError, TypeError):
                            pass

                    thumbnail_url = None
                    image_versions = node.get("image_versions2", {}).get("candidates", [])
                    if image_versions:
                        thumbnail_url = image_versions[0].get("url")

                    code = node.get("code", node.get("pk", "video"))

                    videos.append(VideoMetadata(
                        url=video_url,
                        filename=f"{code}.mp4",
                        caption=caption,
                        original_date=original_date,
                        width=width,
                        height=height,
                        duration=node.get("video_duration"),
                        thumbnail_url=thumbnail_url,
                    ))

                # Check for next page
                page_info = result.get("page_info", {})
                has_next = page_info.get("has_next_page", False)
                end_cursor = page_info.get("end_cursor", "")

                if not has_next or not end_cursor:
                    break  # No more pages

                max_id = end_cursor
                page += 1

            # Fallback if profile API failed
            if not profile:
                profile = ProfileMetadata(username=handle)

            return FetchVideosResponse(videos=videos, handle=handle, profile=profile)

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout fetching Instagram data")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception:
        pass

    return actual_url


@app.post("/stream-upload", response_model=StreamUploadResponse)
async def stream_upload(request: StreamUploadRequest):
    """
    Stream video from Instagram CDN directly to Blossom server.
    Calculates SHA256 while streaming for memory efficiency.
    """
    video_url = request.video_url
    auth_header = request.auth_header

    # Resolve ytdl: URLs using yt-dlp
    if video_url.startswith("ytdl:"):
        video_url = resolve_ytdl_url(video_url)

    async with httpx.AsyncClient(timeout=300.0) as client:
        # First, get the video stream from Instagram
        try:
            video_response = await client.get(video_url, follow_redirects=True)
            video_response.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch video: {str(e)}")

        video_content = video_response.content
        video_size = len(video_content)

        # Calculate SHA256
        sha256_hash = hashlib.sha256(video_content).hexdigest()

        # Determine content type
        content_type = video_response.headers.get("content-type", "video/mp4")
        if "video" not in content_type:
            content_type = "video/mp4"

        # Upload to Blossom
        upload_url = f"{BLOSSOM_SERVER}/upload"

        headers = {
            "Authorization": auth_header,
            "Content-Type": content_type,
            "X-SHA-256": sha256_hash,
        }

        try:
            upload_response = await client.put(
                upload_url,
                content=video_content,
                headers=headers,
            )

            if upload_response.status_code not in (200, 201):
                error_detail = upload_response.text
                raise HTTPException(
                    status_code=upload_response.status_code,
                    detail=f"Blossom upload failed: {error_detail}"
                )

            blossom_data = upload_response.json()
            blossom_url = blossom_data.get("url") or f"{BLOSSOM_SERVER}/{sha256_hash}"

            return StreamUploadResponse(
                blossom_url=blossom_url,
                sha256=sha256_hash,
                size=video_size,
                mime_type=content_type,
            )

        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"Blossom upload error: {str(e)}")


# ============================================================================
# TikTok API Endpoints
# ============================================================================

MAX_TIKTOK_POSTS = 100  # Limit TikTok posts to avoid API quota issues


@app.get("/tiktok-stream/{handle}")
async def fetch_tiktok_stream(handle: str):
    """
    Stream TikTok video fetch progress using Server-Sent Events.
    Similar to Instagram endpoint but uses ScrapTik API.
    Limited to MAX_TIKTOK_POSTS to manage API quota.
    """
    if not RAPIDAPI_KEY:
        async def error_generator():
            yield f"data: {json.dumps({'error': 'RAPIDAPI_KEY not configured'})}\n\n"
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                profile = None
                posts = []
                max_cursor = 0
                max_pages = 50
                page = 0

                # First, get user info to get user_id
                yield f"data: {json.dumps({'progress': 'Looking up TikTok user...'})}\n\n"

                user_response = await client.get(
                    f"https://scraptik.p.rapidapi.com/get-user?username={handle}",
                    headers={
                        "x-rapidapi-key": RAPIDAPI_KEY,
                        "x-rapidapi-host": "scraptik.p.rapidapi.com"
                    }
                )

                if user_response.status_code != 200:
                    yield f"data: {json.dumps({'error': f'TikTok user {handle} not found'})}\n\n"
                    return

                # Decompress if gzipped
                try:
                    import gzip
                    user_data = json.loads(gzip.decompress(user_response.content))
                except:
                    user_data = user_response.json()

                user_info = user_data.get("user", {})
                user_id = user_info.get("uid")

                if not user_id:
                    yield f"data: {json.dumps({'error': f'Could not find user ID for {handle}'})}\n\n"
                    return

                # Extract profile
                avatar_url = None
                avatar_larger = user_info.get("avatar_larger", {})
                if avatar_larger and avatar_larger.get("url_list"):
                    avatar_url = avatar_larger["url_list"][0]

                profile = {
                    "username": user_info.get("unique_id", handle),
                    "display_name": user_info.get("nickname"),
                    "profile_picture_url": avatar_url,
                }

                username = profile["username"]
                yield f"data: {json.dumps({'progress': f'Found user {username}, fetching posts...'})}\n\n"

                # Fetch user posts with pagination
                while page < max_pages and len(posts) < MAX_TIKTOK_POSTS:
                    posts_url = f"https://scraptik.p.rapidapi.com/user-posts?user_id={user_id}&count=30"
                    if max_cursor:
                        posts_url += f"&max_cursor={max_cursor}"

                    posts_response = await client.get(
                        posts_url,
                        headers={
                            "x-rapidapi-key": RAPIDAPI_KEY,
                            "x-rapidapi-host": "scraptik.p.rapidapi.com"
                        }
                    )

                    if posts_response.status_code != 200:
                        break

                    # Decompress if gzipped
                    try:
                        import gzip
                        posts_data = json.loads(gzip.decompress(posts_response.content))
                    except:
                        posts_data = posts_response.json()

                    aweme_list = posts_data.get("aweme_list", [])
                    if not aweme_list:
                        break

                    # Process posts
                    for aweme in aweme_list:
                        aweme_id = aweme.get("aweme_id", "")
                        desc = aweme.get("desc", "")
                        create_time = aweme.get("create_time")

                        # Get video info
                        video_info = aweme.get("video", {})
                        play_addr = video_info.get("play_addr", {})
                        video_urls = play_addr.get("url_list", [])

                        if not video_urls:
                            continue

                        # Get thumbnail
                        cover = video_info.get("cover", {})
                        thumbnail_urls = cover.get("url_list", [])
                        thumbnail_url = thumbnail_urls[0] if thumbnail_urls else None

                        # Duration is in milliseconds
                        duration_ms = video_info.get("duration", 0)
                        duration_sec = duration_ms / 1000 if duration_ms else None

                        # Convert timestamp to ISO format
                        original_date = None
                        if create_time:
                            from datetime import datetime
                            original_date = datetime.fromtimestamp(create_time).isoformat()

                        media_items = [{
                            "url": video_urls[0],
                            "media_type": "video",
                            "width": video_info.get("width"),
                            "height": video_info.get("height"),
                            "duration": duration_sec,
                            "thumbnail_url": thumbnail_url
                        }]

                        posts.append({
                            "id": aweme_id,
                            "post_type": "reel",  # TikTok videos are like reels
                            "caption": desc,
                            "original_date": original_date,
                            "thumbnail_url": thumbnail_url,
                            "media_items": media_items
                        })

                    page += 1

                    # Send progress update with full data (like Instagram) to enable "Continue" button
                    yield f"data: {json.dumps({'progress': True, 'count': len(posts), 'posts': posts, 'profile': profile})}\n\n"

                    # Check if we've hit the limit
                    if len(posts) >= MAX_TIKTOK_POSTS:
                        break

                    # Check for more pages
                    if not posts_data.get("has_more"):
                        break
                    max_cursor = posts_data.get("max_cursor", 0)

                # Send final result
                yield f"data: {json.dumps({'done': True, 'posts': posts, 'profile': profile, 'source': 'tiktok'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ============================================================================
# RSS Feed API Endpoints
# ============================================================================

MAX_RSS_ARTICLES = 50  # Limit articles per feed


def html_to_markdown(html: str, base_url: str = '') -> tuple[str, list[str]]:
    """
    Convert HTML content to clean Markdown.
    Returns: (markdown_content, list_of_image_urls)
    """
    from bs4 import BeautifulSoup
    from markdownify import markdownify as md
    import re

    soup = BeautifulSoup(html, 'html.parser')

    # Helper to extract clean S3 URL from Substack CDN wrapper
    def clean_substack_cdn_url(url: str) -> str:
        if not url:
            return url
        # Substack CDN URLs contain the real S3 URL at the end, URL-encoded
        # e.g. https://substackcdn.com/image/fetch/.../https%3A%2F%2Fsubstack-post-media...
        if 'substackcdn.com' in url and 'substack-post-media' in url:
            import urllib.parse
            # Find the encoded S3 URL
            if 'https%3A%2F%2Fsubstack-post-media' in url:
                idx = url.find('https%3A%2F%2Fsubstack-post-media')
                return urllib.parse.unquote(url[idx:])
        return url

    # Extract image URLs for later upload
    images = []
    for img in soup.find_all('img'):
        src = img.get('src', '')

        if src:
            # Handle relative URLs
            if src.startswith('/') and base_url:
                src = base_url.rstrip('/') + src
            # Skip data URIs
            if not src.startswith('data:'):
                # Clean Substack CDN URLs to get direct S3 URLs
                clean_src = clean_substack_cdn_url(src)
                images.append(clean_src)

    # Remove unwanted elements
    for elem in soup.find_all(['script', 'style', 'iframe', 'noscript']):
        elem.decompose()

    # Convert to Markdown
    markdown = md(
        str(soup),
        heading_style='ATX',
        bullets='-',
    )

    # Clean up excessive whitespace
    markdown = re.sub(r'\n{3,}', '\n\n', markdown)
    markdown = markdown.strip()

    return markdown, images


def extract_slug_from_url(url: str) -> str:
    """Extract a clean slug from URL for d-tag."""
    from urllib.parse import urlparse
    import re

    parsed = urlparse(url)
    path = parsed.path.strip('/')

    # Get the last path segment
    slug = path.split('/')[-1] if path else ''

    # Clean up the slug
    slug = re.sub(r'[^a-zA-Z0-9-]', '-', slug)
    slug = re.sub(r'-+', '-', slug).strip('-')

    # Fallback if empty
    if not slug:
        import hashlib
        slug = hashlib.md5(url.encode()).hexdigest()[:12]

    return slug.lower()


@app.get("/rss-stream")
async def fetch_rss_stream(feed_url: str):
    """
    Stream RSS feed fetch and parse progress using Server-Sent Events.
    Parses RSS/Atom feeds, converts HTML to Markdown for NIP-23 articles.
    """
    import feedparser
    from urllib.parse import urlparse

    async def generate():
        try:
            yield f"data: {json.dumps({'progress': 'Fetching RSS feed...'})}\n\n"

            # Fetch the RSS feed
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(feed_url, follow_redirects=True)

                if response.status_code != 200:
                    yield f"data: {json.dumps({'error': f'Failed to fetch feed: HTTP {response.status_code}'})}\n\n"
                    return

                feed_content = response.text

            # Parse the feed
            feed = feedparser.parse(feed_content)

            if feed.bozo and not feed.entries:
                yield f"data: {json.dumps({'error': 'Invalid RSS feed format'})}\n\n"
                return

            # Extract feed metadata
            feed_meta = {
                'title': feed.feed.get('title', 'Unknown Feed'),
                'description': feed.feed.get('description', feed.feed.get('subtitle', '')),
                'link': feed.feed.get('link', ''),
                'image_url': None
            }

            # Try to get feed image
            if hasattr(feed.feed, 'image') and feed.feed.image:
                feed_meta['image_url'] = feed.feed.image.get('href', feed.feed.image.get('url'))

            # Get base URL for relative links
            parsed_url = urlparse(feed_url)
            base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"

            yield f"data: {json.dumps({'progress': f'Found {len(feed.entries)} articles, processing...'})}\n\n"

            articles = []

            for entry in feed.entries[:MAX_RSS_ARTICLES]:
                # Get article content (prefer content:encoded for full article)
                content_html = ''
                if hasattr(entry, 'content') and entry.content:
                    content_html = entry.content[0].get('value', '')
                elif hasattr(entry, 'summary'):
                    content_html = entry.summary
                elif hasattr(entry, 'description'):
                    content_html = entry.description

                if not content_html:
                    continue

                # Convert HTML to Markdown
                content_markdown, inline_images = html_to_markdown(content_html, base_url)

                # Get article link and generate slug for d-tag
                link = entry.get('link', '')
                identifier = extract_slug_from_url(link) if link else f"article-{len(articles)}"

                # Get title
                title = entry.get('title', 'Untitled')

                # Get publication date
                published_at = None
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    from datetime import datetime
                    try:
                        dt = datetime(*entry.published_parsed[:6])
                        published_at = str(int(dt.timestamp()))
                    except:
                        pass

                # Get summary (first 300 chars of content if not provided)
                summary = entry.get('summary', '')
                if summary:
                    # Strip HTML from summary
                    from bs4 import BeautifulSoup
                    summary = BeautifulSoup(summary, 'html.parser').get_text()
                    summary = ' '.join(summary.split())[:300]
                if not summary and content_markdown:
                    summary = ' '.join(content_markdown.split())[:300]
                    if len(summary) == 300:
                        summary += '...'

                # Get header image (prefer inline images with clean URLs)
                image_url = None

                # Helper to extract clean S3 URL from Substack CDN wrapper
                def clean_substack_url(url: str) -> str:
                    if not url:
                        return url
                    # Substack CDN URLs contain the real S3 URL at the end, URL-encoded
                    # e.g. https://substackcdn.com/image/fetch/.../https%3A%2F%2Fsubstack-post-media...
                    if 'substackcdn.com' in url and 'substack-post-media' in url:
                        import urllib.parse
                        # Find the encoded S3 URL
                        if 'https%3A%2F%2Fsubstack-post-media' in url:
                            idx = url.find('https%3A%2F%2Fsubstack-post-media')
                            return urllib.parse.unquote(url[idx:])
                    return url

                # Prefer first inline image (already cleaned in html_to_markdown)
                if inline_images:
                    image_url = inline_images[0]

                # Try enclosure if no inline images
                if not image_url and hasattr(entry, 'enclosures') and entry.enclosures:
                    for enc in entry.enclosures:
                        if enc.get('type', '').startswith('image'):
                            enc_url = enc.get('href', enc.get('url'))
                            image_url = clean_substack_url(enc_url)
                            break

                # Try media:content
                if not image_url and hasattr(entry, 'media_content'):
                    for media in entry.media_content:
                        if media.get('type', '').startswith('image') or media.get('medium') == 'image':
                            image_url = clean_substack_url(media.get('url'))
                            break

                # Try media:thumbnail
                if not image_url and hasattr(entry, 'media_thumbnail'):
                    if entry.media_thumbnail:
                        image_url = clean_substack_url(entry.media_thumbnail[0].get('url'))

                # Extract hashtags from categories/tags
                hashtags = []
                if hasattr(entry, 'tags'):
                    for tag in entry.tags[:5]:  # Limit to 5 tags
                        term = tag.get('term', '').strip()
                        if term:
                            # Clean up hashtag
                            clean_tag = term.lower().replace(' ', '-').replace('#', '')
                            if clean_tag:
                                hashtags.append(clean_tag)

                articles.append({
                    'id': identifier,
                    'title': title,
                    'summary': summary,
                    'content_markdown': content_markdown,
                    'content_html': content_html,
                    'published_at': published_at,
                    'link': link,
                    'image_url': image_url,
                    'hashtags': hashtags,
                    'inline_images': inline_images
                })

                # Send progress updates
                if len(articles) % 5 == 0:
                    yield f"data: {json.dumps({'progress': True, 'count': len(articles), 'articles': articles, 'feed': feed_meta})}\n\n"

            # Send final result
            yield f"data: {json.dumps({'done': True, 'articles': articles, 'feed': feed_meta, 'source': 'rss'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
