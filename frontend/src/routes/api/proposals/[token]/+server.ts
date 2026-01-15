import { json } from '@sveltejs/kit';
import {
  getProposalByToken,
  getProposalByTokenWithPosts,
  getProposalByTokenWithArticles,
  getProposalByTokenWithBoth,
  markProposalClaimed,
  updateProposalPostStatus,
  updateProposalArticleStatus
} from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { token } = params;

    // First get the proposal to check its type
    const proposal = await getProposalByToken(token);
    if (!proposal) {
      return json({ error: 'Proposal not found' }, { status: 404 });
    }

    // Check if expired
    const expiresAt = new Date(proposal.expires_at);
    if (expiresAt < new Date() && proposal.status !== 'claimed') {
      return json({ error: 'This proposal has expired' }, { status: 410 });
    }

    // Parse profile/feed data
    let profile = null;
    let feed = null;
    if (proposal.profile_data) {
      try {
        const parsed = JSON.parse(proposal.profile_data);
        if (proposal.proposal_type === 'articles') {
          feed = parsed.feed || parsed;
          profile = parsed.profile || null;
        } else if (proposal.proposal_type === 'combined') {
          profile = parsed.profile || null;
          feed = parsed.feed || null;
        } else {
          profile = parsed;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Helper to format posts
    const formatPosts = (posts: any[]) => posts.map(post => {
      let mediaItems = [];
      let blossomUrls = [];

      try {
        mediaItems = JSON.parse(post.media_items);
      } catch {}

      if (post.blossom_urls) {
        try {
          blossomUrls = JSON.parse(post.blossom_urls);
        } catch {}
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

    // Helper to format articles
    const formatArticles = (articles: any[]) => articles.map(article => {
      let hashtags: string[] = [];
      if (article.hashtags) {
        try {
          hashtags = JSON.parse(article.hashtags);
        } catch {}
      }

      return {
        id: article.id,
        title: article.title,
        summary: article.summary,
        content_markdown: article.content_markdown,
        published_at: article.published_at,
        link: article.link,
        image_url: article.image_url,
        blossom_image_url: article.blossom_image_url,
        hashtags,
        status: article.status
      };
    });

    // Handle based on proposal type
    const proposalType = proposal.proposal_type || 'posts';

    if (proposalType === 'combined') {
      const result = await getProposalByTokenWithBoth(token);
      if (!result) {
        return json({ error: 'Proposal not found' }, { status: 404 });
      }

      return json({
        status: proposal.status,
        proposal_type: 'combined',
        targetNpub: proposal.target_npub,
        targetPubkeyHex: proposal.target_pubkey_hex,
        handle: proposal.ig_handle,
        profile,
        feed,
        posts: formatPosts(result.posts),
        articles: formatArticles(result.articles),
        createdAt: proposal.created_at,
        expiresAt: proposal.expires_at
      });
    } else if (proposalType === 'articles') {
      const result = await getProposalByTokenWithArticles(token);
      if (!result) {
        return json({ error: 'Proposal not found' }, { status: 404 });
      }

      return json({
        status: proposal.status,
        proposal_type: 'articles',
        targetNpub: proposal.target_npub,
        targetPubkeyHex: proposal.target_pubkey_hex,
        handle: proposal.ig_handle,
        profile,
        feed,
        articles: formatArticles(result.articles),
        createdAt: proposal.created_at,
        expiresAt: proposal.expires_at
      });
    } else {
      // Default: posts
      const result = await getProposalByTokenWithPosts(token);
      if (!result) {
        return json({ error: 'Proposal not found' }, { status: 404 });
      }

      return json({
        status: proposal.status,
        proposal_type: 'posts',
        targetNpub: proposal.target_npub,
        targetPubkeyHex: proposal.target_pubkey_hex,
        handle: proposal.ig_handle,
        profile,
        posts: formatPosts(result.posts),
        createdAt: proposal.created_at,
        expiresAt: proposal.expires_at
      });
    }
  } catch (err) {
    console.error('Error fetching proposal:', err);
    return json({ error: 'Failed to fetch proposal' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { token } = params;
    const body = await request.json();
    const { action, pubkeyHex, postId, articleId, postIds, articleIds } = body;

    const proposal = await getProposalByToken(token);
    if (!proposal) {
      return json({ error: 'Proposal not found' }, { status: 404 });
    }

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

    // Post actions
    if (action === 'markPostPublished') {
      if (!postId) {
        return json({ error: 'Missing postId' }, { status: 400 });
      }
      await updateProposalPostStatus(postId, 'published');
      return json({ success: true });
    }

    if (action === 'markPostsPublished') {
      if (!postIds || !Array.isArray(postIds)) {
        return json({ error: 'Missing postIds array' }, { status: 400 });
      }
      for (const id of postIds) {
        await updateProposalPostStatus(id, 'published');
      }
      return json({ success: true, count: postIds.length });
    }

    // Article actions
    if (action === 'markArticlePublished') {
      if (!articleId) {
        return json({ error: 'Missing articleId' }, { status: 400 });
      }
      await updateProposalArticleStatus(articleId, 'published');
      return json({ success: true });
    }

    if (action === 'markArticlesPublished') {
      if (!articleIds || !Array.isArray(articleIds)) {
        return json({ error: 'Missing articleIds array' }, { status: 400 });
      }
      for (const id of articleIds) {
        await updateProposalArticleStatus(id, 'published');
      }
      return json({ success: true, count: articleIds.length });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Error processing proposal action:', err);
    return json({ error: 'Failed to process action' }, { status: 500 });
  }
};
