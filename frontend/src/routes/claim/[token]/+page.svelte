<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import type { Event } from 'nostr-tools';
  import {
    createConnectionURI,
    generateQRCode,
    generateSecret,
    generateLocalKeypair,
    waitForConnection,
    hexToNpub,
    closeConnection,
    type NIP46Connection
  } from '$lib/nip46';
  import {
    createMultiMediaPostEvent,
    createLongFormContentEvent,
    signWithNIP46,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload
  } from '$lib/signing';

  type PageStep = 'loading' | 'preview' | 'connect' | 'verify_error' | 'publishing' | 'complete' | 'error';

  interface ProposalPost {
    id: number;
    post_type: 'reel' | 'image' | 'carousel';
    caption: string | null;
    original_date: string | null;
    thumbnail_url: string | null;
    blossom_urls: string[];
    status: string;
  }

  interface ProposalArticle {
    id: number;
    title: string;
    summary: string | null;
    content_markdown: string;
    published_at: string | null;
    link: string | null;
    image_url: string | null;
    blossom_image_url: string | null;
    hashtags: string[];
    status: string;
  }

  interface Profile {
    username: string;
    display_name?: string;
    bio?: string;
    profile_picture_url?: string;
  }

  interface FeedInfo {
    url: string;
    title?: string;
    description?: string;
    image_url?: string;
  }

  interface PreparedBy {
    npub: string;
    name: string | null;
    picture: string | null;
  }

  interface Proposal {
    status: string;
    proposal_type: 'posts' | 'articles' | 'combined';
    targetNpub: string;
    targetPubkeyHex: string;
    handle: string;
    profile: Profile | null;
    feed?: FeedInfo;
    posts: ProposalPost[];
    articles: ProposalArticle[];
    prepared_by: PreparedBy | null;
  }

  let step: PageStep = 'loading';
  let proposal: Proposal | null = null;
  let error = '';

  // NIP-46 state
  let qrCodeDataUrl = '';
  let connectionSecret = '';
  let connectionURI = '';  // For QR code (no callback)
  let mobileConnectionURI = '';  // For mobile button (with callback)
  let localKeypair: { secretKey: string; publicKey: string } | null = null;
  let connectionStatus: 'idle' | 'waiting' | 'connected' | 'error' = 'idle';
  let connectionError = '';
  let nip46Connection: NIP46Connection | null = null;
  let connectedPubkey = '';

  // Publishing state
  interface PostTaskStatus {
    post: ProposalPost;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  interface ArticleTaskStatus {
    article: ProposalArticle;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  let postTasks: PostTaskStatus[] = [];
  let articleTasks: ArticleTaskStatus[] = [];
  let activePostIndices: Set<number> = new Set();
  let activeArticleIndices: Set<number> = new Set();

  // Post editing state
  let selectedPostIndex: number | null = null;
  let editingCaption = '';
  let editedCaptions: Record<number, string> = {}; // postId -> edited caption
  let excludedPosts: Set<number> = new Set(); // postIds to exclude from publishing

  // Article editing state
  let selectedArticleIndex: number | null = null;
  let editingArticleTitle = '';
  let editedArticleTitles: Record<number, string> = {}; // articleId -> edited title
  let excludedArticles: Set<number> = new Set(); // articleIds to exclude from publishing

  $: selectedPost = selectedPostIndex !== null && proposal ? proposal.posts[selectedPostIndex] : null;
  $: selectedArticle = selectedArticleIndex !== null && proposal ? proposal.articles[selectedArticleIndex] : null;
  $: includedPosts = proposal?.posts ? proposal.posts.filter(p => !excludedPosts.has(p.id)) : [];
  $: includedArticles = proposal?.articles ? proposal.articles.filter(a => !excludedArticles.has(a.id)) : [];
  $: includedPostCount = includedPosts.length;
  $: includedArticleCount = includedArticles.length;

  $: completedPostCount = postTasks.filter(t => t.status === 'complete').length;
  $: completedArticleCount = articleTasks.filter(t => t.status === 'complete').length;
  $: totalPostCount = postTasks.length;
  $: totalArticleCount = articleTasks.length;
  $: totalCount = totalPostCount + totalArticleCount;
  $: completedCount = completedPostCount + completedArticleCount;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const token = $page.params.token;

  onMount(async () => {
    await loadProposal();

    // Check for pending NIP-46 connection from redirect
    const pending = localStorage.getItem('nip46_pending');
    if (pending && step === 'preview') {
      try {
        const { localSecretKey, localPublicKey, secret } = JSON.parse(pending);

        // Check if callback page already connected for us
        const storedPubkey = localStorage.getItem('nip46_connected_pubkey');

        if (storedPubkey) {
          // Connection succeeded on callback page - recreate it
          connectionStatus = 'waiting';
          localKeypair = { secretKey: localSecretKey, publicKey: localPublicKey };
          connectionSecret = secret;
          step = 'connect';

          try {
            connectionURI = createConnectionURI(localPublicKey, secret, false);
            const connection = await waitForConnection(
              localSecretKey,
              secret,
              connectionURI,
              null,
              30000 // short timeout - already approved
            );

            nip46Connection = connection;
            connectedPubkey = storedPubkey;
            connectionStatus = 'connected';

            // Clean up
            localStorage.removeItem('nip46_pending');
            localStorage.removeItem('nip46_connected_pubkey');

            // Verify the connected pubkey matches the target
            await verifyPubkey();
            return;
          } catch (err) {
            console.error('Failed to recreate connection:', err);
            // Fall through to normal flow
            localStorage.removeItem('nip46_connected_pubkey');
          }
        }

        // No stored pubkey or recreation failed - restore waiting state
        localKeypair = { secretKey: localSecretKey, publicKey: localPublicKey };
        connectionSecret = secret;
        connectionURI = createConnectionURI(localPublicKey, secret, false);
        mobileConnectionURI = createConnectionURI(localPublicKey, secret, true);
        qrCodeDataUrl = await generateQRCode(connectionURI);
        connectionStatus = 'waiting';
        // Go to connect step to show waiting UI
        step = 'connect';
        waitForPrimalConnection();
      } catch (err) {
        console.error('Failed to restore NIP-46 connection:', err);
        localStorage.removeItem('nip46_pending');
        localStorage.removeItem('nip46_connected_pubkey');
      }
    }
  });

  onDestroy(() => {
    if (nip46Connection) {
      closeConnection(nip46Connection);
    }
  });

  async function loadProposal() {
    try {
      const response = await fetch(`/api/proposals/${token}`);

      if (response.status === 404) {
        error = 'This proposal was not found.';
        step = 'error';
        return;
      }

      if (response.status === 410) {
        error = 'This proposal has expired.';
        step = 'error';
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load proposal');
      }

      const data = await response.json();

      if (data.status === 'claimed') {
        error = 'This migration has already been completed.';
        step = 'error';
        return;
      }

      if (data.status === 'pending' || data.status === 'processing') {
        error = 'This proposal is still being prepared. Please check back in a few minutes.';
        step = 'error';
        return;
      }

      // Ensure arrays are present with defaults
      proposal = {
        ...data,
        proposal_type: data.proposal_type || 'posts',
        posts: data.posts || [],
        articles: data.articles || []
      };
      step = 'preview';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load proposal';
      step = 'error';
    }
  }

  async function startConnect() {
    step = 'connect';
    await initNIP46Connection();
  }

  async function initNIP46Connection() {
    try {
      connectionStatus = 'waiting';
      connectionError = '';
      localKeypair = generateLocalKeypair();
      connectionSecret = generateSecret();

      // QR code URI (no callback - for desktop scanning)
      connectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret, false);

      // Mobile button URI (with callback - redirects back after approval via /login-success)
      mobileConnectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret, true);

      // Save connection state for redirect recovery
      if (typeof window !== 'undefined') {
        localStorage.setItem('nip46_pending', JSON.stringify({
          localSecretKey: localKeypair.secretKey,
          localPublicKey: localKeypair.publicKey,
          secret: connectionSecret
        }));
        // Store return URL now (on:click may not fire before iOS switches apps)
        localStorage.setItem('nip46_return_url', window.location.href);
      }

      qrCodeDataUrl = await generateQRCode(connectionURI);
      waitForPrimalConnection();
    } catch (err) {
      connectionStatus = 'error';
      connectionError = err instanceof Error ? err.message : 'Failed to initialize';
    }
  }

  async function waitForPrimalConnection() {
    if (!localKeypair || !connectionURI) return;

    try {
      const connection = await waitForConnection(
        localKeypair.secretKey,
        connectionSecret,
        connectionURI,
        () => { connectionStatus = 'waiting'; }
      );

      nip46Connection = connection;
      connectedPubkey = connection.remotePubkey;
      connectionStatus = 'connected';

      // Clear pending connection state
      localStorage.removeItem('nip46_pending');

      // Verify the connected pubkey matches the target
      await verifyPubkey();
    } catch (err) {
      connectionStatus = 'error';
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }
  }

  async function verifyPubkey() {
    if (!proposal || !connectedPubkey) return;

    try {
      const response = await fetch(`/api/proposals/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          pubkeyHex: connectedPubkey
        })
      });

      const data = await response.json();

      if (!data.valid) {
        step = 'verify_error';
        error = data.error || 'This migration was prepared for a different Nostr account.';
        return;
      }

      // Verified! Set up tasks for included posts and articles
      postTasks = includedPosts.map(post => ({ post, status: 'pending' }));
      articleTasks = includedArticles.map(article => ({ article, status: 'pending' }));
      step = 'publishing';
      await startPublishing();
    } catch (err) {
      step = 'error';
      error = err instanceof Error ? err.message : 'Verification failed';
    }
  }

  // Collect signed events for batch import to Primal cache
  let signedEvents: Event[] = [];
  let publishedPostIds: number[] = [];
  let publishedArticleIds: number[] = [];

  async function startPublishing() {
    if (!nip46Connection || !proposal) return;

    // Sign sequentially - NIP-46 signers overwrite timestamps when processing
    // multiple concurrent requests. Sequential signing preserves original dates.
    const CONCURRENCY = 4;
    signedEvents = [];
    publishedPostIds = [];
    publishedArticleIds = [];

    try {
      // Process posts first
      if (postTasks.length > 0) {
        const postQueue: number[] = [...Array(postTasks.length).keys()];

        async function processPostQueue() {
          while (postQueue.length > 0) {
            const index = postQueue.shift();
            if (index !== undefined) {
              activePostIndices.add(index);
              activePostIndices = activePostIndices;
              await publishPost(index);
              activePostIndices.delete(index);
              activePostIndices = activePostIndices;
            }
          }
        }

        const postWorkers = Array(CONCURRENCY).fill(null).map(() => processPostQueue());
        await Promise.all(postWorkers);
      }

      // Then process articles
      if (articleTasks.length > 0) {
        const articleQueue: number[] = [...Array(articleTasks.length).keys()];

        async function processArticleQueue() {
          while (articleQueue.length > 0) {
            const index = articleQueue.shift();
            if (index !== undefined) {
              activeArticleIndices.add(index);
              activeArticleIndices = activeArticleIndices;
              await publishArticle(index);
              activeArticleIndices.delete(index);
              activeArticleIndices = activeArticleIndices;
            }
          }
        }

        const articleWorkers = Array(CONCURRENCY).fill(null).map(() => processArticleQueue());
        await Promise.all(articleWorkers);
      }

      // Batch import all events to Primal cache (fire and forget)
      if (signedEvents.length > 0) {
        importToPrimalCache(signedEvents).catch(() => {});
      }

      // Batch mark all posts as published
      if (publishedPostIds.length > 0) {
        await fetch(`/api/proposals/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'markPostsPublished',
            postIds: publishedPostIds
          })
        });
      }

      // Batch mark all articles as published
      if (publishedArticleIds.length > 0) {
        await fetch(`/api/proposals/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'markArticlesPublished',
            articleIds: publishedArticleIds
          })
        });
      }

      // Mark proposal as claimed
      await fetch(`/api/proposals/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          pubkeyHex: connectedPubkey
        })
      });

      step = 'complete';
    } catch (err) {
      console.error('Publishing error:', err);
    }
  }

  async function publishPost(index: number) {
    const task = postTasks[index];
    if (!nip46Connection || !proposal) return;

    try {
      postTasks[index] = { ...task, status: 'signing' };
      postTasks = [...postTasks];

      // Build media uploads from blossom URLs
      const mediaUploads: MediaUpload[] = task.post.blossom_urls.map((url) => ({
        url,
        sha256: url.split('/').pop() || '', // Extract hash from URL
        mimeType: task.post.post_type === 'reel' ? 'video/mp4' : 'image/jpeg',
        size: 0, // Not needed for posting
        width: undefined,
        height: undefined
      }));

      // Create post event - use edited caption if available
      const caption = editedCaptions[task.post.id] ?? task.post.caption;
      const postEvent = createMultiMediaPostEvent(
        connectedPubkey,
        mediaUploads,
        caption || undefined,
        task.post.original_date || undefined
      );

      // Sign with NIP-46
      const signedPost = await signWithNIP46(nip46Connection, postEvent);

      // Small delay between signings to help signer preserve timestamps
      await new Promise(resolve => setTimeout(resolve, 100));

      postTasks[index] = { ...postTasks[index], status: 'publishing' };
      postTasks = [...postTasks];

      // Publish to relays
      const publishResult = await publishToRelays(signedPost, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      // Collect for batch operations at the end
      signedEvents.push(signedPost);
      publishedPostIds.push(task.post.id);

      postTasks[index] = { ...postTasks[index], status: 'complete' };
      postTasks = [...postTasks];

    } catch (err) {
      console.error(`Error publishing post ${index}:`, err);
      postTasks[index] = {
        ...postTasks[index],
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error'
      };
      postTasks = [...postTasks];
    }
  }

  async function publishArticle(index: number) {
    const task = articleTasks[index];
    if (!nip46Connection || !proposal) return;

    try {
      articleTasks[index] = { ...task, status: 'signing' };
      articleTasks = [...articleTasks];

      // Use edited title if available
      const title = editedArticleTitles[task.article.id] ?? task.article.title;

      // Create identifier from link or title
      const identifier = task.article.link
        ? task.article.link.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 100)
        : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);

      // Create article event
      // published_at is already a Unix timestamp string from the backend
      const articleEvent = createLongFormContentEvent(connectedPubkey, {
        identifier,
        title,
        summary: task.article.summary || undefined,
        imageUrl: task.article.blossom_image_url || task.article.image_url || undefined,
        publishedAt: task.article.published_at || undefined,
        hashtags: task.article.hashtags,
        content: task.article.content_markdown
      });

      // Sign with NIP-46
      const signedArticle = await signWithNIP46(nip46Connection, articleEvent);

      // Small delay between signings
      await new Promise(resolve => setTimeout(resolve, 100));

      articleTasks[index] = { ...articleTasks[index], status: 'publishing' };
      articleTasks = [...articleTasks];

      // Publish to relays
      const publishResult = await publishToRelays(signedArticle, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      // Collect for batch operations at the end
      signedEvents.push(signedArticle);
      publishedArticleIds.push(task.article.id);

      articleTasks[index] = { ...articleTasks[index], status: 'complete' };
      articleTasks = [...articleTasks];

    } catch (err) {
      console.error(`Error publishing article ${index}:`, err);
      articleTasks[index] = {
        ...articleTasks[index],
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error'
      };
      articleTasks = [...articleTasks];
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Waiting';
      case 'signing': return 'Signing';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Done';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }

  function openPostDetail(index: number) {
    if (!proposal) return;
    selectedPostIndex = index;
    const post = proposal.posts[index];
    // Use edited caption if exists, otherwise original
    editingCaption = editedCaptions[post.id] ?? post.caption ?? '';
  }

  function closePostDetail() {
    selectedPostIndex = null;
    editingCaption = '';
  }

  function saveCaption() {
    if (selectedPostIndex === null || !proposal) return;
    const post = proposal.posts[selectedPostIndex];
    editedCaptions[post.id] = editingCaption;
    editedCaptions = editedCaptions; // trigger reactivity
    closePostDetail();
  }

  function getPostCaption(post: ProposalPost): string {
    return editedCaptions[post.id] ?? post.caption ?? '';
  }

  function isPostEdited(post: ProposalPost): boolean {
    return post.id in editedCaptions;
  }

  function isPostExcluded(post: ProposalPost): boolean {
    return excludedPosts.has(post.id);
  }

  function toggleExclude(post: ProposalPost) {
    if (excludedPosts.has(post.id)) {
      excludedPosts.delete(post.id);
    } else {
      excludedPosts.add(post.id);
    }
    excludedPosts = excludedPosts; // trigger reactivity
    closePostDetail();
  }

  function getMediaPreviewUrl(post: ProposalPost): string | null {
    // For thumbnails in the grid, prefer the thumbnail_url (smaller file size)
    // Only use blossom_urls[0] for images, never for videos in thumbnails
    if (post.thumbnail_url) {
      return post.thumbnail_url;
    }
    // For images only, fall back to blossom URL (avoid loading full videos)
    if (post.post_type !== 'reel' && post.blossom_urls && Array.isArray(post.blossom_urls) && post.blossom_urls.length > 0) {
      return post.blossom_urls[0];
    }
    // No preview available
    return null;
  }

  // Article editing functions
  function openArticleDetail(index: number) {
    if (!proposal) return;
    selectedArticleIndex = index;
    const article = proposal.articles[index];
    editingArticleTitle = editedArticleTitles[article.id] ?? article.title;
  }

  function closeArticleDetail() {
    selectedArticleIndex = null;
    editingArticleTitle = '';
  }

  function saveArticleTitle() {
    if (selectedArticleIndex === null || !proposal) return;
    const article = proposal.articles[selectedArticleIndex];
    editedArticleTitles[article.id] = editingArticleTitle;
    editedArticleTitles = editedArticleTitles; // trigger reactivity
    closeArticleDetail();
  }

  function getArticleTitle(article: ProposalArticle): string {
    return editedArticleTitles[article.id] ?? article.title;
  }

  function isArticleEdited(article: ProposalArticle): boolean {
    return article.id in editedArticleTitles;
  }

  function isArticleExcluded(article: ProposalArticle): boolean {
    return excludedArticles.has(article.id);
  }

  function toggleArticleExclude(article: ProposalArticle) {
    if (excludedArticles.has(article.id)) {
      excludedArticles.delete(article.id);
    } else {
      excludedArticles.add(article.id);
    }
    excludedArticles = excludedArticles; // trigger reactivity
    closeArticleDetail();
  }

  function getArticlePreviewImage(article: ProposalArticle): string | null {
    return article.blossom_image_url || article.image_url || null;
  }
</script>

<svelte:head>
  <title>Welcome to Primal</title>
</svelte:head>

<div class="claim-page">
  <main>
    {#if step === 'loading'}
      <div class="loading-step">
        <div class="spinner-large"></div>
        <p>Loading your migration...</p>
      </div>

    {:else if step === 'error'}
      <div class="error-step">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h2>Unable to Load</h2>
        <p class="error-msg">{error}</p>
        <a href="/" class="secondary-btn">Go to Homepage</a>
      </div>

    {:else if step === 'preview' && proposal}
      <div class="preview-step">
        {#if proposal.prepared_by}
          <div class="prepared-by">
            {#if proposal.prepared_by.picture}
              <img src={proposal.prepared_by.picture} alt="" class="prepared-by-pic" />
            {:else}
              <div class="prepared-by-pic placeholder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            {/if}
            <span class="prepared-by-text">Prepared by <strong>{proposal.prepared_by.name || proposal.prepared_by.npub.slice(0, 12) + '...'}</strong></span>
          </div>
        {/if}
        <div class="gift-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 12 20 22 4 22 4 12"/>
            <rect x="2" y="7" width="20" height="5"/>
            <line x1="12" y1="22" x2="12" y2="7"/>
            <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/>
            <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
          </svg>
        </div>
        <h2>Your Content is Ready!</h2>
        <p class="subtitle">
          {#if proposal.proposal_type === 'articles'}
            Someone prepared your RSS content for Nostr
          {:else if proposal.proposal_type === 'combined'}
            Someone prepared your @{proposal.handle} posts + articles for Nostr
          {:else}
            Someone prepared your @{proposal.handle} content for Nostr
          {/if}
        </p>

        <div class="summary-card">
          <div class="summary-row">
            <span class="label">
              {#if proposal.proposal_type === 'articles'}
                From RSS
              {:else}
                From Instagram
              {/if}
            </span>
            <span class="value">
              {#if proposal.proposal_type === 'articles' && proposal.feed}
                {proposal.feed.title || proposal.handle}
              {:else}
                @{proposal.handle}
              {/if}
            </span>
          </div>
          <div class="summary-row">
            <span class="label">Content</span>
            <span class="value">
              {#if proposal.proposal_type === 'posts' || proposal.proposal_type === 'combined'}
                {includedPostCount} of {proposal.posts.length} posts
                {#if excludedPosts.size > 0}
                  <span class="excluded-note">({excludedPosts.size} removed)</span>
                {/if}
              {/if}
              {#if proposal.proposal_type === 'combined'}
                ,
              {/if}
              {#if proposal.proposal_type === 'articles' || proposal.proposal_type === 'combined'}
                {includedArticleCount} of {proposal.articles.length} articles
                {#if excludedArticles.size > 0}
                  <span class="excluded-note">({excludedArticles.size} removed)</span>
                {/if}
              {/if}
            </span>
          </div>
          <div class="summary-row">
            <span class="label">Publishing to</span>
            <span class="value mono">{proposal.targetNpub.slice(0, 20)}...</span>
          </div>
        </div>

        <!-- Posts preview -->
        {#if proposal.posts.length > 0}
          <div class="posts-preview">
            <div class="preview-header">
              <span>Posts</span>
              <span class="edit-hint">Tap to edit or remove</span>
            </div>
            <div class="preview-grid">
              {#each proposal.posts as post, i}
                <button
                  class="preview-item"
                  class:excluded={isPostExcluded(post)}
                  on:click={() => openPostDetail(i)}
                >
                  {#if getMediaPreviewUrl(post)}
                    <img src={getMediaPreviewUrl(post)} alt="" loading="lazy" decoding="async" />
                  {:else}
                    <div class="placeholder">
                      {#if post.post_type === 'reel'}
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                      {:else}
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <path d="M21 15l-5-5L5 21"/>
                        </svg>
                      {/if}
                    </div>
                  {/if}
                  {#if isPostExcluded(post)}
                    <div class="excluded-overlay">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </div>
                  {:else}
                    {#if isPostEdited(post)}
                      <div class="edited-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                      </div>
                    {/if}
                    <div class="hover-overlay">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </div>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Articles preview -->
        {#if proposal.articles.length > 0}
          <div class="articles-preview">
            <div class="preview-header">
              <span>Articles</span>
              <span class="edit-hint">Tap to edit or remove</span>
            </div>
            <div class="articles-list">
              {#each proposal.articles as article, i}
                <button
                  class="article-item"
                  class:excluded={isArticleExcluded(article)}
                  on:click={() => openArticleDetail(i)}
                >
                  {#if getArticlePreviewImage(article)}
                    <img src={getArticlePreviewImage(article)} alt="" class="article-thumb" loading="lazy" />
                  {:else}
                    <div class="article-thumb placeholder">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                  {/if}
                  <div class="article-info">
                    <span class="article-title">{getArticleTitle(article)}</span>
                    {#if article.summary}
                      <span class="article-summary">{article.summary.slice(0, 80)}{article.summary.length > 80 ? '...' : ''}</span>
                    {/if}
                  </div>
                  {#if isArticleExcluded(article)}
                    <div class="article-excluded-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </div>
                  {:else if isArticleEdited(article)}
                    <div class="article-edited-badge">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    </div>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <button class="primary-btn" on:click={startConnect}>
          Connect Primal to Claim
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>

        <p class="disclaimer">
          You'll sign this content with Primal. Only the account matching the target npub can claim it.
        </p>
      </div>

    {:else if step === 'connect'}
      <div class="connect-step">
        <h2>Connect with Primal</h2>
        <p class="subtitle">Sign your posts with Primal</p>

        <div class="qr-container">
          {#if connectionStatus === 'connected'}
            <div class="connected-state">
              <div class="success-ring">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <span class="connected-label">Connected</span>
              <p class="verifying">Verifying your identity...</p>
            </div>
          {:else if connectionStatus === 'error'}
            <div class="error-state">
              <p class="error-text">{connectionError}</p>
              <button class="retry-btn" on:click={initNIP46Connection}>Try Again</button>
            </div>
          {:else if qrCodeDataUrl}
            <!-- Login with Primal button for mobile (includes callback for redirect) -->
            <a
              href={mobileConnectionURI}
              class="primal-login-btn"
              aria-label="Login with Primal"
              on:click={() => localStorage.setItem('nip46_return_url', window.location.href)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Login with Primal
            </a>

            <div class="divider">
              <span>or scan QR code</span>
            </div>

            <div class="qr-wrapper">
              <img src={qrCodeDataUrl} alt="Scan with Primal" class="qr-code" />
            </div>
            <div class="waiting-indicator">
              <div class="pulse-dot"></div>
              <span>Waiting for connection...</span>
            </div>
          {:else}
            <div class="loading-state">
              <div class="qr-spinner"></div>
              <span>Generating QR code...</span>
            </div>
          {/if}
        </div>
      </div>

    {:else if step === 'verify_error'}
      <div class="verify-error-step">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <h2>Wrong Account</h2>
        <p class="error-msg">{error}</p>
        <p class="expected">Expected: {proposal?.targetNpub.slice(0, 24)}...</p>
        <p class="got">Connected: {hexToNpub(connectedPubkey).slice(0, 24)}...</p>
        <button class="secondary-btn" on:click={startConnect}>Try Different Account</button>
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <div class="migrating-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 2l4 4-4 4"/>
            <path d="M3 11v-1a4 4 0 014-4h14"/>
            <path d="M7 22l-4-4 4-4"/>
            <path d="M21 13v1a4 4 0 01-4 4H3"/>
          </svg>
        </div>
        <h2>Publishing Your Content</h2>
        <p class="subtitle">Primal is signing your content</p>

        <div class="progress-card">
          <div class="progress-header">
            <span>{completedCount} / {totalCount} items</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progressPercent}%"></div>
          </div>
        </div>

        <!-- Post tasks -->
        {#if postTasks.length > 0}
          <div class="tasks-section">
            <div class="tasks-section-header">Posts</div>
            <div class="tasks-list">
              {#each postTasks as task, i}
                <div
                  class="task-item"
                  class:active={activePostIndices.has(i)}
                  class:complete={task.status === 'complete'}
                  class:error={task.status === 'error'}
                >
                  <div class="task-status">
                    {#if task.status === 'complete'}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    {:else if task.status === 'error'}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    {:else if ['signing', 'publishing'].includes(task.status)}
                      <div class="task-spinner"></div>
                    {:else}
                      <div class="task-pending"></div>
                    {/if}
                  </div>
                  <span class="task-caption">{task.post.caption?.slice(0, 30) || 'Untitled'}</span>
                  <span class="task-label">{getStatusLabel(task.status)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Article tasks -->
        {#if articleTasks.length > 0}
          <div class="tasks-section">
            <div class="tasks-section-header">Articles</div>
            <div class="tasks-list">
              {#each articleTasks as task, i}
                <div
                  class="task-item"
                  class:active={activeArticleIndices.has(i)}
                  class:complete={task.status === 'complete'}
                  class:error={task.status === 'error'}
                >
                  <div class="task-status">
                    {#if task.status === 'complete'}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    {:else if task.status === 'error'}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    {:else if ['signing', 'publishing'].includes(task.status)}
                      <div class="task-spinner"></div>
                    {:else}
                      <div class="task-pending"></div>
                    {/if}
                  </div>
                  <span class="task-caption">{task.article.title.slice(0, 30)}</span>
                  <span class="task-label">{getStatusLabel(task.status)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

    {:else if step === 'complete'}
      <div class="complete-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Welcome to Primal!</h2>
        <p class="subtitle">Your content is now yours forever on Nostr</p>

        <div class="stats-card">
          {#if completedPostCount > 0}
            <div class="stat">
              <span class="stat-value">{completedPostCount}</span>
              <span class="stat-label">posts published</span>
            </div>
          {/if}
          {#if completedArticleCount > 0}
            <div class="stat">
              <span class="stat-value">{completedArticleCount}</span>
              <span class="stat-label">articles published</span>
            </div>
          {/if}
        </div>

        <a
          href="https://primal.net/p/{proposal?.targetNpub}"
          target="_blank"
          rel="noopener noreferrer"
          class="primary-btn"
        >
          View on Primal
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        <div class="success-message">
          <p>You now own your content on the open social web.</p>
          <p>No algorithms. No gatekeepers. Just you.</p>
        </div>
      </div>
    {/if}
  </main>

  {#if selectedPost}
    <div class="modal-backdrop" on:click={closePostDetail} on:keydown={(e) => e.key === 'Escape' && closePostDetail()} role="button" tabindex="-1">
      <div class="post-modal" on:click|stopPropagation role="dialog" aria-modal="true" tabindex="0">
        <div class="modal-header">
          <h3>Edit Post</h3>
          <button class="close-btn" on:click={closePostDetail} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="modal-media">
          {#if selectedPost.post_type === 'reel'}
            <video
              src={selectedPost.blossom_urls[0]}
              controls
              playsinline
              preload="metadata"
              poster={selectedPost.thumbnail_url || ''}
              class="media-preview"
            >
              <track kind="captions" />
            </video>
          {:else}
            <img
              src={selectedPost.blossom_urls[0]}
              alt=""
              loading="eager"
              decoding="async"
              class="media-preview"
            />
          {/if}
        </div>

        <div class="modal-body">
          <label for="caption-edit">Caption</label>
          <textarea
            id="caption-edit"
            bind:value={editingCaption}
            placeholder="Add a caption..."
            rows="4"
          ></textarea>
          {#if selectedPost.original_date}
            <div class="post-date">
              Originally posted: {new Date(selectedPost.original_date).toLocaleDateString()}
            </div>
          {/if}
        </div>

        <div class="modal-footer">
          <button
            class="delete-btn"
            class:restore={isPostExcluded(selectedPost)}
            on:click={() => toggleExclude(selectedPost)}
          >
            {#if isPostExcluded(selectedPost)}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
              Restore Post
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
              Remove Post
            {/if}
          </button>
          <div class="modal-actions">
            <button class="secondary-btn" on:click={closePostDetail}>Cancel</button>
            <button class="primary-btn small" on:click={saveCaption}>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if selectedArticle}
    <div class="modal-backdrop" on:click={closeArticleDetail} on:keydown={(e) => e.key === 'Escape' && closeArticleDetail()} role="button" tabindex="-1">
      <div class="post-modal article-modal" on:click|stopPropagation role="dialog" aria-modal="true" tabindex="0">
        <div class="modal-header">
          <h3>Edit Article</h3>
          <button class="close-btn" on:click={closeArticleDetail} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {#if getArticlePreviewImage(selectedArticle)}
          <div class="modal-media">
            <img
              src={getArticlePreviewImage(selectedArticle)}
              alt=""
              loading="eager"
              decoding="async"
              class="media-preview"
            />
          </div>
        {/if}

        <div class="modal-body">
          <label for="article-title-edit">Title</label>
          <input
            id="article-title-edit"
            type="text"
            bind:value={editingArticleTitle}
            placeholder="Article title..."
            class="title-input"
          />

          {#if selectedArticle.summary}
            <div class="article-summary-preview">
              <label>Summary</label>
              <p>{selectedArticle.summary}</p>
            </div>
          {/if}

          <div class="article-content-preview">
            <label>Content Preview</label>
            <p class="content-excerpt">{selectedArticle.content_markdown.slice(0, 200)}...</p>
          </div>

          {#if selectedArticle.published_at}
            <div class="post-date">
              Originally published: {new Date(parseInt(selectedArticle.published_at) * 1000).toLocaleDateString()}
            </div>
          {/if}
        </div>

        <div class="modal-footer">
          <button
            class="delete-btn"
            class:restore={isArticleExcluded(selectedArticle)}
            on:click={() => toggleArticleExclude(selectedArticle)}
          >
            {#if isArticleExcluded(selectedArticle)}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
              Restore Article
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
              Remove Article
            {/if}
          </button>
          <div class="modal-actions">
            <button class="secondary-btn" on:click={closeArticleDetail}>Cancel</button>
            <button class="primary-btn small" on:click={saveArticleTitle}>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .claim-page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    font-weight: 700;
    font-size: 1.125rem;
    color: var(--text-primary);
    text-decoration: none;
  }

  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 2rem;
  }

  /* Loading */
  .loading-step {
    text-align: center;
    padding: 4rem 0;
  }

  .spinner-large {
    width: 3rem;
    height: 3rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1.5rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Error */
  .error-step, .verify-error-step {
    text-align: center;
    padding: 2rem 0;
  }

  .error-icon {
    width: 5rem;
    height: 5rem;
    background: rgba(var(--error-rgb, 239, 68, 68), 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--error, #ef4444);
    margin: 0 auto 1.5rem;
  }

  .error-msg {
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }

  .expected, .got {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-family: 'SF Mono', Monaco, monospace;
    margin: 0.25rem 0;
  }

  /* Preview */
  .preview-step {
    text-align: center;
  }

  .prepared-by {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border-radius: 2rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .prepared-by-pic {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
  }

  .prepared-by-pic.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    color: var(--text-muted);
  }

  .prepared-by-text strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .gift-icon {
    width: 4rem;
    height: 4rem;
    background: var(--accent-gradient);
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  .summary-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .summary-row:last-child {
    border-bottom: none;
  }

  .summary-row .label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .summary-row .value {
    font-weight: 500;
    font-size: 0.875rem;
  }

  .summary-row .value.mono {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75rem;
  }

  .posts-preview {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 1rem 1.5rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .primary-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(var(--accent-rgb), 0.4);
  }

  .secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .secondary-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .disclaimer {
    margin-top: 1rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /* Connect */
  .connect-step {
    text-align: center;
  }

  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 300px;
    justify-content: center;
    padding: 2rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
  }

  .qr-wrapper {
    padding: 1rem;
    background: white;
    border-radius: 1rem;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  }

  .qr-code {
    display: block;
    width: 200px;
    height: 200px;
    border-radius: 0.5rem;
  }

  .waiting-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  .connected-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .success-ring {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, var(--success), #00A855);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .connected-label {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--success);
  }

  .verifying {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .error-state {
    text-align: center;
  }

  .error-text {
    color: var(--error);
    margin-bottom: 1rem;
  }

  .retry-btn {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    color: var(--text-secondary);
  }

  .qr-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  /* Publishing */
  .publishing-step {
    text-align: center;
  }

  .migrating-icon {
    width: 3.5rem;
    height: 3.5rem;
    background: rgba(var(--accent-rgb), 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    margin: 0 auto 1rem;
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.2); }
    50% { box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0); }
  }

  .progress-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }

  .progress-bar {
    height: 6px;
    background: var(--bg-primary);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent-gradient);
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 250px;
    overflow-y: auto;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }

  .task-item.active {
    border-color: var(--accent);
  }

  .task-item.complete {
    border-color: var(--success);
  }

  .task-item.error {
    border-color: var(--error);
  }

  .task-status {
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .task-item.complete .task-status {
    color: var(--success);
  }

  .task-item.error .task-status {
    color: var(--error);
  }

  .task-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--border-light);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .task-pending {
    width: 0.5rem;
    height: 0.5rem;
    background: var(--text-muted);
    border-radius: 50%;
  }

  .task-caption {
    flex: 1;
    font-size: 0.8125rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-label {
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .task-item.active .task-label {
    color: var(--accent);
  }

  .task-item.complete .task-label {
    color: var(--success);
  }

  /* Complete */
  .complete-step {
    text-align: center;
    padding: 2rem 0;
  }

  .success-icon {
    width: 5rem;
    height: 5rem;
    background: linear-gradient(135deg, var(--success), #00A855);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  .stats-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stat-value {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--accent);
  }

  .stat-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .success-message {
    margin-top: 1.5rem;
    padding: 1rem;
    background: rgba(var(--success-rgb), 0.1);
    border-radius: 0.75rem;
  }

  .success-message p {
    margin: 0.25rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  /* Updated preview styles */
  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8125rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .edit-hint {
    font-size: 0.6875rem;
    font-weight: 400;
    color: var(--text-muted);
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 2px;
  }

  button.preview-item {
    position: relative;
    aspect-ratio: 1;
    background: var(--bg-primary);
    overflow: hidden;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .preview-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s ease;
  }

  .preview-item:hover img {
    transform: scale(1.05);
  }

  .hover-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .preview-item:hover .hover-overlay {
    opacity: 1;
  }

  .edited-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    background: var(--success);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .post-modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 1rem;
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-media {
    background: black;
  }

  .media-preview {
    display: block;
    width: 100%;
    max-height: 350px;
    object-fit: contain;
  }

  .modal-body {
    padding: 1.25rem;
  }

  .modal-body label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }

  .modal-body textarea {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    resize: vertical;
    min-height: 100px;
  }

  .modal-body textarea:focus {
    border-color: var(--accent);
    outline: none;
  }

  .post-date {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .primary-btn.small {
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
  }

  /* Excluded posts */
  .preview-item.excluded {
    opacity: 0.5;
  }

  .preview-item.excluded img {
    filter: grayscale(0.8);
  }

  .preview-item.excluded:hover img {
    transform: none;
  }

  .excluded-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--error, #ef4444);
  }

  .excluded-note {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 400;
  }

  /* Modal footer updates */
  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
  }

  .delete-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: transparent;
    border: 1px solid var(--error, #ef4444);
    border-radius: 0.75rem;
    color: var(--error, #ef4444);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .delete-btn:hover {
    background: rgba(var(--error-rgb, 239, 68, 68), 0.1);
  }

  .delete-btn.restore {
    border-color: var(--success);
    color: var(--success);
  }

  .delete-btn.restore:hover {
    background: rgba(var(--success-rgb), 0.1);
  }

  /* Login with Primal button */
  .primal-login-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 50%, #D946EF 100%);
    border: none;
    border-radius: 0.875rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
    box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
  }

  .primal-login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
  }

  .primal-login-btn:active {
    transform: translateY(0);
  }

  .primal-login-btn svg {
    flex-shrink: 0;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 1.5rem 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* Articles preview */
  .articles-preview {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .articles-list {
    display: flex;
    flex-direction: column;
  }

  button.article-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    transition: background 0.2s ease;
  }

  button.article-item:last-child {
    border-bottom: none;
  }

  button.article-item:hover {
    background: var(--bg-primary);
  }

  button.article-item.excluded {
    opacity: 0.5;
  }

  .article-thumb {
    width: 48px;
    height: 48px;
    border-radius: 0.5rem;
    object-fit: cover;
    flex-shrink: 0;
  }

  .article-thumb.placeholder {
    background: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .article-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .article-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .article-summary {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .article-excluded-badge {
    width: 24px;
    height: 24px;
    background: rgba(var(--error-rgb, 239, 68, 68), 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--error, #ef4444);
    flex-shrink: 0;
  }

  .article-edited-badge {
    width: 24px;
    height: 24px;
    background: var(--success);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }

  /* Article modal */
  .article-modal .title-input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
  }

  .article-modal .title-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .article-summary-preview,
  .article-content-preview {
    margin-top: 1rem;
  }

  .article-summary-preview label,
  .article-content-preview label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }

  .article-summary-preview p,
  .article-content-preview p {
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.4;
    margin: 0;
  }

  .content-excerpt {
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Tasks section for publishing */
  .tasks-section {
    margin-bottom: 1rem;
  }

  .tasks-section-header {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
    padding-left: 0.25rem;
  }

  /* Stats card multiple stats */
  .stats-card {
    display: flex;
    gap: 2rem;
    justify-content: center;
  }

  .stat + .stat {
    padding-left: 2rem;
    border-left: 1px solid var(--border);
  }
</style>
