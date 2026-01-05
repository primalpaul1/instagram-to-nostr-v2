import { json } from '@sveltejs/kit';
import { createProposal, createProposalPost } from '$lib/server/db';
import { npubToHex } from '$lib/nip46';
import type { RequestHandler } from './$types';

function generateId(): string {
  return crypto.randomUUID();
}

function generateClaimToken(): string {
  // Generate a short, URL-safe token
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

interface MediaItemInput {
  url: string;
  media_type: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url?: string;
}

interface PostInput {
  id: string;
  post_type: 'reel' | 'image' | 'carousel';
  caption?: string;
  original_date?: string;
  thumbnail_url?: string;
  media_items: MediaItemInput[];
}

interface ProfileInput {
  username?: string;
  display_name?: string;
  bio?: string;
  profile_picture_url?: string;
}

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { handle, targetNpub, posts, profile } = body as {
      handle: string;
      targetNpub: string;
      posts: PostInput[];
      profile?: ProfileInput;
    };

    if (!handle || !targetNpub || !posts?.length) {
      return json(
        { message: 'Missing required fields: handle, targetNpub, and posts are required' },
        { status: 400 }
      );
    }

    // Validate and convert npub to hex
    const targetPubkeyHex = npubToHex(targetNpub);
    if (!targetPubkeyHex) {
      return json(
        { message: 'Invalid npub format' },
        { status: 400 }
      );
    }

    // Create the proposal
    const proposalId = generateId();
    const claimToken = generateClaimToken();
    const profileData = profile ? JSON.stringify(profile) : undefined;

    await createProposal(
      proposalId,
      claimToken,
      targetNpub,
      targetPubkeyHex,
      handle,
      profileData
    );

    // Create proposal posts
    for (const post of posts) {
      await createProposalPost(
        proposalId,
        post.post_type,
        JSON.stringify(post.media_items),
        post.caption,
        post.original_date,
        post.thumbnail_url
      );
    }

    // Build the claim URL
    const baseUrl = url.origin || 'https://instatoprimal.com';
    const claimUrl = `${baseUrl}/claim/${claimToken}`;

    return json({
      proposalId,
      claimToken,
      claimUrl
    });
  } catch (err) {
    console.error('Error creating proposal:', err);
    return json(
      { message: 'Failed to create proposal' },
      { status: 500 }
    );
  }
};
