import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addSubscriber } from '$lib/server/db';
import { sendWelcomeEmail } from '$lib/server/welcomeEmail';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEMENT_REGEX = /^[a-z-]{1,24}$/;

// Other sites allowed to post signups here, mapped to the source stored with each email
const CROSS_SITE_SOURCES = new Map([
  ['https://paulinthejungle.com', 'paulinthejungle'],
  ['https://www.paulinthejungle.com', 'paulinthejungle']
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !CROSS_SITE_SOURCES.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

// Browsers send a preflight before a cross-site JSON POST
export const OPTIONS: RequestHandler = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

export const POST: RequestHandler = async ({ request }) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  let body: { email?: unknown; placement?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, { status: 400, headers });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_REGEX.test(email)) {
    return json({ error: 'Invalid email address' }, { status: 400, headers });
  }

  // e.g. "ownyourposts" or "paulinthejungle:hero"
  let source = (origin && CROSS_SITE_SOURCES.get(origin)) || 'ownyourposts';
  if (typeof body.placement === 'string' && PLACEMENT_REGEX.test(body.placement)) {
    source += ':' + body.placement;
  }

  // Only brand-new addresses get the welcome email; don't hold up the response for it
  if (addSubscriber(email, source)) {
    sendWelcomeEmail(email, source);
  }
  return json({ success: true }, { headers });
};
