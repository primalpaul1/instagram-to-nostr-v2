import { json } from '@sveltejs/kit';
import {
  getGiftByTokenWithPosts,
  getGiftByTokenWithArticles,
  getGiftByToken,
  markGiftClaimed,
  updateGiftPostStatus,
  updateGiftArticleStatus
} from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { token } = params;

    // First get the gift to check its type
    const gift = await getGiftByToken(token);
    if (!gift) {
      return json({ error: 'Gift not found' }, { status: 404 });
    }

    // Check if expired
    const expiresAt = new Date(gift.expires_at);
    if (expiresAt < new Date() && gift.status !== 'claimed') {
      return json({ error: 'This gift has expired' }, { status: 410 });
    }

    // Parse profile/feed data
    let profile = null;
    let feed = null;
    if (gift.profile_data) {
      try {
        const parsed = JSON.parse(gift.profile_data);
        if (gift.gift_type === 'articles') {
          feed = parsed;
        } else {
          profile = parsed;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Handle based on gift type
    if (gift.gift_type === 'articles') {
      const result = await getGiftByTokenWithArticles(token);
      if (!result) {
        return json({ error: 'Gift not found' }, { status: 404 });
      }

      const { articles } = result;

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
        gift_type: 'articles',
        handle: gift.ig_handle,
        feed,
        articles: formattedArticles,
        createdAt: gift.created_at,
        expiresAt: gift.expires_at
      });
    } else {
      // Default: posts
      const result = await getGiftByTokenWithPosts(token);
      if (!result) {
        return json({ error: 'Gift not found' }, { status: 404 });
      }

      const { posts } = result;

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
        gift_type: 'posts',
        handle: gift.ig_handle,
        profile,
        posts: formattedPosts,
        createdAt: gift.created_at,
        expiresAt: gift.expires_at
      });
    }
  } catch (err) {
    console.error('Error fetching gift:', err);
    return json({ error: 'Failed to fetch gift' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { token } = params;
    const body = await request.json();
    const { action, postId, postIds, articleId, articleIds } = body;

    const gift = await getGiftByToken(token);
    if (!gift) {
      return json({ error: 'Gift not found' }, { status: 404 });
    }

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

    // Post actions (for posts gift type)
    if (action === 'markPostPublished') {
      if (!postId) {
        return json({ error: 'Missing postId' }, { status: 400 });
      }
      await updateGiftPostStatus(postId, 'published');
      return json({ success: true });
    }

    if (action === 'markPostsPublished') {
      if (!postIds || !Array.isArray(postIds)) {
        return json({ error: 'Missing postIds array' }, { status: 400 });
      }
      for (const id of postIds) {
        await updateGiftPostStatus(id, 'published');
      }
      return json({ success: true, count: postIds.length });
    }

    // Article actions (for articles gift type)
    if (action === 'markArticlePublished') {
      if (!articleId) {
        return json({ error: 'Missing articleId' }, { status: 400 });
      }
      await updateGiftArticleStatus(articleId, 'published');
      return json({ success: true });
    }

    if (action === 'markArticlesPublished') {
      if (!articleIds || !Array.isArray(articleIds)) {
        return json({ error: 'Missing articleIds array' }, { status: 400 });
      }
      for (const id of articleIds) {
        await updateGiftArticleStatus(id, 'published');
      }
      return json({ success: true, count: articleIds.length });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Error processing gift action:', err);
    return json({ error: 'Failed to process action' }, { status: 500 });
  }
};
