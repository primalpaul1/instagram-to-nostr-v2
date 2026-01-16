import { json } from '@sveltejs/kit';
import {
  getMigrationWithContent,
  updateMigrationStatus,
  updateMigrationPostStatus,
  updateMigrationArticleStatus
} from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/migrations/[id]
 *
 * Returns migration status, posts with blossom_urls, articles with processed content.
 * Frontend polls this until status = "ready".
 */
export const GET: RequestHandler = async ({ params }) => {
  try {
    const { id } = params;

    const result = await getMigrationWithContent(id);
    if (!result) {
      return json({ message: 'Migration not found' }, { status: 404 });
    }

    const { migration, posts, articles } = result;

    // Calculate progress stats
    const totalPosts = posts.length;
    const readyPosts = posts.filter(p => p.status === 'ready' || p.status === 'published').length;
    const totalArticles = articles.length;
    const readyArticles = articles.filter(a => a.status === 'ready' || a.status === 'published').length;

    return json({
      migration,
      posts,
      articles,
      progress: {
        totalPosts,
        readyPosts,
        totalArticles,
        readyArticles,
        isReady: migration.status === 'ready'
      }
    });
  } catch (err) {
    console.error('Error fetching migration:', err);
    return json({ message: 'Failed to fetch migration' }, { status: 500 });
  }
};

/**
 * POST /api/migrations/[id]
 *
 * Actions for checkpointing and completing migrations.
 *
 * Body:
 * - action: 'markPostPublished' | 'markArticlePublished' | 'complete'
 * - postId?: number (for markPostPublished)
 * - articleId?: number (for markArticlePublished)
 */
export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { id } = params;
    const body = await request.json();
    const { action, postId, articleId } = body as {
      action: 'markPostPublished' | 'markArticlePublished' | 'complete';
      postId?: number;
      articleId?: number;
    };

    // Verify migration exists
    const result = await getMigrationWithContent(id);
    if (!result) {
      return json({ message: 'Migration not found' }, { status: 404 });
    }

    switch (action) {
      case 'markPostPublished':
        if (postId === undefined) {
          return json({ message: 'postId is required' }, { status: 400 });
        }
        await updateMigrationPostStatus(postId, 'published');
        return json({ success: true });

      case 'markArticlePublished':
        if (articleId === undefined) {
          return json({ message: 'articleId is required' }, { status: 400 });
        }
        await updateMigrationArticleStatus(articleId, 'published');
        return json({ success: true });

      case 'complete':
        await updateMigrationStatus(id, 'complete');
        return json({ success: true });

      default:
        return json({ message: 'Invalid action' }, { status: 400 });
    }
  } catch (err) {
    console.error('Error updating migration:', err);
    return json({ message: 'Failed to update migration' }, { status: 500 });
  }
};
