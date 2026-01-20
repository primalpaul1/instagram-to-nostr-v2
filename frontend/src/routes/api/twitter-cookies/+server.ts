import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BACKEND_URL = env.BACKEND_URL || 'http://localhost:8000';

export const POST: RequestHandler = async ({ request, url }) => {
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: 'Session ID is required' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    // Get the form data from the request
    const formData = await request.formData();
    const cookies = formData.get('cookies');

    if (!cookies || !(cookies instanceof File)) {
      return new Response(
        JSON.stringify({ error: 'Cookies file is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Forward to backend
    const backendFormData = new FormData();
    backendFormData.append('cookies', cookies);

    const response = await fetch(
      `${BACKEND_URL}/twitter-cookies?session_id=${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        body: backendFormData
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: `Failed to upload cookies: ${errorText}` }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Error uploading Twitter cookies:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to upload cookies' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: 'Session ID is required' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const response = await fetch(
      `${BACKEND_URL}/twitter-cookies/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to delete cookies' }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Error deleting Twitter cookies:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to delete cookies' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
