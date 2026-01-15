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
  profile_data TEXT,  -- JSON: {username, display_name, bio, profile_picture_url} or {profile, feed}
  proposal_type TEXT DEFAULT 'posts' CHECK (proposal_type IN ('posts', 'articles', 'combined')),
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

-- Articles within a proposal (for RSS/blog proposals)
CREATE TABLE IF NOT EXISTS proposal_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content_markdown TEXT NOT NULL,
  published_at TEXT,
  link TEXT,
  image_url TEXT,
  blossom_image_url TEXT,
  hashtags TEXT,  -- JSON array
  inline_image_urls TEXT,  -- JSON mapping: {"original_url": "blossom_url"}
  upload_attempts INTEGER DEFAULT 0,  -- Track retry count for image uploads
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

-- Indexes for proposals
CREATE INDEX IF NOT EXISTS idx_proposals_claim_token ON proposals(claim_token);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_expires_at ON proposals(expires_at);
CREATE INDEX IF NOT EXISTS idx_proposal_posts_proposal_id ON proposal_posts(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_articles_proposal_id ON proposal_articles(proposal_id);

-- Gifts for deterministic key derivation (no npub required)
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  claim_token TEXT UNIQUE NOT NULL,
  ig_handle TEXT NOT NULL,
  profile_data TEXT,  -- JSON: {username, display_name, bio, profile_picture_url} or {profile, feed}
  salt TEXT NOT NULL,  -- Random salt for key derivation (legacy, no longer used)
  gift_type TEXT DEFAULT 'posts' CHECK (gift_type IN ('posts', 'articles', 'combined')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'claimed', 'expired')),
  claimed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- Posts within a gift
CREATE TABLE IF NOT EXISTS gift_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_id TEXT NOT NULL,
  post_type TEXT NOT NULL CHECK (post_type IN ('reel', 'image', 'carousel')),
  caption TEXT,
  original_date TEXT,
  media_items TEXT NOT NULL,  -- JSON array of original media URLs
  blossom_urls TEXT,  -- JSON array of uploaded blossom URLs
  thumbnail_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'ready', 'published')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE CASCADE
);

-- Articles within a gift (for RSS/blog gifts)
CREATE TABLE IF NOT EXISTS gift_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content_markdown TEXT NOT NULL,
  published_at TEXT,
  link TEXT,
  image_url TEXT,
  blossom_image_url TEXT,
  hashtags TEXT,  -- JSON array
  inline_image_urls TEXT,  -- JSON mapping: {"original_url": "blossom_url"}
  upload_attempts INTEGER DEFAULT 0,  -- Track retry count for image uploads
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE CASCADE
);

-- Indexes for gifts
CREATE INDEX IF NOT EXISTS idx_gifts_claim_token ON gifts(claim_token);
CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status);
CREATE INDEX IF NOT EXISTS idx_gifts_expires_at ON gifts(expires_at);
CREATE INDEX IF NOT EXISTS idx_gift_posts_gift_id ON gift_posts(gift_id);
CREATE INDEX IF NOT EXISTS idx_gift_articles_gift_id ON gift_articles(gift_id);
