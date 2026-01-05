import { json } from '@sveltejs/kit';
import {
  getProposalByTokenWithPosts,
  markProposalClaimed,
  updateProposalPostStatus
} from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { token } = params;

    const result = await getProposalByTokenWithPosts(token);
    if (!result) {
      return json({ error: 'Proposal not found' }, { status: 404 });
    }

    const { proposal, posts } = result;

    // Check if expired
    const expiresAt = new Date(proposal.expires_at);
    if (expiresAt < new Date() && proposal.status !== 'claimed') {
      return json({ error: 'This proposal has expired' }, { status: 410 });
    }

    // Parse profile data
    let profile = null;
    if (proposal.profile_data) {
      try {
        profile = JSON.parse(proposal.profile_data);
      } catch {
        // Ignore parse errors
      }
    }

    // Format posts for response
    const formattedPosts = posts.map(post => {
      let mediaItems = [];
      let blossomUrls = [];

      try {
        mediaItems = JSON.parse(post.media_items);
      } catch {
        // Ignore parse errors
      }

      if (post.blossom_urls) {
        try {
          blossomUrls = JSON.parse(post.blossom_urls);
        } catch {
          // Ignore parse errors
        }
      }

      return {
        id: post.id,
        post_type: post.post_type,
        caption: post.caption,
        original_date: post.original_date,
        thumbnail_url: post.thumbnail_url,
        media_items: mediaItems,
        blossom_urls: blossomUrls,
        status: post.status
      };
    });

    return json({
      status: proposal.status,
      targetNpub: proposal.target_npub,
      targetPubkeyHex: proposal.target_pubkey_hex,
      handle: proposal.ig_handle,
      profile,
      posts: formattedPosts,
      createdAt: proposal.created_at,
      expiresAt: proposal.expires_at
    });
  } catch (err) {
    console.error('Error fetching proposal:', err);
    return json({ error: 'Failed to fetch proposal' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { token } = params;
    const body = await request.json();
    const { action, pubkeyHex, postId } = body;

    const result = await getProposalByTokenWithPosts(token);
    if (!result) {
      return json({ error: 'Proposal not found' }, { status: 404 });
    }

    const { proposal } = result;

    // Check if expired
    const expiresAt = new Date(proposal.expires_at);
    if (expiresAt < new Date() && proposal.status !== 'claimed') {
      return json({ error: 'This proposal has expired' }, { status: 410 });
    }

    if (action === 'verify') {
      // Verify that the connected pubkey matches the target
      if (!pubkeyHex) {
        return json({ error: 'Missing pubkeyHex' }, { status: 400 });
      }

      const isValid = pubkeyHex.toLowerCase() === proposal.target_pubkey_hex.toLowerCase();

      if (!isValid) {
        return json({
          valid: false,
          error: 'This migration was prepared for a different Nostr account'
        });
      }

      return json({ valid: true });
    }

    if (action === 'complete') {
      // Mark proposal as claimed
      if (proposal.status === 'claimed') {
        return json({ error: 'Proposal already claimed' }, { status: 400 });
      }

      await markProposalClaimed(proposal.id);
      return json({ success: true });
    }

    if (action === 'markPostPublished') {
      // Mark a specific post as published
      if (!postId) {
        return json({ error: 'Missing postId' }, { status: 400 });
      }

      await updateProposalPostStatus(postId, 'published');
      return json({ success: true });
    }

    if (action === 'markPostsPublished') {
      // Batch mark multiple posts as published
      const { postIds } = body;
      if (!postIds || !Array.isArray(postIds)) {
        return json({ error: 'Missing postIds array' }, { status: 400 });
      }

      // Mark all posts as published
      for (const id of postIds) {
        await updateProposalPostStatus(id, 'published');
      }
      return json({ success: true, count: postIds.length });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Error processing proposal action:', err);
    return json({ error: 'Failed to process action' }, { status: 500 });
  }
};
