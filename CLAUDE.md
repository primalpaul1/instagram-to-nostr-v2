# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Workflow

**Always use git for version control to enable reverting if changes break things.**

### Before Making Changes
```bash
git status                    # Check current state
git checkout -b feature-name  # Create a branch for new features/fixes
```

### During Development
```bash
git add -p                    # Stage changes interactively
git commit -m "descriptive message"  # Commit frequently with clear messages
```

### After Testing
```bash
git checkout main             # Switch to main
git merge feature-name        # Merge if changes work
git branch -d feature-name    # Delete feature branch
```

### If Things Break
```bash
git diff                      # See what changed
git checkout -- file.txt      # Discard changes to specific file
git reset --hard HEAD~1       # Undo last commit (destructive)
git revert <commit-hash>      # Create new commit that undoes a previous one (safer)
```

### Branch Naming
- `feature/description` - New features
- `fix/description` - Bug fixes
- `refactor/description` - Code refactoring

Commit early, commit often. When in doubt, create a branch first.

## Project Overview

Instagram-to-Nostr video migration tool. A web app that helps users migrate their Instagram videos to the Nostr protocol by fetching video metadata, uploading to Blossom media server, and publishing events to Nostr relays.

## Architecture

Three-service architecture with shared SQLite database:

1. **Frontend** (`frontend/`) - SvelteKit + TypeScript wizard-style UI
2. **Backend** (`backend/`) - Python FastAPI for video fetching via gallery-dl and Blossom uploads
3. **Worker** (`worker/`) - Python background processor for concurrent video migration jobs

All services share a mounted SQLite database at `/data/instagram.db`.

### Data Flow
```
Instagram Profile → Backend (gallery-dl metadata) → Frontend (user selection)
→ SQLite (job/task creation) → Worker (upload to Blossom, publish to relays)
```

### Key Components
- `schema.sql` - SQLite schema with `jobs` and `video_tasks` tables
- Frontend uses `sql.js` (pure JS SQLite) for database access
- Worker implements BIP-340 Schnorr signing for Nostr events using `ecdsa` library
- Nostr events published to: relay.primal.net, relay.damus.io, nos.lol

## Production Server

| | |
|----------|---------|
| **IP** | 5.161.115.236 |
| **User** | root |
| **Password** | See `.env` file (SERVER_PASSWORD) |

### Deploy to Production
```bash
ssh root@5.161.115.236 "cd /root/instagram-to-nostr-v2 && git pull && docker compose up --build -d"
```

## Development Commands

### Docker (Production)
```bash
docker compose up --build
```

### Local Development

**Frontend** (port 3000):
```bash
cd frontend && npm install && npm run dev
```

**Backend** (port 8000):
```bash
python3 -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt
cd backend && uvicorn server:app --port 8000 --reload
```

**Worker**:
```bash
source venv/bin/activate
pip install -r worker/requirements.txt
cd worker && DATABASE_PATH=../data/instagram.db python worker.py
```

### Build Frontend
```bash
cd frontend && npm run build
```

## Environment Variables

| Variable | Service | Default |
|----------|---------|---------|
| `DATABASE_PATH` | all | `/data/instagram.db` |
| `BACKEND_URL` | frontend, worker | `http://backend:8000` (Docker) / `http://localhost:8000` (local) |
| `BLOSSOM_SERVER` | backend, worker | `https://blossom.primal.net` |
| `CONCURRENCY` | worker | `3` |
| `MAX_RETRIES` | worker | `3` |
| `NOSTR_RELAYS` | worker | `wss://relay.primal.net,wss://relay.damus.io,wss://nos.lol` |

## Database Schema

Two main tables:
- `jobs` - Migration jobs with handle, Nostr keys, status
- `video_tasks` - Individual video tasks linked to jobs with Instagram URL, Blossom URL, Nostr event ID, retry count

## Nostr Integration

- Keypair generation: Client-side using `@noble/secp256k1`
- Blossom auth: Kind 24242 events with upload authorization
- Video posts: Kind 1 events with `imeta` tags containing video metadata
- Signing: BIP-340 Schnorr signatures implemented in `worker/worker.py`
