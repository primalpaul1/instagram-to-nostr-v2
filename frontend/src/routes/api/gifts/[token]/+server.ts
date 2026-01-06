import { json } from '@sveltejs/kit';
import {
  getGiftByTokenWithPosts,
  markGiftClaimed,
  updateGiftPostStatus
} from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { token } = params;

    const result = await getGiftByTokenWithPosts(token);
    if (!result) {
      return json({ error: 'Gift not found' }, { status: 404 });
    }

    const { gift, posts } = result;

    // Check if expired
    const expiresAt = new Date(gift.expires_at);
    if (expiresAt < new Date() && gift.status !== 'claimed') {
      return json({ error: 'This gift has expired' }, { status: 410 });
    }

    // Parse profile data
    let profile = null;
    if (gift.profile_data) {
      try {
        profile = JSON.parse(gift.profile_data);
      } catch {
        // Ignore parse errors
      }
    }

    // Format posts for response
    const formattedPosts = posts.map(post => {
      let mediaItems = [];
      let blossomUrls = [];

      try {
        mediaItems = JSON.parse(post.media_items);
      } catch {
        // Ignore parse errors
      }

      if (post.blossom_urls) {
        try {
          blossomUrls = JSON.parse(post.blossom_urls);
        } catch {
          // Ignore parse errors
        }
      }

      return {
        id: post.id,
        post_type: post.post_type,
        caption: post.caption,
        original_date: post.original_date,
        thumbnail_url: post.thumbnail_url,
        media_items: mediaItems,
        blossom_urls: blossomUrls,
        status: post.status
      };
    });

    return json({
      status: gift.status,
      handle: gift.ig_handle,
      profile,
      posts: formattedPosts,
      createdAt: gift.created_at,
      expiresAt: gift.expires_at
    });
  } catch (err) {
    console.error('Error fetching gift:', err);
    return json({ error: 'Failed to fetch gift' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { token } = params;
    const body = await request.json();
    const { action, postId, postIds } = body;

    const result = await getGiftByTokenWithPosts(token);
    if (!result) {
      return json({ error: 'Gift not found' }, { status: 404 });
    }

    const { gift } = result;

    // Check if expired
    const expiresAt = new Date(gift.expires_at);
    if (expiresAt < new Date() && gift.status !== 'claimed') {
      return json({ error: 'This gift has expired' }, { status: 410 });
    }

    if (action === 'complete') {
      // Mark gift as claimed
      if (gift.status === 'claimed') {
        return json({ error: 'Gift already claimed' }, { status: 400 });
      }

      await markGiftClaimed(gift.id);
      return json({ success: true });
    }

    if (action === 'markPostPublished') {
      // Mark a specific post as published
      if (!postId) {
        return json({ error: 'Missing postId' }, { status: 400 });
      }

      await updateGiftPostStatus(postId, 'published');
      return json({ success: true });
    }

    if (action === 'markPostsPublished') {
      // Batch mark multiple posts as published
      if (!postIds || !Array.isArray(postIds)) {
        return json({ error: 'Missing postIds array' }, { status: 400 });
      }

      // Mark all posts as published
      for (const id of postIds) {
        await updateGiftPostStatus(id, 'published');
      }
      return json({ success: true, count: postIds.length });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Error processing gift action:', err);
    return json({ error: 'Failed to process action' }, { status: 500 });
  }
};
