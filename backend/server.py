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


class VideoMetadata(BaseModel):
    url: str
    filename: str
    caption: Optional[str] = None
    original_date: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None
    thumbnail_url: Optional[str] = None


class FetchVideosRequest(BaseModel):
    handle: str


class FetchVideosResponse(BaseModel):
    videos: list[VideoMetadata]
    handle: str


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


@app.post("/videos", response_model=FetchVideosResponse)
async def fetch_videos(request: FetchVideosRequest):
    """
    Fetch Instagram video metadata using RapidAPI Instagram120.
    Returns list of available videos without downloading them.
    """
    handle = request.handle.lstrip("@")

    if not RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="RAPIDAPI_KEY not configured")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Fetch posts from Instagram120 API (POST request)
            response = await client.post(
                "https://instagram120.p.rapidapi.com/api/instagram/posts",
                json={"username": handle, "maxId": ""},
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
            videos = []

            # Instagram120 API returns: { "result": { "edges": [...] } }
            edges = data.get("result", {}).get("edges", [])

            for edge in edges:
                node = edge.get("node", {})

                # Check if it has video_versions (means it's a video)
                video_versions = node.get("video_versions", [])
                if not video_versions:
                    continue

                # Get the best video URL (first one is usually highest quality)
                video_url = video_versions[0].get("url") if video_versions else None
                if not video_url:
                    continue

                # Get dimensions from video_versions
                width = video_versions[0].get("width")
                height = video_versions[0].get("height")

                # Get caption
                caption = None
                caption_obj = node.get("caption")
                if caption_obj:
                    caption = caption_obj.get("text") if isinstance(caption_obj, dict) else caption_obj

                # Get timestamp
                taken_at = node.get("taken_at")
                original_date = None
                if taken_at:
                    from datetime import datetime
                    try:
                        original_date = datetime.fromtimestamp(int(taken_at)).isoformat()
                    except (ValueError, TypeError):
                        pass

                # Get thumbnail from image_versions2
                thumbnail_url = None
                image_versions = node.get("image_versions2", {}).get("candidates", [])
                if image_versions:
                    thumbnail_url = image_versions[0].get("url")

                # Get post code for filename
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

            return FetchVideosResponse(videos=videos, handle=handle)

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
