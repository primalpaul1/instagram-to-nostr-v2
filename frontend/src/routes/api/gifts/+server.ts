import { json } from '@sveltejs/kit';
import { createGiftWithContent } from '$lib/server/db';
import type { GiftPostInput, GiftArticleInput } from '$lib/server/db';
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
    const { handle, posts, profile, gift_type, articles, feed, suggested_follows } = body as {
      handle: string;
      posts?: PostInput[];
      profile?: ProfileInput;
      gift_type?: 'posts' | 'articles' | 'combined';
      articles?: ArticleInput[];
      feed?: FeedInput;
      suggested_follows?: string[];
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
    } else if (giftType === 'combined') {
      if (!handle || !posts?.length) {
        return json(
          { message: 'Combined gift requires handle and posts' },
          { status: 400 }
        );
      }
      if (!articles?.length) {
        return json(
          { message: 'Combined gift requires articles' },
          { status: 400 }
        );
      }
    }

    // Create the gift
    const giftId = generateId();
    const claimToken = generateClaimToken();

    // Store profile and/or feed info in profile_data based on gift type
    let profileData: string | undefined;
    if (giftType === 'articles') {
      profileData = JSON.stringify({ feed, profile });
    } else if (giftType === 'combined') {
      // Combined gifts store both profile (from social) and feed info
      profileData = JSON.stringify({ profile, feed });
    } else if (profile) {
      profileData = JSON.stringify(profile);
    }

    // Use feed URL as handle for articles-only, otherwise use the social handle
    const giftHandle = giftType === 'articles' ? (feed?.url || 'RSS Feed') : handle;

    // Convert posts to GiftPostInput format
    const postsInput: GiftPostInput[] = ((giftType === 'posts' || giftType === 'combined') && posts)
      ? posts.map(post => ({
          postType: post.post_type,
          mediaItems: JSON.stringify(post.media_items),
          caption: post.caption,
          originalDate: post.original_date,
          thumbnailUrl: post.thumbnail_url
        }))
      : [];

    // Convert articles to GiftArticleInput format
    const articlesInput: GiftArticleInput[] = ((giftType === 'articles' || giftType === 'combined') && articles)
      ? articles.map(article => ({
          title: article.title,
          contentMarkdown: article.content_markdown,
          summary: article.summary,
          publishedAt: article.published_at,
          link: article.link,
          imageUrl: article.image_url,
          blossomImageUrl: article.blossom_image_url,
          hashtags: article.hashtags
        }))
      : [];

    // Create gift with all content atomically - prevents race conditions
    // where the gift or posts could be lost due to concurrent database writes
    await createGiftWithContent(
      giftId,
      claimToken,
      giftHandle,
      profileData,
      giftType,
      postsInput,
      articlesInput,
      suggested_follows
    );

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
