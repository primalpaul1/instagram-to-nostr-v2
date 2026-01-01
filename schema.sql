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

-- Individual video tasks within a job
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
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'publishing', 'complete', 'error')),
  blossom_url TEXT,
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
