import { json } from '@sveltejs/kit';
import { createProposalWithContent, type ProposalPostInput, type ProposalArticleInput } from '$lib/server/db';
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

interface ArticleInput {
  title: string;
  summary?: string;
  content_markdown: string;
  published_at?: string;
  link?: string;
  image_url?: string;
  hashtags?: string[];
}

interface ProfileInput {
  username?: string;
  display_name?: string;
  bio?: string;
  profile_picture_url?: string;
}

interface FeedInput {
  url: string;
  title?: string;
  description?: string;
  image_url?: string;
}

export const POST: RequestHandler = async ({ request, url }) => {
  console.log('[Proposals API] Received POST request');
  try {
    const body = await request.json();
    console.log('[Proposals API] Body parsed, handle:', body.handle, 'posts count:', body.posts?.length, 'articles count:', body.articles?.length);
    const { handle, targetNpub, posts, profile, proposal_type, articles, feed } = body as {
      handle: string;
      targetNpub: string;
      posts?: PostInput[];
      profile?: ProfileInput;
      proposal_type?: 'posts' | 'articles' | 'combined';
      articles?: ArticleInput[];
      feed?: FeedInput;
    };

    const proposalType = proposal_type || 'posts';

    // Validate based on proposal type
    if (!targetNpub) {
      return json(
        { message: 'Missing required field: targetNpub' },
        { status: 400 }
      );
    }

    if (proposalType === 'posts') {
      if (!handle || !posts?.length) {
        return json(
          { message: 'Missing required fields: handle and posts are required' },
          { status: 400 }
        );
      }
    } else if (proposalType === 'articles') {
      if (!articles?.length) {
        return json(
          { message: 'Missing required fields: articles are required' },
          { status: 400 }
        );
      }
    } else if (proposalType === 'combined') {
      if (!handle || !posts?.length) {
        return json(
          { message: 'Combined proposal requires handle and posts' },
          { status: 400 }
        );
      }
      if (!articles?.length) {
        return json(
          { message: 'Combined proposal requires articles' },
          { status: 400 }
        );
      }
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

    // Store profile and/or feed info in profile_data based on proposal type
    let profileData: string | undefined;
    if (proposalType === 'articles') {
      // For article-only proposals, construct profile from feed info
      const articleProfile = profile || (feed ? {
        username: feed.title,
        display_name: feed.title,
        bio: feed.description,
        profile_picture_url: feed.image_url
      } : undefined);
      profileData = JSON.stringify({ feed, profile: articleProfile });
    } else if (proposalType === 'combined') {
      profileData = JSON.stringify({ profile, feed });
    } else if (profile) {
      profileData = JSON.stringify(profile);
    }

    // Use feed URL as handle for articles-only, otherwise use the social handle
    const proposalHandle = proposalType === 'articles' ? (feed?.url || 'RSS Feed') : handle;

    // Convert posts to input format
    const postInputs: ProposalPostInput[] = (posts || []).map(post => ({
      postType: post.post_type,
      mediaItems: JSON.stringify(post.media_items),
      caption: post.caption,
      originalDate: post.original_date,
      thumbnailUrl: post.thumbnail_url
    }));

    // Convert articles to input format
    const articleInputs: ProposalArticleInput[] = (articles || []).map(article => ({
      title: article.title,
      contentMarkdown: article.content_markdown,
      summary: article.summary,
      publishedAt: article.published_at,
      link: article.link,
      imageUrl: article.image_url,
      hashtags: article.hashtags
    }));

    // Create proposal with all content in a single DB transaction
    await createProposalWithContent(
      proposalId,
      claimToken,
      targetNpub,
      targetPubkeyHex,
      proposalHandle,
      profileData,
      proposalType,
      postInputs,
      articleInputs
    );

    // Build the claim URL
    const baseUrl = url.origin || 'https://ownyourposts.com';
    const claimUrl = `${baseUrl}/claim/${claimToken}`;

    console.log('[Proposals API] Success! proposalId:', proposalId, 'claimUrl:', claimUrl);
    return json({
      proposalId,
      claimToken,
      claimUrl
    });
  } catch (err) {
    console.error('[Proposals API] Error creating proposal:', err);
    return json(
      { message: 'Failed to create proposal' },
      { status: 500 }
    );
  }
};
