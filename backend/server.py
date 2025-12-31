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
    Fetch Instagram video metadata using gallery-dl.
    Returns list of available videos without downloading them.
    """
    handle = request.handle.lstrip("@")
    instagram_url = f"https://www.instagram.com/{handle}/"

    try:
        result = subprocess.run(
            [
                "gallery-dl",
                "--dump-json",
                "--no-download",
                instagram_url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            error_msg = result.stderr or "Failed to fetch Instagram data"
            raise HTTPException(status_code=400, detail=error_msg)

        videos = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                data = json.loads(line)

                # gallery-dl returns nested structure, extract video info
                if isinstance(data, list) and len(data) >= 3:
                    # Format: [directory, filename, url, metadata...]
                    url = data[2] if len(data) > 2 else None
                    metadata = data[3] if len(data) > 3 else {}

                    # Only include videos (mp4)
                    if url and (url.endswith(".mp4") or "video" in str(metadata.get("_type", ""))):
                        videos.append(VideoMetadata(
                            url=url,
                            filename=data[1] if len(data) > 1 else "video.mp4",
                            caption=metadata.get("description") or metadata.get("caption"),
                            original_date=metadata.get("date"),
                            width=metadata.get("width"),
                            height=metadata.get("height"),
                            duration=metadata.get("duration"),
                            thumbnail_url=metadata.get("thumbnail"),
                        ))
                elif isinstance(data, dict):
                    # Alternative format: direct dict
                    url = data.get("url") or data.get("_fallback_url")
                    if url and (".mp4" in url or data.get("extension") == "mp4"):
                        videos.append(VideoMetadata(
                            url=url,
                            filename=data.get("filename", "video") + ".mp4",
                            caption=data.get("description") or data.get("caption"),
                            original_date=data.get("date"),
                            width=data.get("width"),
                            height=data.get("height"),
                            duration=data.get("duration"),
                            thumbnail_url=data.get("thumbnail"),
                        ))
            except json.JSONDecodeError:
                continue

        return FetchVideosResponse(videos=videos, handle=handle)

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout fetching Instagram data")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/stream-upload", response_model=StreamUploadResponse)
async def stream_upload(request: StreamUploadRequest):
    """
    Stream video from Instagram CDN directly to Blossom server.
    Calculates SHA256 while streaming for memory efficiency.
    """
    video_url = request.video_url
    auth_header = request.auth_header

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
