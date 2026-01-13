import { json } from '@sveltejs/kit';
import {
  getRssGiftByTokenWithArticles,
  markRssGiftClaimed,
  updateRssGiftArticleStatus
} from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { token } = params;

    const result = await getRssGiftByTokenWithArticles(token);
    if (!result) {
      return json({ error: 'RSS gift not found' }, { status: 404 });
    }

    const { gift, articles } = result;

    // Check if expired
    const expiresAt = new Date(gift.expires_at);
    if (expiresAt < new Date() && gift.status !== 'claimed') {
      return json({ error: 'This gift has expired' }, { status: 410 });
    }

    // Format articles for response
    const formattedArticles = articles.map(article => {
      let hashtags: string[] = [];
      if (article.hashtags) {
        try {
          hashtags = JSON.parse(article.hashtags);
        } catch {
          // Ignore parse errors
        }
      }

      return {
        id: article.id,
        title: article.title,
        summary: article.summary,
        content_markdown: article.content_markdown,
        published_at: article.published_at,
        link: article.link,
        image_url: article.image_url,
        blossom_image_url: article.blossom_image_url,
        hashtags,
        status: article.status
      };
    });

    return json({
      status: gift.status,
      feed_url: gift.feed_url,
      feed_title: gift.feed_title,
      feed_description: gift.feed_description,
      feed_image_url: gift.feed_image_url,
      articles: formattedArticles,
      createdAt: gift.created_at,
      expiresAt: gift.expires_at
    });
  } catch (err) {
    console.error('Error fetching RSS gift:', err);
    return json({ error: 'Failed to fetch RSS gift' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { token } = params;
    const body = await request.json();
    const { action, articleId, articleIds } = body;

    const result = await getRssGiftByTokenWithArticles(token);
    if (!result) {
      return json({ error: 'RSS gift not found' }, { status: 404 });
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

      await markRssGiftClaimed(gift.id);
      return json({ success: true });
    }

    if (action === 'markArticlePublished') {
      if (!articleId) {
        return json({ error: 'Missing articleId' }, { status: 400 });
      }

      await updateRssGiftArticleStatus(articleId, 'published');
      return json({ success: true });
    }

    if (action === 'markArticlesPublished') {
      if (!articleIds || !Array.isArray(articleIds)) {
        return json({ error: 'Missing articleIds array' }, { status: 400 });
      }

      for (const id of articleIds) {
        await updateRssGiftArticleStatus(id, 'published');
      }
      return json({ success: true, count: articleIds.length });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Error processing RSS gift action:', err);
    return json({ error: 'Failed to process action' }, { status: 500 });
  }
};
