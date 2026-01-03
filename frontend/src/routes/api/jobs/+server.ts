import { json } from '@sveltejs/kit';
import { createJob, createVideoTask } from '$lib/server/db';
import type { RequestHandler } from './$types';

function generateId(): string {
  return crypto.randomUUID();
}

interface MediaItemInput {
  url: string;
  media_type: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url?: string;
}

interface PostInput {
  id: string;
  post_type: 'reel' | 'image' | 'carousel';
  caption?: string;
  original_date?: string;
  thumbnail_url?: string;
  media_items: MediaItemInput[];
}

interface ProfileInput {
  username?: string;
  display_name?: string;
  bio?: string;
  profile_picture_url?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { handle, publicKey, secretKey, posts, profile } = body as {
      handle: string;
      publicKey: string;
      secretKey: string;
      posts: PostInput[];
      profile?: ProfileInput;
    };

    if (!handle || !publicKey || !secretKey || !posts?.length) {
      return json(
        { message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create job with profile data
    const jobId = generateId();
    await createJob(
      jobId,
      handle,
      publicKey,
      secretKey,
      profile?.display_name || profile?.username || handle,
      profile?.bio,
      profile?.profile_picture_url
    );

    // Create post tasks
    for (const post of posts) {
      const taskId = generateId();
      // Get first media item for primary URL (for reels/images) or use first item for carousel
      const primaryMedia = post.media_items[0];

      await createVideoTask(
        taskId,
        jobId,
        primaryMedia?.url || '',
        undefined,  // filename
        post.caption,
        post.original_date,
        primaryMedia?.width,
        primaryMedia?.height,
        primaryMedia?.duration,
        post.thumbnail_url,
        post.post_type,
        JSON.stringify(post.media_items)
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
