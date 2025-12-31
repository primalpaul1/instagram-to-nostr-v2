import { json } from '@sveltejs/kit';
import { createJob, createVideoTask } from '$lib/server/db';
import type { RequestHandler } from './$types';

function generateId(): string {
  return crypto.randomUUID();
}

interface VideoInput {
  url: string;
  filename?: string;
  caption?: string;
  original_date?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { handle, publicKey, secretKey, videos } = body as {
      handle: string;
      publicKey: string;
      secretKey: string;
      videos: VideoInput[];
    };

    if (!handle || !publicKey || !secretKey || !videos?.length) {
      return json(
        { message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create job
    const jobId = generateId();
    await createJob(jobId, handle, publicKey, secretKey);

    // Create video tasks
    for (const video of videos) {
      const taskId = generateId();
      await createVideoTask(
        taskId,
        jobId,
        video.url,
        video.filename,
        video.caption,
        video.original_date,
        video.width,
        video.height,
        video.duration,
        video.thumbnail_url
      );
    }

    return json({ jobId });
  } catch (err) {
    console.error('Error creating job:', err);
    return json(
      { message: 'Failed to create job' },
      { status: 500 }
    );
  }
};
