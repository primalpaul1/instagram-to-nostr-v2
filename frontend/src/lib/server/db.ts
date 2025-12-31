import initSqlJs, { type Database } from 'sql.js';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

const DATABASE_PATH = env.DATABASE_PATH || '/data/instagram.db';

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();

  // Ensure data directory exists
  const dataDir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing database or create new one
  if (fs.existsSync(DATABASE_PATH)) {
    const buffer = fs.readFileSync(DATABASE_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize schema
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
    saveDb();
  }

  return db;
}

function saveDb(): void {
  if (!db) return;
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
  status: 'pending' | 'uploading' | 'publishing' | 'complete' | 'error';
  blossom_url: string | null;
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
  secretKeyHex: string
): Promise<Job> {
  const database = await getDb();
  database.run(
    `INSERT INTO jobs (id, handle, public_key_hex, secret_key_hex, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [id, handle, publicKeyHex, secretKeyHex]
  );
  saveDb();
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
  saveDb();
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
  thumbnailUrl?: string
): Promise<VideoTask> {
  const database = await getDb();
  database.run(
    `INSERT INTO video_tasks (
      id, job_id, instagram_url, filename, caption, original_date,
      width, height, duration, thumbnail_url, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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
      thumbnailUrl || null
    ]
  );
  saveDb();
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
