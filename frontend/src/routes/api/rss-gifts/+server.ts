import { json } from '@sveltejs/kit';
import { createRssGift, createRssGiftArticle } from '$lib/server/db';
import type { RequestHandler } from './$types';

function generateId(): string {
  return crypto.randomUUID();
}

function generateClaimToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16);
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

interface FeedMetaInput {
  title?: string;
  description?: string;
  image_url?: string;
}

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { feed_url, feed_meta, articles } = body as {
      feed_url: string;
      feed_meta?: FeedMetaInput;
      articles: ArticleInput[];
    };

    if (!feed_url || !articles?.length) {
      return json(
        { message: 'Missing required fields: feed_url and articles are required' },
        { status: 400 }
      );
    }

    // Create the RSS gift
    const giftId = generateId();
    const claimToken = generateClaimToken();

    await createRssGift(
      giftId,
      claimToken,
      feed_url,
      feed_meta?.title,
      feed_meta?.description,
      feed_meta?.image_url
    );

    // Create gift articles
    for (const article of articles) {
      await createRssGiftArticle(
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

    // Build the claim URL
    const baseUrl = url.origin || 'https://ownyourposts.com';
    const claimUrl = `${baseUrl}/rss-gift-claim/${claimToken}`;

    return json({
      giftId,
      claimToken,
      claimUrl
    });
  } catch (err) {
    console.error('Error creating RSS gift:', err);
    return json(
      { message: 'Failed to create RSS gift' },
      { status: 500 }
    );
  }
};
