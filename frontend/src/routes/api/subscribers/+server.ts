import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSubscribers } from '$lib/server/db';

export const GET: RequestHandler = async ({ url }) => {
  const key = url.searchParams.get('key');
  const adminKey = env.ADMIN_KEY;

  if (!adminKey || key !== adminKey) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subscribers = getSubscribers();
  return json(subscribers);
};
