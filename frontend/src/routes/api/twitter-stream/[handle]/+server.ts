import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BACKEND_URL = env.BACKEND_URL || 'http://localhost:8000';

export const GET: RequestHandler = async ({ params, url }) => {
  const { handle } = params;
  const sessionId = url.searchParams.get('session_id');

  if (!handle) {
    return new Response(
      `data: ${JSON.stringify({ error: 'Handle is required' })}\n\n`,
      {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }

  if (!sessionId) {
    return new Response(
      `data: ${JSON.stringify({ error: 'Session ID is required for Twitter authentication' })}\n\n`,
      {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }

  try {
    const backendUrl = `${BACKEND_URL}/twitter-stream/${encodeURIComponent(handle)}?session_id=${encodeURIComponent(sessionId)}`;
    const response = await fetch(backendUrl);

    if (!response.ok) {
      return new Response(
        `data: ${JSON.stringify({ error: 'Failed to fetch Twitter posts' })}\n\n`,
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
    console.error('Error streaming Twitter posts:', err);
    return new Response(
      `data: ${JSON.stringify({ error: 'Failed to connect to backend' })}\n\n`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }
};
