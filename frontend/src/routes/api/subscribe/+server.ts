import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addSubscriber } from '$lib/server/db';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const email = body.email?.trim().toLowerCase();

  if (!email || !EMAIL_REGEX.test(email)) {
    return json({ error: 'Invalid email address' }, { status: 400 });
  }

  addSubscriber(email);
  return json({ success: true });
};
