import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BACKEND_URL = env.BACKEND_URL || 'http://localhost:8000';

export const GET: RequestHandler = async ({ url }) => {
  const feedUrl = url.searchParams.get('feed_url');

  if (!feedUrl) {
    return new Response(
      `data: ${JSON.stringify({ error: 'Feed URL is required' })}\n\n`,
      {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }

  try {
    const response = await fetch(
      `${BACKEND_URL}/rss-stream?feed_url=${encodeURIComponent(feedUrl)}`
    );

    if (!response.ok) {
      return new Response(
        `data: ${JSON.stringify({ error: 'Failed to fetch RSS feed' })}\n\n`,
        {
          status: response.status,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      );
    }

    // Stream the response through
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  } catch (err) {
    console.error('Error streaming RSS feed:', err);
    return new Response(
      `data: ${JSON.stringify({ error: 'Failed to connect to backend' })}\n\n`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }
};
