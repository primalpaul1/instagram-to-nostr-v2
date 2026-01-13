import { json } from '@sveltejs/kit';
import { createGift, createGiftPost, createGiftArticle } from '$lib/server/db';
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

interface ArticleInput {
  title: string;
  summary?: string;
  content_markdown: string;
  published_at?: string;
  link?: string;
  image_url?: string;
  blossom_image_url?: string;
  hashtags?: string[];
}

interface ProfileInput {
  username?: string;
  display_name?: string;
  bio?: string;
  profile_picture_url?: string;
}

interface FeedInput {
  url: string;
  title?: string;
  description?: string;
  image_url?: string;
}

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { handle, posts, profile, gift_type, articles, feed } = body as {
      handle: string;
      posts?: PostInput[];
      profile?: ProfileInput;
      gift_type?: 'posts' | 'articles';
      articles?: ArticleInput[];
      feed?: FeedInput;
    };

    const giftType = gift_type || 'posts';

    // Validate based on gift type
    if (giftType === 'posts') {
      if (!handle || !posts?.length) {
        return json(
          { message: 'Missing required fields: handle and posts are required' },
          { status: 400 }
        );
      }
    } else if (giftType === 'articles') {
      if (!articles?.length) {
        return json(
          { message: 'Missing required fields: articles are required' },
          { status: 400 }
        );
      }
    }

    // Create the gift
    const giftId = generateId();
    const claimToken = generateClaimToken();

    // For articles, store feed info in profile_data; for posts, store profile
    let profileData: string | undefined;
    if (giftType === 'articles' && feed) {
      profileData = JSON.stringify(feed);
    } else if (profile) {
      profileData = JSON.stringify(profile);
    }

    // Use feed URL as handle for articles, otherwise use the provided handle
    const giftHandle = giftType === 'articles' ? (feed?.url || 'RSS Feed') : handle;

    const gift = await createGift(
      giftId,
      claimToken,
      giftHandle,
      profileData,
      undefined, // expiresAt - use default
      giftType
    );

    // For article gifts, mark as ready immediately (no media processing needed)
    if (giftType === 'articles') {
      const { updateGiftStatus } = await import('$lib/server/db');
      await updateGiftStatus(giftId, 'ready');
    }

    // Create gift posts or articles based on type
    if (giftType === 'posts' && posts) {
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
    } else if (giftType === 'articles' && articles) {
      for (const article of articles) {
        await createGiftArticle(
          giftId,
          article.title,
          article.content_markdown,
          article.summary,
          article.published_at,
          article.link,
          article.image_url,
          article.blossom_image_url,
          article.hashtags
        );
      }
    }

    // Build the claim URL
    const baseUrl = url.origin || 'https://ownyourposts.com';
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
