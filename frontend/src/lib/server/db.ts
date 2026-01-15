import initSqlJs, { type Database } from 'sql.js';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

const DATABASE_PATH = env.DATABASE_PATH || '/data/instagram.db';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getDb(): Promise<Database> {
  // Initialize sql.js once
  if (!SQL) {
    SQL = await initSqlJs();
  }

  // Ensure data directory exists
  const dataDir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Always read fresh from disk to see worker updates
  let db: Database;
  if (fs.existsSync(DATABASE_PATH)) {
    const buffer = fs.readFileSync(DATABASE_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    // Initialize schema for new database
    const schemaPath = path.join(process.cwd(), 'schema.sql');
    const parentSchemaPath = path.join(process.cwd(), '..', 'schema.sql');

    let schema = '';
    if (fs.existsSync(schemaPath)) {
      schema = fs.readFileSync(schemaPath, 'utf-8');
    } else if (fs.existsSync(parentSchemaPath)) {
      schema = fs.readFileSync(parentSchemaPath, 'utf-8');
    }

    if (schema) {
      db.run(schema);
      const data = db.export();
      fs.writeFileSync(DATABASE_PATH, Buffer.from(data));
    }
  }

  return db;
}

function saveDb(db: Database): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DATABASE_PATH, buffer);
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

function rowToObject<T>(columns: string[], values: any[]): T {
  const obj: any = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });
  return obj as T;
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
  const database = await getDb();
  database.run(
    `INSERT INTO jobs (id, handle, public_key_hex, secret_key_hex, status, profile_name, profile_bio, profile_picture_url)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, handle, publicKeyHex, secretKeyHex, profileName || null, profileBio || null, profilePictureUrl || null]
  );
  saveDb(database);
  return (await getJob(id))!;
}

export async function getJob(id: string): Promise<Job | undefined> {
  const database = await getDb();
  const result = database.exec('SELECT * FROM jobs WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<Job>(result[0].columns, result[0].values[0]);
}

export async function updateJobStatus(id: string, status: Job['status']): Promise<void> {
  const database = await getDb();
  database.run(
    `UPDATE jobs SET status = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [status, id]
  );
  saveDb(database);
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
  const database = await getDb();
  database.run(
    `INSERT INTO video_tasks (
      id, job_id, instagram_url, filename, caption, original_date,
      width, height, duration, thumbnail_url, post_type, media_items, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
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
    ]
  );
  saveDb(database);
  return (await getVideoTask(id))!;
}

export async function getVideoTask(id: string): Promise<VideoTask | undefined> {
  const database = await getDb();
  const result = database.exec('SELECT * FROM video_tasks WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<VideoTask>(result[0].columns, result[0].values[0]);
}

export async function getVideoTasksByJobId(jobId: string): Promise<VideoTask[]> {
  const database = await getDb();
  const result = database.exec(
    'SELECT * FROM video_tasks WHERE job_id = ? ORDER BY created_at',
    [jobId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<VideoTask>(result[0].columns, row));
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
  const database = await getDb();

  // Check if proposals table exists
  const result = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='proposals'"
  );

  if (result.length === 0 || result[0].values.length === 0) {
    // Create proposals tables
    database.run(`
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

    database.run(`
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

    database.run(`
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

    database.run('CREATE INDEX IF NOT EXISTS idx_proposals_claim_token ON proposals(claim_token)');
    database.run('CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)');
    database.run('CREATE INDEX IF NOT EXISTS idx_proposals_expires_at ON proposals(expires_at)');
    database.run('CREATE INDEX IF NOT EXISTS idx_proposal_posts_proposal_id ON proposal_posts(proposal_id)');
    database.run('CREATE INDEX IF NOT EXISTS idx_proposal_articles_proposal_id ON proposal_articles(proposal_id)');

    saveDb(database);
  } else {
    // Table exists, check if proposal_type column exists
    const colCheck = database.exec("PRAGMA table_info(proposals)");
    const columns = colCheck.length > 0 ? colCheck[0].values.map(row => row[1]) : [];

    if (!columns.includes('proposal_type')) {
      database.run("ALTER TABLE proposals ADD COLUMN proposal_type TEXT DEFAULT 'posts' CHECK (proposal_type IN ('posts', 'articles', 'combined'))");
      saveDb(database);
    }

    // Check if proposal_articles table exists
    const articlesCheck = database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='proposal_articles'"
    );

    if (articlesCheck.length === 0 || articlesCheck[0].values.length === 0) {
      database.run(`
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
      database.run('CREATE INDEX IF NOT EXISTS idx_proposal_articles_proposal_id ON proposal_articles(proposal_id)');
      saveDb(database);
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
  const database = await getDb();

  // Default expiration: 30 days from now
  const expiration = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  database.run(
    `INSERT INTO proposals (id, claim_token, target_npub, target_pubkey_hex, ig_handle, profile_data, proposal_type, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, claimToken, targetNpub, targetPubkeyHex, igHandle, profileData || null, proposalType, expiration]
  );
  saveDb(database);
  return (await getProposal(id))!;
}

export async function getProposal(id: string): Promise<Proposal | undefined> {
  await ensureProposalTables();
  const database = await getDb();
  const result = database.exec('SELECT * FROM proposals WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<Proposal>(result[0].columns, result[0].values[0]);
}

export async function getProposalByToken(claimToken: string): Promise<Proposal | undefined> {
  await ensureProposalTables();
  const database = await getDb();
  const result = database.exec('SELECT * FROM proposals WHERE claim_token = ?', [claimToken]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<Proposal>(result[0].columns, result[0].values[0]);
}

export async function updateProposalStatus(id: string, status: Proposal['status']): Promise<void> {
  const database = await getDb();
  database.run('UPDATE proposals SET status = ? WHERE id = ?', [status, id]);
  saveDb(database);
}

export async function markProposalClaimed(id: string): Promise<void> {
  const database = await getDb();
  database.run(
    `UPDATE proposals SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?`,
    [id]
  );
  saveDb(database);
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
  const database = await getDb();

  database.run(
    `INSERT INTO proposal_posts (proposal_id, post_type, media_items, caption, original_date, thumbnail_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [proposalId, postType, mediaItems, caption || null, originalDate || null, thumbnailUrl || null]
  );
  saveDb(database);

  // Get the last inserted post
  const result = database.exec(
    'SELECT * FROM proposal_posts WHERE proposal_id = ? ORDER BY id DESC LIMIT 1',
    [proposalId]
  );
  return rowToObject<ProposalPost>(result[0].columns, result[0].values[0]);
}

export async function getProposalPosts(proposalId: string): Promise<ProposalPost[]> {
  await ensureProposalTables();
  const database = await getDb();
  const result = database.exec(
    'SELECT * FROM proposal_posts WHERE proposal_id = ? ORDER BY id',
    [proposalId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<ProposalPost>(result[0].columns, row));
}

export async function updateProposalPostStatus(
  postId: number,
  status: ProposalPost['status'],
  blossomUrls?: string
): Promise<void> {
  const database = await getDb();
  if (blossomUrls) {
    database.run(
      'UPDATE proposal_posts SET status = ?, blossom_urls = ? WHERE id = ?',
      [status, blossomUrls, postId]
    );
  } else {
    database.run('UPDATE proposal_posts SET status = ? WHERE id = ?', [status, postId]);
  }
  saveDb(database);
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
  const database = await getDb();

  database.run(
    `INSERT INTO proposal_articles (proposal_id, title, summary, content_markdown, published_at, link, image_url, hashtags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      proposalId,
      title,
      summary || null,
      contentMarkdown,
      publishedAt || null,
      link || null,
      imageUrl || null,
      hashtags ? JSON.stringify(hashtags) : null
    ]
  );
  saveDb(database);

  // Get the last inserted article
  const result = database.exec(
    'SELECT * FROM proposal_articles WHERE proposal_id = ? ORDER BY id DESC LIMIT 1',
    [proposalId]
  );
  return rowToObject<ProposalArticle>(result[0].columns, result[0].values[0]);
}

export async function getProposalArticles(proposalId: string): Promise<ProposalArticle[]> {
  await ensureProposalTables();
  const database = await getDb();
  const result = database.exec(
    'SELECT * FROM proposal_articles WHERE proposal_id = ? ORDER BY id',
    [proposalId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<ProposalArticle>(result[0].columns, row));
}

export async function updateProposalArticleStatus(
  articleId: number,
  status: ProposalArticle['status']
): Promise<void> {
  const database = await getDb();
  database.run('UPDATE proposal_articles SET status = ? WHERE id = ?', [status, articleId]);
  saveDb(database);
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

export async function getPendingProposals(): Promise<Proposal[]> {
  await ensureProposalTables();
  const database = await getDb();
  const result = database.exec(
    "SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at"
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<Proposal>(result[0].columns, row));
}

export async function cleanupExpiredProposals(): Promise<number> {
  await ensureProposalTables();
  const database = await getDb();

  // Get count of expired proposals
  const countResult = database.exec(
    "SELECT COUNT(*) as count FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'"
  );
  const count = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

  if (count > 0) {
    // Delete proposal posts first (foreign key)
    database.run(`
      DELETE FROM proposal_posts
      WHERE proposal_id IN (
        SELECT id FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'
      )
    `);

    // Delete expired proposals
    database.run("DELETE FROM proposals WHERE expires_at < datetime('now') AND status != 'claimed'");
    saveDb(database);
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
  status: 'pending' | 'processing' | 'ready' | 'claimed' | 'expired';
  claimed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface GiftPost {
  id: number;
  gift_id: string;
  post_type: 'reel' | 'image' | 'carousel';
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
  const database = await getDb();

  // Check if gifts table exists
  const result = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='gifts'"
  );

  if (result.length === 0 || result[0].values.length === 0) {
    // Create gifts tables
    database.run(`
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

    database.run(`
      CREATE TABLE IF NOT EXISTS gift_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gift_id TEXT NOT NULL,
        post_type TEXT NOT NULL CHECK (post_type IN ('reel', 'image', 'carousel')),
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

    database.run(`
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

    database.run('CREATE INDEX IF NOT EXISTS idx_gifts_claim_token ON gifts(claim_token)');
    database.run('CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status)');
    database.run('CREATE INDEX IF NOT EXISTS idx_gifts_expires_at ON gifts(expires_at)');
    database.run('CREATE INDEX IF NOT EXISTS idx_gift_posts_gift_id ON gift_posts(gift_id)');
    database.run('CREATE INDEX IF NOT EXISTS idx_gift_articles_gift_id ON gift_articles(gift_id)');

    saveDb(database);
  } else {
    // Table exists, check if gift_type column exists
    const colCheck = database.exec("PRAGMA table_info(gifts)");
    const columns = colCheck.length > 0 ? colCheck[0].values.map(row => row[1]) : [];

    if (!columns.includes('gift_type')) {
      database.run("ALTER TABLE gifts ADD COLUMN gift_type TEXT DEFAULT 'posts' CHECK (gift_type IN ('posts', 'articles', 'combined'))");
      saveDb(database);
    }

    // Check if gift_articles table exists
    const articlesCheck = database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gift_articles'"
    );

    if (articlesCheck.length === 0 || articlesCheck[0].values.length === 0) {
      database.run(`
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
      database.run('CREATE INDEX IF NOT EXISTS idx_gift_articles_gift_id ON gift_articles(gift_id)');
      saveDb(database);
    } else {
      // Check if inline_image_urls column exists in gift_articles
      const articleColCheck = database.exec("PRAGMA table_info(gift_articles)");
      const articleColumns = articleColCheck.length > 0 ? articleColCheck[0].values.map(row => row[1]) : [];

      if (!articleColumns.includes('inline_image_urls')) {
        database.run("ALTER TABLE gift_articles ADD COLUMN inline_image_urls TEXT");
        saveDb(database);
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
  const database = await getDb();

  // Default expiration: 30 days from now
  const expiration = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  database.run(
    `INSERT INTO gifts (id, claim_token, ig_handle, salt, profile_data, gift_type, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, claimToken, igHandle, '', profileData || null, giftType, expiration]
  );
  saveDb(database);
  return (await getGift(id))!;
}

export async function getGift(id: string): Promise<Gift | undefined> {
  await ensureGiftTables();
  const database = await getDb();
  const result = database.exec('SELECT * FROM gifts WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<Gift>(result[0].columns, result[0].values[0]);
}

export async function getGiftByToken(claimToken: string): Promise<Gift | undefined> {
  await ensureGiftTables();
  const database = await getDb();
  const result = database.exec('SELECT * FROM gifts WHERE claim_token = ?', [claimToken]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<Gift>(result[0].columns, result[0].values[0]);
}

export async function updateGiftStatus(id: string, status: Gift['status']): Promise<void> {
  const database = await getDb();
  database.run('UPDATE gifts SET status = ? WHERE id = ?', [status, id]);
  saveDb(database);
}

export async function markGiftClaimed(id: string): Promise<void> {
  const database = await getDb();
  database.run(
    `UPDATE gifts SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?`,
    [id]
  );
  saveDb(database);
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
  const database = await getDb();

  database.run(
    `INSERT INTO gift_posts (gift_id, post_type, media_items, caption, original_date, thumbnail_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [giftId, postType, mediaItems, caption || null, originalDate || null, thumbnailUrl || null]
  );
  saveDb(database);

  // Get the last inserted post
  const result = database.exec(
    'SELECT * FROM gift_posts WHERE gift_id = ? ORDER BY id DESC LIMIT 1',
    [giftId]
  );
  return rowToObject<GiftPost>(result[0].columns, result[0].values[0]);
}

export async function getGiftPosts(giftId: string): Promise<GiftPost[]> {
  await ensureGiftTables();
  const database = await getDb();
  const result = database.exec(
    'SELECT * FROM gift_posts WHERE gift_id = ? ORDER BY id',
    [giftId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<GiftPost>(result[0].columns, row));
}

export async function updateGiftPostStatus(
  postId: number,
  status: GiftPost['status'],
  blossomUrls?: string
): Promise<void> {
  const database = await getDb();
  if (blossomUrls) {
    database.run(
      'UPDATE gift_posts SET status = ?, blossom_urls = ? WHERE id = ?',
      [status, blossomUrls, postId]
    );
  } else {
    database.run('UPDATE gift_posts SET status = ? WHERE id = ?', [status, postId]);
  }
  saveDb(database);
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
  const database = await getDb();

  database.run(
    `INSERT INTO gift_articles (gift_id, title, summary, content_markdown, published_at, link, image_url, blossom_image_url, hashtags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      giftId,
      title,
      summary || null,
      contentMarkdown,
      publishedAt || null,
      link || null,
      imageUrl || null,
      blossomImageUrl || null,
      hashtags ? JSON.stringify(hashtags) : null
    ]
  );
  saveDb(database);

  // Get the last inserted article
  const result = database.exec(
    'SELECT * FROM gift_articles WHERE gift_id = ? ORDER BY id DESC LIMIT 1',
    [giftId]
  );
  return rowToObject<GiftArticle>(result[0].columns, result[0].values[0]);
}

export async function getGiftArticles(giftId: string): Promise<GiftArticle[]> {
  await ensureGiftTables();
  const database = await getDb();
  const result = database.exec(
    'SELECT * FROM gift_articles WHERE gift_id = ? ORDER BY id',
    [giftId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<GiftArticle>(result[0].columns, row));
}

export async function updateGiftArticleStatus(
  articleId: number,
  status: GiftArticle['status']
): Promise<void> {
  const database = await getDb();
  database.run('UPDATE gift_articles SET status = ? WHERE id = ?', [status, articleId]);
  saveDb(database);
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
  const database = await getDb();
  const result = database.exec(
    "SELECT * FROM gifts WHERE status = 'pending' ORDER BY created_at"
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<Gift>(result[0].columns, row));
}

export async function cleanupExpiredGifts(): Promise<number> {
  await ensureGiftTables();
  const database = await getDb();

  // Get count of expired gifts
  const countResult = database.exec(
    "SELECT COUNT(*) as count FROM gifts WHERE expires_at < datetime('now') AND status != 'claimed'"
  );
  const count = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

  if (count > 0) {
    // Delete gift posts first (foreign key)
    database.run(`
      DELETE FROM gift_posts
      WHERE gift_id IN (
        SELECT id FROM gifts WHERE expires_at < datetime('now') AND status != 'claimed'
      )
    `);

    // Delete expired gifts
    database.run("DELETE FROM gifts WHERE expires_at < datetime('now') AND status != 'claimed'");
    saveDb(database);
  }

  return count;
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
  const database = await getDb();

  // Check if rss_gifts table exists
  const result = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='rss_gifts'"
  );

  if (result.length === 0 || result[0].values.length === 0) {
    // Create rss_gifts tables
    database.run(`
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

    database.run(`
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

    database.run('CREATE INDEX IF NOT EXISTS idx_rss_gifts_claim_token ON rss_gifts(claim_token)');
    database.run('CREATE INDEX IF NOT EXISTS idx_rss_gifts_status ON rss_gifts(status)');
    database.run('CREATE INDEX IF NOT EXISTS idx_rss_gift_articles_rss_gift_id ON rss_gift_articles(rss_gift_id)');

    saveDb(database);
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
  const database = await getDb();

  // Default expiration: 30 days from now
  const expiration = expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  database.run(
    `INSERT INTO rss_gifts (id, claim_token, feed_url, feed_title, feed_description, feed_image_url, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
    [id, claimToken, feedUrl, feedTitle || null, feedDescription || null, feedImageUrl || null, expiration]
  );
  saveDb(database);
  return (await getRssGift(id))!;
}

export async function getRssGift(id: string): Promise<RssGift | undefined> {
  await ensureRssGiftTables();
  const database = await getDb();
  const result = database.exec('SELECT * FROM rss_gifts WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<RssGift>(result[0].columns, result[0].values[0]);
}

export async function getRssGiftByToken(claimToken: string): Promise<RssGift | undefined> {
  await ensureRssGiftTables();
  const database = await getDb();
  const result = database.exec('SELECT * FROM rss_gifts WHERE claim_token = ?', [claimToken]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  return rowToObject<RssGift>(result[0].columns, result[0].values[0]);
}

export async function markRssGiftClaimed(id: string): Promise<void> {
  const database = await getDb();
  database.run(
    `UPDATE rss_gifts SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?`,
    [id]
  );
  saveDb(database);
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
  const database = await getDb();

  database.run(
    `INSERT INTO rss_gift_articles (rss_gift_id, title, summary, content_markdown, published_at, link, image_url, blossom_image_url, hashtags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    [
      rssGiftId,
      title,
      summary || null,
      contentMarkdown,
      publishedAt || null,
      link || null,
      imageUrl || null,
      blossomImageUrl || null,
      hashtags ? JSON.stringify(hashtags) : null
    ]
  );
  saveDb(database);

  // Get the last inserted article
  const result = database.exec(
    'SELECT * FROM rss_gift_articles WHERE rss_gift_id = ? ORDER BY id DESC LIMIT 1',
    [rssGiftId]
  );
  return rowToObject<RssGiftArticle>(result[0].columns, result[0].values[0]);
}

export async function getRssGiftArticles(rssGiftId: string): Promise<RssGiftArticle[]> {
  await ensureRssGiftTables();
  const database = await getDb();
  const result = database.exec(
    'SELECT * FROM rss_gift_articles WHERE rss_gift_id = ? ORDER BY id',
    [rssGiftId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(row => rowToObject<RssGiftArticle>(result[0].columns, row));
}

export async function updateRssGiftArticleStatus(
  articleId: number,
  status: RssGiftArticle['status']
): Promise<void> {
  const database = await getDb();
  database.run('UPDATE rss_gift_articles SET status = ? WHERE id = ?', [status, articleId]);
  saveDb(database);
}

export async function getRssGiftByTokenWithArticles(claimToken: string): Promise<{ gift: RssGift; articles: RssGiftArticle[] } | null> {
  const gift = await getRssGiftByToken(claimToken);
  if (!gift) return null;

  const articles = await getRssGiftArticles(gift.id);
  return { gift, articles };
}
