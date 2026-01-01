import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BACKEND_URL = env.BACKEND_URL || 'http://localhost:8000';

export const GET: RequestHandler = async ({ params }) => {
  const { handle } = params;

  if (!handle) {
    return new Response(
      `data: ${JSON.stringify({ error: 'Handle is required' })}\n\n`,
      {
        status: 400,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }

  try {
    const response = await fetch(`${BACKEND_URL}/videos-stream/${encodeURIComponent(handle)}`);

    if (!response.ok) {
      return new Response(
        `data: ${JSON.stringify({ error: 'Failed to fetch videos' })}\n\n`,
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
    console.error('Error streaming videos:', err);
    return new Response(
      `data: ${JSON.stringify({ error: 'Failed to connect to backend' })}\n\n`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/event-stream' }
      }
    );
  }
};
