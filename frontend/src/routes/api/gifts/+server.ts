import { json } from '@sveltejs/kit';
import { createGift, createGiftPost } from '$lib/server/db';
import type { RequestHandler } from './$types';

function generateId(): string {
  return crypto.randomUUID();
}

function generateClaimToken(): string {
  // Generate a short, URL-safe token
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16);
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

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { handle, posts, profile } = body as {
      handle: string;
      posts: PostInput[];
      profile?: ProfileInput;
    };

    if (!handle || !posts?.length) {
      return json(
        { message: 'Missing required fields: handle and posts are required' },
        { status: 400 }
      );
    }

    // Create the gift
    const giftId = generateId();
    const claimToken = generateClaimToken();
    const profileData = profile ? JSON.stringify(profile) : undefined;

    await createGift(
      giftId,
      claimToken,
      handle,
      profileData
    );

    // Create gift posts
    for (const post of posts) {
      await createGiftPost(
        giftId,
        post.post_type,
        JSON.stringify(post.media_items),
        post.caption,
        post.original_date,
        post.thumbnail_url
      );
    }

    // Build the claim URL
    const baseUrl = url.origin || 'https://instatoprimal.com';
    const claimUrl = `${baseUrl}/gift-claim/${claimToken}`;

    return json({
      giftId,
      claimToken,
      claimUrl
    });
  } catch (err) {
    console.error('Error creating gift:', err);
    return json(
      { message: 'Failed to create gift' },
      { status: 500 }
    );
  }
};
