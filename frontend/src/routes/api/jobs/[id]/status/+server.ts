import { json } from '@sveltejs/kit';
import { getJobWithTasks } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { id } = params;

    const result = await getJobWithTasks(id);

    if (!result) {
      return json({ message: 'Job not found' }, { status: 404 });
    }

    return json({
      status: result.job.status,
      tasks: result.tasks.map(task => ({
        id: task.id,
        status: task.status,
        caption: task.caption,
        blossom_url: task.blossom_url,
        nostr_event_id: task.nostr_event_id,
        error: task.error
      }))
    });
  } catch (err) {
    console.error('Error fetching job status:', err);
    return json(
      { message: 'Failed to fetch job status' },
      { status: 500 }
    );
  }
};
