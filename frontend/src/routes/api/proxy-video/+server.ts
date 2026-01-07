import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CONNECTION_TIMEOUT = 30 * 1000; // 30 seconds to establish connection

/**
 * Proxy video downloads to avoid CORS issues.
 * Streams directly from Instagram CDN to client for better performance.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const { url } = await request.json();

    if (!url) {
      return json({ message: 'URL is required' }, { status: 400 });
    }

    // Validate URL is a video source we trust
    const parsedUrl = new URL(url);
    const allowedHosts = [
      'instagram.com',
      'cdninstagram.com',
      'fbcdn.net',
      'scontent.cdninstagram.com',
      'scontent-',
      'video.cdninstagram.com'
    ];

    const isAllowed = allowedHosts.some(
      host => parsedUrl.hostname.includes(host) || parsedUrl.hostname.endsWith(host)
    );

    if (!isAllowed) {
      return json({ message: 'URL not allowed' }, { status: 403 });
    }

    // 30 second timeout to establish connection
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return json(
        { message: `Failed to fetch: ${response.status}` },
        { status: response.status }
      );
    }

    if (!response.body) {
      return json({ message: 'No response body' }, { status: 500 });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');

    // Stream directly to client - no buffering
    const headers: HeadersInit = {
      'Content-Type': contentType
    };
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    return new Response(response.body, { headers });
  } catch (err) {
    console.error('Error proxying video:', err);

    if (err instanceof Error && err.name === 'AbortError') {
      return json(
        { message: 'Connection timed out - Instagram CDN may be slow' },
        { status: 504 }
      );
    }

    return json(
      { message: 'Failed to proxy video' },
      { status: 500 }
    );
  }
};
