import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeSubscriber } from '$lib/server/db';
import { isValidUnsubscribeToken } from '$lib/server/welcomeEmail';

// Called from the /unsubscribe confirmation page (the link in every welcome email)
export const POST: RequestHandler = async ({ request }) => {
  let body: { email?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!email || !isValidUnsubscribeToken(email, token)) {
    return json({ error: 'Invalid unsubscribe link' }, { status: 400 });
  }

  removeSubscriber(email);
  return json({ success: true });
};
