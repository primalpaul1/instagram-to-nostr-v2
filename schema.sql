-- Migration jobs
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  public_key_hex TEXT NOT NULL,
  secret_key_hex TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error')),
  profile_name TEXT,
  profile_bio TEXT,
  profile_picture_url TEXT,
  profile_blossom_url TEXT,
  profile_published INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Individual post tasks within a job
CREATE TABLE IF NOT EXISTS video_tasks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  instagram_url TEXT NOT NULL,
  filename TEXT,
  caption TEXT,
  original_date TEXT,
  width INTEGER,
  height INTEGER,
  duration REAL,
  thumbnail_url TEXT,
  post_type TEXT DEFAULT 'reel' CHECK (post_type IN ('reel', 'image', 'carousel')),
  media_items TEXT,  -- JSON array of media items for carousels
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'publishing', 'complete', 'error')),
  blossom_url TEXT,
  blossom_urls TEXT,  -- JSON array of blossom URLs for multi-media posts
  nostr_event_id TEXT,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_tasks_job_id ON video_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks(status);

-- Proposals for third-party migrations
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  claim_token TEXT UNIQUE NOT NULL,
  target_npub TEXT NOT NULL,
  target_pubkey_hex TEXT NOT NULL,
  ig_handle TEXT NOT NULL,
  profile_data TEXT,  -- JSON: {username, display_name, bio, profile_picture_url}
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'claimed', 'expired')),
  claimed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- Posts within a proposal
CREATE TABLE IF NOT EXISTS proposal_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  post_type TEXT NOT NULL CHECK (post_type IN ('reel', 'image', 'carousel')),
  caption TEXT,
  original_date TEXT,
  media_items TEXT NOT NULL,  -- JSON array of original media URLs
  blossom_urls TEXT,  -- JSON array of uploaded blossom URLs
  thumbnail_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'ready', 'published')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

-- Indexes for proposals
CREATE INDEX IF NOT EXISTS idx_proposals_claim_token ON proposals(claim_token);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_expires_at ON proposals(expires_at);
CREATE INDEX IF NOT EXISTS idx_proposal_posts_proposal_id ON proposal_posts(proposal_id);
