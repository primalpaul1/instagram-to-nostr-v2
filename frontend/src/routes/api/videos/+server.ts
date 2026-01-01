import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BACKEND_URL = env.BACKEND_URL || 'http://localhost:8000';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { handle } = await request.json();

    if (!handle) {
      return json({ message: 'Handle is required' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_URL}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to fetch videos' }));
      return json(
        { message: error.detail || 'Failed to fetch videos' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return json(data);
  } catch (err) {
    console.error('Error fetching videos:', err);
    return json(
      { message: 'Failed to connect to backend' },
      { status: 500 }
    );
  }
};
