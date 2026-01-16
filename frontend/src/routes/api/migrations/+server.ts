import { json } from '@sveltejs/kit';
import { createMigrationWithContent } from '$lib/server/db';
import type { MigrationPostInput, MigrationArticleInput } from '$lib/server/db';
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
  post_type: 'reel' | 'image' | 'carousel' | 'video';
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
  hashtags?: string[];
}

interface ProfileInput {
  name?: string;
  bio?: string;
  picture_url?: string;
}

interface FeedInput {
  url: string;
  title?: string;
  description?: string;
  image_url?: string;
}

/**
 * POST /api/migrations
 *
 * Creates a new migration for client-side signing flow.
 * NO secret keys are sent - user signs events in browser.
 *
 * Body:
 * - sourceType: 'instagram' | 'tiktok' | 'rss'
 * - sourceHandle: Instagram handle, TikTok handle, or RSS URL
 * - posts?: PostInput[] (for Instagram/TikTok)
 * - articles?: ArticleInput[] (for RSS/Substack)
 * - profile?: ProfileInput
 * - feed?: FeedInput (for RSS)
 *
 * Returns: { migrationId }
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { sourceType, sourceHandle, posts, articles, profile, feed } = body as {
      sourceType: 'instagram' | 'tiktok' | 'rss';
      sourceHandle: string;
      posts?: PostInput[];
      articles?: ArticleInput[];
      profile?: ProfileInput;
      feed?: FeedInput;
    };

    // Validate required fields
    if (!sourceType || !sourceHandle) {
      return json(
        { message: 'Missing required fields: sourceType and sourceHandle are required' },
        { status: 400 }
      );
    }

    // Validate content based on source type
    if ((sourceType === 'instagram' || sourceType === 'tiktok') && (!posts || posts.length === 0)) {
      return json(
        { message: 'Posts are required for Instagram/TikTok migrations' },
        { status: 400 }
      );
    }

    if (sourceType === 'rss' && (!articles || articles.length === 0)) {
      return json(
        { message: 'Articles are required for RSS migrations' },
        { status: 400 }
      );
    }

    // Create the migration
    const migrationId = generateId();

    // Build profile_data JSON
    let profileData: string | undefined;
    if (sourceType === 'rss' && feed) {
      profileData = JSON.stringify({ feed, profile });
    } else if (profile) {
      profileData = JSON.stringify(profile);
    }

    // Convert posts to MigrationPostInput format
    const postsInput: MigrationPostInput[] = (posts || []).map(post => ({
      postType: post.post_type,
      mediaItems: JSON.stringify(post.media_items),
      caption: post.caption,
      originalDate: post.original_date,
      thumbnailUrl: post.thumbnail_url
    }));

    // Convert articles to MigrationArticleInput format
    const articlesInput: MigrationArticleInput[] = (articles || []).map(article => ({
      title: article.title,
      contentMarkdown: article.content_markdown,
      summary: article.summary,
      publishedAt: article.published_at,
      link: article.link,
      imageUrl: article.image_url,
      hashtags: article.hashtags
    }));

    // Create migration with all content atomically
    await createMigrationWithContent(
      migrationId,
      sourceHandle,
      sourceType,
      profileData,
      postsInput,
      articlesInput
    );

    return json({ migrationId });
  } catch (err) {
    console.error('Error creating migration:', err);
    return json(
      { message: 'Failed to create migration' },
      { status: 500 }
    );
  }
};
