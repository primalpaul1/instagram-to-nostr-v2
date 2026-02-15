import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

const DATABASE_PATH = env.DATABASE_PATH || '/data/instagram.db';

// Single persistent database connection with WAL mode
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dataDir = path.dirname(DATABASE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Check if database exists - if not, we need to initialize it
    const dbExists = fs.existsSync(DATABASE_PATH);

    // Open database connection
    db = new Database(DATABASE_PATH);

    // Enable WAL mode for better concurrency with worker
    db.pragma('journal_mode = WAL');

    // Initialize schema if new database
    if (!dbExists) {
      const schemaPath = path.join(process.cwd(), 'schema.sql');
      const parentSchemaPath = path.join(process.cwd(), '..', 'schema.sql');

      let schema = '';
      if (fs.existsSync(schemaPath)) {
        schema = fs.readFileSync(schemaPath, 'utf-8');
      } else if (fs.existsSync(parentSchemaPath)) {
        schema = fs.readFileSync(parentSchemaPath, 'utf-8');
      }

      if (schema) {
        db.exec(schema);
      }
    }
  }
  return db;
}

// Helper to convert row object to typed interface
function rowToObject<T>(row: Record<string, unknown>): T {
  return row as T;
}

export interface Job {
  id: string;
  handle: string;
  public_key_hex: string;
  secret_key_hex: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  profile_name: string | null;
  profile_bio: string | null;
  profile_picture_url: string | null;
  profile_blossom_url: string | null;
  profile_published: number;
  created_at: string;
  updated_at: string;
}

export interface VideoTask {
  id: string;
  job_id: string;
  instagram_url: string;
  filename: string | null;
  caption: string | null;
  original_date: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnail_url: string | null;
  post_type: 'reel' | 'image' | 'carousel';
  media_items: string | null;  // JSON string
  status: 'pending' | 'uploading' | 'publishing' | 'complete' | 'error';
  blossom_url: string | null;
  blossom_urls: string | null;  // JSON string
  nostr_event_id: string | null;
  error: string | null;
  retry_count: number;
  created_at: string;
}

export async function createJob(
  id: string,
  handle: string,
  publicKeyHex: string,
  secretKeyHex: string,
  profileName?: string,
  profileBio?: string,
  profilePictureUrl?: string
): Promise<Job> {
  const database = getDb();
  database.prepare(
    `INSERT INTO jobs (id, handle, public_key_hex, secret_key_hex, status, profile_name, profile_bio, profile_picture_url)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(id, handle, publicKeyHex, secretKeyHex, profileName || null, profileBio || null, profilePictureUrl || null);

  const row = database.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return rowToObject<Job>(row as Record<string, unknown>);
}

export async function getJob(id: string): Promise<Job | undefined> {
  const database = getDb();
  const row = database.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!row) return undefined;
  return rowToObject<Job>(row as Record<string, unknown>);
}

export async function updateJobStatus(id: string, status: Job['status']): Promise<void> {
  const database = getDb();
  database.prepare(
    `UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
}

export async function createVideoTask(
  id: string,
  jobId: string,
  instagramUrl: string,
  filename?: string,
  caption?: string,
  originalDate?: string,
  width?: number,
  height?: number,
  duration?: number,
  thumbnailUrl?: string,
  postType?: 'reel' | 'image' | 'carousel',
  mediaItems?: string  // JSON string
): Promise<VideoTask> {
  const database = getDb();
  database.prepare(
    `INSERT INTO video_tasks (
      id, job_id, instagram_url, filename, caption, original_date,
      width, height, duration, thumbnail_url, post_type, media_items, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    id,
    jobId,
    instagramUrl,
    filename || null,
    caption || null,
    originalDate || null,
    width || null,
    height || null,
    duration || null,
    thumbnailUrl || null,
    postType || 'reel',
    mediaItems || null
  );

  const row = database.prepare('SELECT * FROM video_tasks WHERE id = ?').get(id);
  return rowToObject<VideoTask>(row as Record<string, unknown>);
}

export async function getVideoTask(id: string): Promise<VideoTask | undefined> {
  const database = getDb();
  const row = database.prepare('SELECT * FROM video_tasks WHERE id = ?').get(id);
  if (!row) return undefined;
  return rowToObject<VideoTask>(row as Record<string, unknown>);
}

export async function getVideoTasksByJobId(jobId: string): Promise<VideoTask[]> {
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM video_tasks WHERE job_id = ? ORDER BY created_at'
  ).all(jobId);
  return rows.map(row => rowToObject<VideoTask>(row as Record<string, unknown>));
}

export async function getJobWithTasks(jobId: string): Promise<{ job: Job; tasks: VideoTask[] } | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  const tasks = await getVideoTasksByJobId(jobId);
  return { job, tasks };
}

// ============================================
// Proposal functions for third-party migrations
// ============================================

export interface Proposal {
  id: string;
  claim_token: string;
  target_npub: string;
  target_pubkey_hex: string;
  ig_handle: string;
  profile_data: string | null;  // JSON string
  proposal_type: 'posts' | 'articles' | 'combined';
  prepared_by: string | null;  // JSON string: {npub, name, picture}
  status: 'pending' | 'processing' | 'ready' | 'claimed' | 'expired';
  claimed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface ProposalPost {
  id: number;
  proposal_id: string;
  post_type: 'reel' | 'image' | 'carousel';
  caption: string | null;
  original_date: string | null;
  media_items: string;  // JSON string
  blossom_urls: string | null;  // JSON string
  thumbnail_url: string | null;
  status: 'pending' | 'uploading' | 'ready' | 'published';
  created_at: string;
}

export interface ProposalArticle {
  id: number;
  proposal_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  published_at: string | null;
  link: string | null;
  image_url: string | null;
  blossom_image_url: string | null;
  hashtags: string | null;  // JSON string
  inline_image_urls: string | null;  // JSON mapping
  status: 'pending' | 'ready' | 'published';
  created_at: string;
}

export async function ensureProposalTables(): Promise<void> {
  const database = getDb();

  // Check if proposals table exists
  const tableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='proposals'"
  ).get();

  if (!tableExists) {
    // Create proposals tables
    database.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        claim_token TEXT UNIQUE NOT NULL,
        target_npub TEXT NOT NULL,
        target_pubkey_hex TEXT NOT NULL,
        ig_handle TEXT NOT NULL,
        profile_data TEXT,
        proposal_type TEXT DEFAULT 'posts' CHECK (proposal_type IN ('posts', 'articles', 'combined')),
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'claimed', 'expired')),
        claimed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS proposal_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        post_type TEXT NOT NULL CHECK (post_type IN ('reel', 'image', 'carousel')),
        caption TEXT,
        original_date TEXT,
        media_items TEXT NOT NULL,
        blossom_urls TEXT,
        thumbnail_url TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      )
    `);

    database.exec(`
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
        hashtags TEXT,
        inline_image_urls TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
      )
    `);

    database.exec('CREATE INDEX IF NOT EXISTS idx_proposals_claim_token ON proposals(claim_token)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_proposals_expires_at ON proposals(expires_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_proposal_posts_proposal_id ON proposal_posts(proposal_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_proposal_articles_proposal_id ON proposal_articles(proposal_id)');
  } else {
    // Table exists, check if proposal_type column exists
    const columns = database.prepare("PRAGMA table_info(proposals)").all() as Array<{name: string}>;
    const columnNames = columns.map(col => col.name);

    if (!columnNames.includes('proposal_type')) {
      database.exec("ALTER TABLE proposals ADD COLUMN proposal_type TEXT DEFAULT 'posts' CHECK (proposal_type IN ('posts', 'articles', 'combined'))");
    }

    if (!columnNames.includes('prepared_by')) {
      database.exec("ALTER TABLE proposals ADD COLUMN prepared_by TEXT");
    }

    // Check if proposal_articles table exists
    const articlesTableExists = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='proposal_articles'"
    ).get();

    if (!articlesTableExists) {
      database.exec(`
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
          hashtags TEXT,
          inline_image_urls TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
        )
      `);
      database.exec('CREATE INDEX IF NOT EXISTS idx_proposal_articles_proposal_id ON proposal_articles(proposal_id)');
    }
  }
}

export async function createProposal(
  id: string,
  claimToken: string,
  targetNpub: string,
  targetPubkeyHex: string,
  igHandle: string,
  profileData?: string,
  expiresAt?: string,
  proposalType: 'posts' | 'articles' | 'combined' = 'posts'
): Promise<Proposal> {
  await ensureProposalTables();
  const database = getDb();

  // Default expiration: 30 days from now
  const expiration = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  database.prepare(
    `INSERT INTO proposals (id, claim_token, target_npub, target_pubkey_hex, ig_handle, profile_data, proposal_type, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, claimToken, targetNpub, targetPubkeyHex, igHandle, profileData || null, proposalType, expiration);

  const row = database.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
  return rowToObject<Proposal>(row as Record<string, unknown>);
}

export async function getProposal(id: string): Promise<Proposal | undefined> {
  await ensureProposalTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
  if (!row) return undefined;
  return rowToObject<Proposal>(row as Record<string, unknown>);
}

export async function getProposalByToken(claimToken: string): Promise<Proposal | undefined> {
  await ensureProposalTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM proposals WHERE claim_token = ?').get(claimToken);
  if (!row) return undefined;
  return rowToObject<Proposal>(row as Record<string, unknown>);
}

export async function updateProposalStatus(id: string, status: Proposal['status']): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, id);
}

export async function markProposalClaimed(id: string): Promise<void> {
  const database = getDb();
  database.prepare(
    `UPDATE proposals SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?`
  ).run(id);
}

export async function createProposalPost(
  proposalId: string,
  postType: 'reel' | 'image' | 'carousel',
  mediaItems: string,
  caption?: string,
  originalDate?: string,
  thumbnailUrl?: string
): Promise<ProposalPost> {
  await ensureProposalTables();
  const database = getDb();

  database.prepare(
    `INSERT INTO proposal_posts (proposal_id, post_type, media_items, caption, original_date, thumbnail_url)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(proposalId, postType, mediaItems, caption || null, originalDate || null, thumbnailUrl || null);

  // Get the last inserted post
  const row = database.prepare(
    'SELECT * FROM proposal_posts WHERE proposal_id = ? ORDER BY id DESC LIMIT 1'
  ).get(proposalId);
  return rowToObject<ProposalPost>(row as Record<string, unknown>);
}

export async function getProposalPosts(proposalId: string): Promise<ProposalPost[]> {
  await ensureProposalTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM proposal_posts WHERE proposal_id = ? ORDER BY id'
  ).all(proposalId);
  return rows.map(row => rowToObject<ProposalPost>(row as Record<string, unknown>));
}

export async function updateProposalPostStatus(
  postId: number,
  status: ProposalPost['status'],
  blossomUrls?: string
): Promise<void> {
  const database = getDb();
  if (blossomUrls) {
    database.prepare(
      'UPDATE proposal_posts SET status = ?, blossom_urls = ? WHERE id = ?'
    ).run(status, blossomUrls, postId);
  } else {
    database.prepare('UPDATE proposal_posts SET status = ? WHERE id = ?').run(status, postId);
  }
}

export async function getProposalWithPosts(proposalId: string): Promise<{ proposal: Proposal; posts: ProposalPost[] } | null> {
  const proposal = await getProposal(proposalId);
  if (!proposal) return null;

  const posts = await getProposalPosts(proposalId);
  return { proposal, posts };
}

export async function getProposalByTokenWithPosts(claimToken: string): Promise<{ proposal: Proposal; posts: ProposalPost[] } | null> {
  const proposal = await getProposalByToken(claimToken);
  if (!proposal) return null;

  const posts = await getProposalPosts(proposal.id);
  return { proposal, posts };
}

// Proposal article functions

export async function createProposalArticle(
  proposalId: string,
  title: string,
  contentMarkdown: string,
  summary?: string,
  publishedAt?: string,
  link?: string,
  imageUrl?: string,
  hashtags?: string[]
): Promise<ProposalArticle> {
  await ensureProposalTables();
  const database = getDb();

  database.prepare(
    `INSERT INTO proposal_articles (proposal_id, title, summary, content_markdown, published_at, link, image_url, hashtags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    proposalId,
    title,
    summary || null,
    contentMarkdown,
    publishedAt || null,
    link || null,
    imageUrl || null,
    hashtags ? JSON.stringify(hashtags) : null
  );

  // Get the last inserted article
  const row = database.prepare(
    'SELECT * FROM proposal_articles WHERE proposal_id = ? ORDER BY id DESC LIMIT 1'
  ).get(proposalId);
  return rowToObject<ProposalArticle>(row as Record<string, unknown>);
}

export async function getProposalArticles(proposalId: string): Promise<ProposalArticle[]> {
  await ensureProposalTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM proposal_articles WHERE proposal_id = ? ORDER BY id'
  ).all(proposalId);
  return rows.map(row => rowToObject<ProposalArticle>(row as Record<string, unknown>));
}

export async function updateProposalArticleStatus(
  articleId: number,
  status: ProposalArticle['status']
): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE proposal_articles SET status = ? WHERE id = ?').run(status, articleId);
}

export async function getProposalByTokenWithArticles(claimToken: string): Promise<{ proposal: Proposal; articles: ProposalArticle[] } | null> {
  const proposal = await getProposalByToken(claimToken);
  if (!proposal) return null;

  const articles = await getProposalArticles(proposal.id);
  return { proposal, articles };
}

export async function getProposalByTokenWithBoth(claimToken: string): Promise<{ proposal: Proposal; posts: ProposalPost[]; articles: ProposalArticle[] } | null> {
  const proposal = await getProposalByToken(claimToken);
  if (!proposal) return null;

  const posts = await getProposalPosts(proposal.id);
  const articles = await getProposalArticles(proposal.id);
  return { proposal, posts, articles };
}

// Batched proposal creation - creates proposal with all posts/articles in single DB transaction
export interface ProposalPostInput {
  postType: 'reel' | 'image' | 'carousel';
  mediaItems: string;
  caption?: string;
  originalDate?: string;
  thumbnailUrl?: string;
}

export interface ProposalArticleInput {
  title: string;
  contentMarkdown: string;
  summary?: string;
  publishedAt?: string;
  link?: string;
  imageUrl?: string;
  hashtags?: string[];
}

export async function createProposalWithContent(
  id: string,
  claimToken: string,
  targetNpub: string,
  targetPubkeyHex: string,
  igHandle: string,
  profileData: string | undefined,
  proposalType: 'posts' | 'articles' | 'combined',
  posts: ProposalPostInput[],
  articles: ProposalArticleInput[],
  preparedBy?: string  // JSON string: {npub, name, picture}
): Promise<Proposal> {
  await ensureProposalTables();
  const database = getDb();

  // Use a transaction for atomic creation
  const transaction = database.transaction(() => {
    // Default expiration: 30 days from now
    const expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Create the proposal
    database.prepare(
      `INSERT INTO proposals (id, claim_token, target_npub, target_pubkey_hex, ig_handle, profile_data, proposal_type, prepared_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, claimToken, targetNpub, targetPubkeyHex, igHandle, profileData || null, proposalType, preparedBy || null, expiration);

    // Create all posts in the same transaction
    const insertPost = database.prepare(
      `INSERT INTO proposal_posts (proposal_id, post_type, media_items, caption, original_date, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const post of posts) {
      insertPost.run(id, post.postType, post.mediaItems, post.caption || null, post.originalDate || null, post.thumbnailUrl || null);
    }

    // Create all articles in the same transaction
    const insertArticle = database.prepare(
      `INSERT INTO proposal_articles (proposal_id, title, summary, content_markdown, published_at, link, image_url, hashtags, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );
    for (const article of articles) {
      insertArticle.run(
        id,
        article.title,
        article.summary || null,
        article.contentMarkdown,
        article.publishedAt || null,
        article.link || null,
        article.imageUrl || null,
        article.hashtags ? JSON.stringify(article.hashtags) : null
      );
    }

    // Return the proposal we just created
    return database.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
  });

  const row = transaction();
  return rowToObject<Proposal>(row as Record<string, unknown>);
}

export async function getPendingProposals(): Promise<Proposal[]> {
  await ensureProposalTables();
  const database = getDb();
  const rows = database.prepare(
    "SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at"
  ).all();
  return rows.map(row => rowToObject<Proposal>(row as Record<string, unknown>));
}

export async function cleanupExpiredProposals(): Promise<number> {
  await ensureProposalTables();
  const database = getDb();

  // Get count of expired proposals
  const countRow = database.prepare(
    "SELECT COUNT(*) as count FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'"
  ).get() as { count: number };
  const count = countRow?.count || 0;

  if (count > 0) {
    // Delete proposal posts first (foreign key)
    database.prepare(`
      DELETE FROM proposal_posts
      WHERE proposal_id IN (
        SELECT id FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'
      )
    `).run();

    // Delete expired proposals
    database.prepare("DELETE FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'").run();
  }

  return count;
}

// ============================================
// Gift functions for deterministic key derivation
// ============================================

export interface Gift {
  id: string;
  claim_token: string;
  ig_handle: string;
  profile_data: string | null;  // JSON string
  salt: string | null;  // No longer used - kept for backward compatibility
  gift_type: 'posts' | 'articles' | 'combined';
  suggested_follows: string | null;  // JSON array of npubs
  prepared_by: string | null;  // JSON string: {npub, name, picture}
  email: string | null;  // Optional email for notification when gift is ready
  email_sent: number;  // 0 = not sent, 1 = sent
  status: 'pending' | 'processing' | 'ready' | 'claimed' | 'expired';
  claimed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface GiftPost {
  id: number;
  gift_id: string;
  post_type: 'reel' | 'image' | 'carousel' | 'text';
  caption: string | null;
  original_date: string | null;
  media_items: string;  // JSON string
  blossom_urls: string | null;  // JSON string
  thumbnail_url: string | null;
  status: 'pending' | 'uploading' | 'ready' | 'published';
  created_at: string;
}

export interface GiftArticle {
  id: number;
  gift_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  published_at: string | null;
  link: string | null;
  image_url: string | null;
  blossom_image_url: string | null;
  hashtags: string | null;  // JSON string
  inline_image_urls: string | null;  // JSON mapping: {"original_url": "blossom_url"}
  status: 'pending' | 'ready' | 'published';
  created_at: string;
}

export async function ensureGiftTables(): Promise<void> {
  const database = getDb();

  // Check if gifts table exists
  const tableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='gifts'"
  ).get();

  if (!tableExists) {
    // Create gifts tables
    database.exec(`
      CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        claim_token TEXT UNIQUE NOT NULL,
        ig_handle TEXT NOT NULL,
        profile_data TEXT,
        salt TEXT NOT NULL,
        gift_type TEXT DEFAULT 'posts' CHECK (gift_type IN ('posts', 'articles', 'combined')),
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'claimed', 'expired')),
        claimed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS gift_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gift_id TEXT NOT NULL,
        post_type TEXT NOT NULL CHECK (post_type IN ('reel', 'image', 'carousel', 'text')),
        caption TEXT,
        original_date TEXT,
        media_items TEXT NOT NULL,
        blossom_urls TEXT,
        thumbnail_url TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE CASCADE
      )
    `);

    database.exec(`
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
        hashtags TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE CASCADE
      )
    `);

    database.exec('CREATE INDEX IF NOT EXISTS idx_gifts_claim_token ON gifts(claim_token)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_gifts_expires_at ON gifts(expires_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_gift_posts_gift_id ON gift_posts(gift_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_gift_articles_gift_id ON gift_articles(gift_id)');
  } else {
    // Table exists, check if gift_type column exists
    const columns = database.prepare("PRAGMA table_info(gifts)").all() as Array<{name: string}>;
    const columnNames = columns.map(col => col.name);

    if (!columnNames.includes('gift_type')) {
      database.exec("ALTER TABLE gifts ADD COLUMN gift_type TEXT DEFAULT 'posts' CHECK (gift_type IN ('posts', 'articles', 'combined'))");
    }

    if (!columnNames.includes('suggested_follows')) {
      database.exec("ALTER TABLE gifts ADD COLUMN suggested_follows TEXT");
    }

    if (!columnNames.includes('prepared_by')) {
      database.exec("ALTER TABLE gifts ADD COLUMN prepared_by TEXT");
    }

    if (!columnNames.includes('email')) {
      database.exec("ALTER TABLE gifts ADD COLUMN email TEXT");
    }

    if (!columnNames.includes('email_sent')) {
      database.exec("ALTER TABLE gifts ADD COLUMN email_sent INTEGER DEFAULT 0");
    }

    // Check if gift_articles table exists
    const articlesTableExists = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gift_articles'"
    ).get();

    if (!articlesTableExists) {
      database.exec(`
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
          hashtags TEXT,
          inline_image_urls TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE CASCADE
        )
      `);
      database.exec('CREATE INDEX IF NOT EXISTS idx_gift_articles_gift_id ON gift_articles(gift_id)');
    } else {
      // Check if inline_image_urls column exists in gift_articles
      const articleColumns = database.prepare("PRAGMA table_info(gift_articles)").all() as Array<{name: string}>;
      const articleColumnNames = articleColumns.map(col => col.name);

      if (!articleColumnNames.includes('inline_image_urls')) {
        database.exec("ALTER TABLE gift_articles ADD COLUMN inline_image_urls TEXT");
      }
    }
  }
}

export async function createGift(
  id: string,
  claimToken: string,
  igHandle: string,
  profileData?: string,
  expiresAt?: string,
  giftType: 'posts' | 'articles' | 'combined' = 'posts'
): Promise<Gift> {
  await ensureGiftTables();
  const database = getDb();

  // Default expiration: 30 days from now
  const expiration = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  database.prepare(
    `INSERT INTO gifts (id, claim_token, ig_handle, salt, profile_data, gift_type, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, claimToken, igHandle, '', profileData || null, giftType, expiration);

  // Return the gift we just created
  const row = database.prepare('SELECT * FROM gifts WHERE id = ?').get(id);
  return rowToObject<Gift>(row as Record<string, unknown>);
}

export async function getGift(id: string): Promise<Gift | undefined> {
  await ensureGiftTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM gifts WHERE id = ?').get(id);
  if (!row) return undefined;
  return rowToObject<Gift>(row as Record<string, unknown>);
}

export async function getGiftByToken(claimToken: string): Promise<Gift | undefined> {
  await ensureGiftTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM gifts WHERE claim_token = ?').get(claimToken);
  if (!row) return undefined;
  return rowToObject<Gift>(row as Record<string, unknown>);
}

export async function updateGiftStatus(id: string, status: Gift['status']): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE gifts SET status = ? WHERE id = ?').run(status, id);
}

export async function markGiftClaimed(id: string): Promise<void> {
  const database = getDb();
  database.prepare(
    `UPDATE gifts SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?`
  ).run(id);
}

export async function createGiftPost(
  giftId: string,
  postType: 'reel' | 'image' | 'carousel',
  mediaItems: string,
  caption?: string,
  originalDate?: string,
  thumbnailUrl?: string
): Promise<GiftPost> {
  await ensureGiftTables();
  const database = getDb();

  database.prepare(
    `INSERT INTO gift_posts (gift_id, post_type, media_items, caption, original_date, thumbnail_url)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(giftId, postType, mediaItems, caption || null, originalDate || null, thumbnailUrl || null);

  // Get the last inserted post
  const row = database.prepare(
    'SELECT * FROM gift_posts WHERE gift_id = ? ORDER BY id DESC LIMIT 1'
  ).get(giftId);
  return rowToObject<GiftPost>(row as Record<string, unknown>);
}

export async function getGiftPosts(giftId: string): Promise<GiftPost[]> {
  await ensureGiftTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM gift_posts WHERE gift_id = ? ORDER BY id'
  ).all(giftId);
  return rows.map(row => rowToObject<GiftPost>(row as Record<string, unknown>));
}

export async function updateGiftPostStatus(
  postId: number,
  status: GiftPost['status'],
  blossomUrls?: string
): Promise<void> {
  const database = getDb();
  if (blossomUrls) {
    database.prepare(
      'UPDATE gift_posts SET status = ?, blossom_urls = ? WHERE id = ?'
    ).run(status, blossomUrls, postId);
  } else {
    database.prepare('UPDATE gift_posts SET status = ? WHERE id = ?').run(status, postId);
  }
}

export async function getGiftWithPosts(giftId: string): Promise<{ gift: Gift; posts: GiftPost[] } | null> {
  const gift = await getGift(giftId);
  if (!gift) return null;

  const posts = await getGiftPosts(giftId);
  return { gift, posts };
}

export async function getGiftByTokenWithPosts(claimToken: string): Promise<{ gift: Gift; posts: GiftPost[] } | null> {
  const gift = await getGiftByToken(claimToken);
  if (!gift) return null;

  const posts = await getGiftPosts(gift.id);
  return { gift, posts };
}

// Gift article functions (for RSS/article gifts)

export async function createGiftArticle(
  giftId: string,
  title: string,
  contentMarkdown: string,
  summary?: string,
  publishedAt?: string,
  link?: string,
  imageUrl?: string,
  blossomImageUrl?: string,
  hashtags?: string[]
): Promise<GiftArticle> {
  await ensureGiftTables();
  const database = getDb();

  database.prepare(
    `INSERT INTO gift_articles (gift_id, title, summary, content_markdown, published_at, link, image_url, blossom_image_url, hashtags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    giftId,
    title,
    summary || null,
    contentMarkdown,
    publishedAt || null,
    link || null,
    imageUrl || null,
    blossomImageUrl || null,
    hashtags ? JSON.stringify(hashtags) : null
  );

  // Get the last inserted article
  const row = database.prepare(
    'SELECT * FROM gift_articles WHERE gift_id = ? ORDER BY id DESC LIMIT 1'
  ).get(giftId);
  return rowToObject<GiftArticle>(row as Record<string, unknown>);
}

export async function getGiftArticles(giftId: string): Promise<GiftArticle[]> {
  await ensureGiftTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM gift_articles WHERE gift_id = ? ORDER BY id'
  ).all(giftId);
  return rows.map(row => rowToObject<GiftArticle>(row as Record<string, unknown>));
}

export async function updateGiftArticleStatus(
  articleId: number,
  status: GiftArticle['status']
): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE gift_articles SET status = ? WHERE id = ?').run(status, articleId);
}

export async function getGiftByTokenWithArticles(claimToken: string): Promise<{ gift: Gift; articles: GiftArticle[] } | null> {
  const gift = await getGiftByToken(claimToken);
  if (!gift) return null;

  const articles = await getGiftArticles(gift.id);
  return { gift, articles };
}

export async function getGiftByTokenWithBoth(claimToken: string): Promise<{ gift: Gift; posts: GiftPost[]; articles: GiftArticle[] } | null> {
  const gift = await getGiftByToken(claimToken);
  if (!gift) return null;

  const posts = await getGiftPosts(gift.id);
  const articles = await getGiftArticles(gift.id);
  return { gift, posts, articles };
}

export async function getPendingGifts(): Promise<Gift[]> {
  await ensureGiftTables();
  const database = getDb();
  const rows = database.prepare(
    "SELECT * FROM gifts WHERE status = 'pending' ORDER BY created_at"
  ).all();
  return rows.map(row => rowToObject<Gift>(row as Record<string, unknown>));
}

export async function cleanupExpiredGifts(): Promise<number> {
  await ensureGiftTables();
  const database = getDb();

  // Get count of expired gifts
  const countRow = database.prepare(
    "SELECT COUNT(*) as count FROM gifts WHERE expires_at < datetime('now') AND status != 'claimed'"
  ).get() as { count: number };
  const count = countRow?.count || 0;

  if (count > 0) {
    // Delete gift posts first (foreign key)
    database.prepare(`
      DELETE FROM gift_posts
      WHERE gift_id IN (
        SELECT id FROM gifts WHERE expires_at < datetime('now') AND status != 'claimed'
      )
    `).run();

    // Delete expired gifts
    database.prepare("DELETE FROM gifts WHERE expires_at < datetime('now') AND status != 'claimed'").run();
  }

  return count;
}

// Transactional gift creation - creates gift with all posts and articles atomically
// This prevents race conditions where the gift or some posts could be lost
export interface GiftPostInput {
  postType: 'reel' | 'image' | 'carousel';
  mediaItems: string;
  caption?: string;
  originalDate?: string;
  thumbnailUrl?: string;
}

export interface GiftArticleInput {
  title: string;
  contentMarkdown: string;
  summary?: string;
  publishedAt?: string;
  link?: string;
  imageUrl?: string;
  blossomImageUrl?: string;
  hashtags?: string[];
}

export async function createGiftWithContent(
  id: string,
  claimToken: string,
  igHandle: string,
  profileData: string | undefined,
  giftType: 'posts' | 'articles' | 'combined',
  posts: GiftPostInput[],
  articles: GiftArticleInput[],
  suggestedFollows?: string[],
  preparedBy?: string,  // JSON string: {npub, name, picture}
  email?: string
): Promise<Gift> {
  await ensureGiftTables();
  const database = getDb();

  // Use a transaction for atomic creation
  const transaction = database.transaction(() => {
    // Default expiration: 30 days from now
    const expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Create the gift
    database.prepare(
      `INSERT INTO gifts (id, claim_token, ig_handle, salt, profile_data, gift_type, suggested_follows, prepared_by, email, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, claimToken, igHandle, '', profileData || null, giftType, suggestedFollows?.length ? JSON.stringify(suggestedFollows) : null, preparedBy || null, email || null, expiration);

    // Create all posts
    const insertPost = database.prepare(
      `INSERT INTO gift_posts (gift_id, post_type, media_items, caption, original_date, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const post of posts) {
      insertPost.run(id, post.postType, post.mediaItems, post.caption || null, post.originalDate || null, post.thumbnailUrl || null);
    }

    // Create all articles
    const insertArticle = database.prepare(
      `INSERT INTO gift_articles (gift_id, title, summary, content_markdown, published_at, link, image_url, blossom_image_url, hashtags, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );
    for (const article of articles) {
      insertArticle.run(
        id,
        article.title,
        article.summary || null,
        article.contentMarkdown,
        article.publishedAt || null,
        article.link || null,
        article.imageUrl || null,
        article.blossomImageUrl || null,
        article.hashtags ? JSON.stringify(article.hashtags) : null
      );
    }

    // Return the gift we just created
    return database.prepare('SELECT * FROM gifts WHERE id = ?').get(id);
  });

  const row = transaction();
  return rowToObject<Gift>(row as Record<string, unknown>);
}

// ============================================
// RSS Gift functions for gifting articles
// ============================================

export interface RssGift {
  id: string;
  claim_token: string;
  feed_url: string;
  feed_title: string | null;
  feed_description: string | null;
  feed_image_url: string | null;
  status: 'pending' | 'processing' | 'ready' | 'claimed' | 'expired';
  claimed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface RssGiftArticle {
  id: number;
  rss_gift_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  published_at: string | null;
  link: string | null;
  image_url: string | null;
  blossom_image_url: string | null;
  hashtags: string | null;  // JSON string
  status: 'pending' | 'ready' | 'published';
  created_at: string;
}

export async function ensureRssGiftTables(): Promise<void> {
  const database = getDb();

  // Check if rss_gifts table exists
  const tableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='rss_gifts'"
  ).get();

  if (!tableExists) {
    // Create rss_gifts tables
    database.exec(`
      CREATE TABLE IF NOT EXISTS rss_gifts (
        id TEXT PRIMARY KEY,
        claim_token TEXT UNIQUE NOT NULL,
        feed_url TEXT NOT NULL,
        feed_title TEXT,
        feed_description TEXT,
        feed_image_url TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'claimed', 'expired')),
        claimed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS rss_gift_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rss_gift_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        content_markdown TEXT NOT NULL,
        published_at TEXT,
        link TEXT,
        image_url TEXT,
        blossom_image_url TEXT,
        hashtags TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rss_gift_id) REFERENCES rss_gifts(id) ON DELETE CASCADE
      )
    `);

    database.exec('CREATE INDEX IF NOT EXISTS idx_rss_gifts_claim_token ON rss_gifts(claim_token)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_rss_gifts_status ON rss_gifts(status)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_rss_gift_articles_rss_gift_id ON rss_gift_articles(rss_gift_id)');
  }
}

export async function createRssGift(
  id: string,
  claimToken: string,
  feedUrl: string,
  feedTitle?: string,
  feedDescription?: string,
  feedImageUrl?: string,
  expiresAt?: string
): Promise<RssGift> {
  await ensureRssGiftTables();
  const database = getDb();

  // Default expiration: 30 days from now
  const expiration = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  database.prepare(
    `INSERT INTO rss_gifts (id, claim_token, feed_url, feed_title, feed_description, feed_image_url, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`
  ).run(id, claimToken, feedUrl, feedTitle || null, feedDescription || null, feedImageUrl || null, expiration);

  const row = database.prepare('SELECT * FROM rss_gifts WHERE id = ?').get(id);
  return rowToObject<RssGift>(row as Record<string, unknown>);
}

export async function getRssGift(id: string): Promise<RssGift | undefined> {
  await ensureRssGiftTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM rss_gifts WHERE id = ?').get(id);
  if (!row) return undefined;
  return rowToObject<RssGift>(row as Record<string, unknown>);
}

export async function getRssGiftByToken(claimToken: string): Promise<RssGift | undefined> {
  await ensureRssGiftTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM rss_gifts WHERE claim_token = ?').get(claimToken);
  if (!row) return undefined;
  return rowToObject<RssGift>(row as Record<string, unknown>);
}

export async function markRssGiftClaimed(id: string): Promise<void> {
  const database = getDb();
  database.prepare(
    `UPDATE rss_gifts SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?`
  ).run(id);
}

export async function createRssGiftArticle(
  rssGiftId: string,
  title: string,
  contentMarkdown: string,
  summary?: string,
  publishedAt?: string,
  link?: string,
  imageUrl?: string,
  blossomImageUrl?: string,
  hashtags?: string[]
): Promise<RssGiftArticle> {
  await ensureRssGiftTables();
  const database = getDb();

  database.prepare(
    `INSERT INTO rss_gift_articles (rss_gift_id, title, summary, content_markdown, published_at, link, image_url, blossom_image_url, hashtags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`
  ).run(
    rssGiftId,
    title,
    summary || null,
    contentMarkdown,
    publishedAt || null,
    link || null,
    imageUrl || null,
    blossomImageUrl || null,
    hashtags ? JSON.stringify(hashtags) : null
  );

  // Get the last inserted article
  const row = database.prepare(
    'SELECT * FROM rss_gift_articles WHERE rss_gift_id = ? ORDER BY id DESC LIMIT 1'
  ).get(rssGiftId);
  return rowToObject<RssGiftArticle>(row as Record<string, unknown>);
}

export async function getRssGiftArticles(rssGiftId: string): Promise<RssGiftArticle[]> {
  await ensureRssGiftTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM rss_gift_articles WHERE rss_gift_id = ? ORDER BY id'
  ).all(rssGiftId);
  return rows.map(row => rowToObject<RssGiftArticle>(row as Record<string, unknown>));
}

export async function updateRssGiftArticleStatus(
  articleId: number,
  status: RssGiftArticle['status']
): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE rss_gift_articles SET status = ? WHERE id = ?').run(status, articleId);
}

export async function getRssGiftByTokenWithArticles(claimToken: string): Promise<{ gift: RssGift; articles: RssGiftArticle[] } | null> {
  const gift = await getRssGiftByToken(claimToken);
  if (!gift) return null;

  const articles = await getRssGiftArticles(gift.id);
  return { gift, articles };
}

// ============================================
// Migration functions for client-side signing flow
// ============================================

export interface Migration {
  id: string;
  source_handle: string;
  source_type: 'instagram' | 'tiktok' | 'rss' | 'twitter';
  profile_data: string | null;  // JSON string
  status: 'pending' | 'processing' | 'ready' | 'complete';
  created_at: string;
  updated_at: string;
}

export interface MigrationPost {
  id: number;
  migration_id: string;
  post_type: 'reel' | 'image' | 'carousel' | 'video' | 'text';
  caption: string | null;
  original_date: string | null;
  media_items: string;  // JSON string
  blossom_urls: string | null;  // JSON string
  thumbnail_url: string | null;
  status: 'pending' | 'uploading' | 'ready' | 'published';
  created_at: string;
}

export interface MigrationArticle {
  id: number;
  migration_id: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  published_at: string | null;
  link: string | null;
  image_url: string | null;
  blossom_image_url: string | null;
  hashtags: string | null;  // JSON string
  inline_image_urls: string | null;  // JSON mapping
  upload_attempts: number;
  status: 'pending' | 'uploading' | 'ready' | 'published';
  created_at: string;
}

export async function ensureMigrationTables(): Promise<void> {
  const database = getDb();

  // Check if migrations table exists
  const tableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
  ).get();

  if (!tableExists) {
    // Create migrations tables
    database.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        source_handle TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('instagram', 'tiktok', 'rss', 'twitter')),
        profile_data TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'complete')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS migration_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_id TEXT NOT NULL,
        post_type TEXT NOT NULL CHECK (post_type IN ('reel', 'image', 'carousel', 'video', 'text')),
        caption TEXT,
        original_date TEXT,
        media_items TEXT NOT NULL,
        blossom_urls TEXT,
        thumbnail_url TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS migration_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        content_markdown TEXT NOT NULL,
        published_at TEXT,
        link TEXT,
        image_url TEXT,
        blossom_image_url TEXT,
        hashtags TEXT,
        inline_image_urls TEXT,
        upload_attempts INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'ready', 'published')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
      )
    `);

    database.exec('CREATE INDEX IF NOT EXISTS idx_migrations_status ON migrations(status)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_migration_posts_migration_id ON migration_posts(migration_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_migration_articles_migration_id ON migration_articles(migration_id)');
  }
}

export interface MigrationPostInput {
  postType: 'reel' | 'image' | 'carousel' | 'video' | 'text';
  mediaItems: string;  // JSON string
  caption?: string;
  originalDate?: string;
  thumbnailUrl?: string;
}

export interface MigrationArticleInput {
  title: string;
  contentMarkdown: string;
  summary?: string;
  publishedAt?: string;
  link?: string;
  imageUrl?: string;
  hashtags?: string[];
}

export async function createMigrationWithContent(
  id: string,
  sourceHandle: string,
  sourceType: 'instagram' | 'tiktok' | 'rss' | 'twitter',
  profileData: string | undefined,
  posts: MigrationPostInput[],
  articles: MigrationArticleInput[]
): Promise<Migration> {
  await ensureMigrationTables();
  const database = getDb();

  // Use a transaction for atomic creation
  const transaction = database.transaction(() => {
    // Create the migration
    database.prepare(
      `INSERT INTO migrations (id, source_handle, source_type, profile_data)
       VALUES (?, ?, ?, ?)`
    ).run(id, sourceHandle, sourceType, profileData || null);

    // Create all posts
    const insertPost = database.prepare(
      `INSERT INTO migration_posts (migration_id, post_type, media_items, caption, original_date, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const post of posts) {
      insertPost.run(id, post.postType, post.mediaItems, post.caption || null, post.originalDate || null, post.thumbnailUrl || null);
    }

    // Create all articles
    const insertArticle = database.prepare(
      `INSERT INTO migration_articles (migration_id, title, summary, content_markdown, published_at, link, image_url, hashtags, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );
    for (const article of articles) {
      insertArticle.run(
        id,
        article.title,
        article.summary || null,
        article.contentMarkdown,
        article.publishedAt || null,
        article.link || null,
        article.imageUrl || null,
        article.hashtags ? JSON.stringify(article.hashtags) : null
      );
    }

    // Return the migration we just created
    return database.prepare('SELECT * FROM migrations WHERE id = ?').get(id);
  });

  const row = transaction();
  return rowToObject<Migration>(row as Record<string, unknown>);
}

export async function getMigration(id: string): Promise<Migration | undefined> {
  await ensureMigrationTables();
  const database = getDb();
  const row = database.prepare('SELECT * FROM migrations WHERE id = ?').get(id);
  if (!row) return undefined;
  return rowToObject<Migration>(row as Record<string, unknown>);
}

export async function getMigrationPosts(migrationId: string): Promise<MigrationPost[]> {
  await ensureMigrationTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM migration_posts WHERE migration_id = ? ORDER BY id'
  ).all(migrationId);
  return rows.map(row => rowToObject<MigrationPost>(row as Record<string, unknown>));
}

export async function getMigrationArticles(migrationId: string): Promise<MigrationArticle[]> {
  await ensureMigrationTables();
  const database = getDb();
  const rows = database.prepare(
    'SELECT * FROM migration_articles WHERE migration_id = ? ORDER BY id'
  ).all(migrationId);
  return rows.map(row => rowToObject<MigrationArticle>(row as Record<string, unknown>));
}

export async function getMigrationWithContent(migrationId: string): Promise<{
  migration: Migration;
  posts: MigrationPost[];
  articles: MigrationArticle[];
} | null> {
  const migration = await getMigration(migrationId);
  if (!migration) return null;

  const posts = await getMigrationPosts(migrationId);
  const articles = await getMigrationArticles(migrationId);
  return { migration, posts, articles };
}

export async function updateMigrationStatus(id: string, status: Migration['status']): Promise<void> {
  const database = getDb();
  database.prepare(
    "UPDATE migrations SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

export async function updateMigrationPostStatus(
  postId: number,
  status: MigrationPost['status']
): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE migration_posts SET status = ? WHERE id = ?').run(status, postId);
}

export async function updateMigrationArticleStatus(
  articleId: number,
  status: MigrationArticle['status']
): Promise<void> {
  const database = getDb();
  database.prepare('UPDATE migration_articles SET status = ? WHERE id = ?').run(status, articleId);
}
