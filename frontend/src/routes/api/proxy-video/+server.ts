import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Proxy video downloads to avoid CORS issues.
 * Used by NIP-46 mode where frontend handles video upload.
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

    // Fetch the video/image
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return json(
        { message: `Failed to fetch: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const data = await response.arrayBuffer();

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': data.byteLength.toString()
      }
    });
  } catch (err) {
    console.error('Error proxying video:', err);
    return json(
      { message: 'Failed to proxy video' },
      { status: 500 }
    );
  }
};
