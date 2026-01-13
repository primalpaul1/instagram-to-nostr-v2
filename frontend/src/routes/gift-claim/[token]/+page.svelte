<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools';
  import { nip19 } from 'nostr-tools';
  import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
  import {
    createMultiMediaPostEvent,
    createProfileEvent,
    createLongFormContentEvent,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload,
    type ArticleMetadata
  } from '$lib/signing';

  type PageStep = 'loading' | 'preview' | 'publishing' | 'complete' | 'error';

  interface GiftPost {
    id: number;
    post_type: 'reel' | 'image' | 'carousel';
    caption: string | null;
    original_date: string | null;
    thumbnail_url: string | null;
    blossom_urls: string[];
    status: string;
  }

  interface GiftArticle {
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

  interface Feed {
    url: string;
    title?: string;
    description?: string;
    image_url?: string;
  }

  interface Gift {
    status: string;
    gift_type: 'posts' | 'articles';
    handle: string;
    profile: Profile | null;
    feed: Feed | null;
    posts: GiftPost[];
    articles: GiftArticle[];
  }

  interface Keypair {
    privateKeyHex: string;
    privateKeyBytes: Uint8Array;
    publicKeyHex: string;
    nsec: string;
    npub: string;
  }

  let step: PageStep = 'loading';
  let gift: Gift | null = null;
  let error = '';

  // Key state
  let keypair: Keypair | null = null;
  let nsecCopied = false;
  let keyDownloaded = false;

  // Publishing state
  interface PostTaskStatus {
    type: 'post';
    post: GiftPost;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  interface ArticleTaskStatus {
    type: 'article';
    article: GiftArticle;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  type TaskStatus = PostTaskStatus | ArticleTaskStatus;
  let tasks: TaskStatus[] = [];

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  $: isArticleGift = gift?.gift_type === 'articles';
  $: itemCount = isArticleGift ? gift?.articles?.length || 0 : gift?.posts?.length || 0;

  const token = $page.params.token;

  onMount(async () => {
    await loadGift();
  });

  function generateKeypair(): Keypair {
    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const privateKeyHex = bytesToHex(privateKeyBytes);
    const publicKeyHex = getPublicKey(privateKeyBytes);

    return {
      privateKeyHex,
      privateKeyBytes,
      publicKeyHex,
      nsec: nip19.nsecEncode(privateKeyBytes),
      npub: nip19.npubEncode(publicKeyHex)
    };
  }

  async function loadGift() {
    try {
      const response = await fetch(`/api/gifts/${token}`);

      if (response.status === 404) {
        error = 'This gift was not found.';
        step = 'error';
        return;
      }

      if (response.status === 410) {
        error = 'This gift has expired.';
        step = 'error';
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load gift');
      }

      const data = await response.json();

      if (data.status === 'claimed') {
        error = 'This gift has already been claimed.';
        step = 'error';
        return;
      }

      if (data.status === 'pending' || data.status === 'processing') {
        error = 'This gift is still being prepared. Please check back in a few minutes.';
        step = 'error';
        return;
      }

      // Ensure arrays exist to prevent undefined errors
      gift = {
        ...data,
        posts: data.posts || [],
        articles: data.articles || []
      };
      step = 'preview';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load gift';
      step = 'error';
    }
  }

  async function claimAccount() {
    if (!gift) return;

    // Generate a random keypair
    keypair = generateKeypair();

    // Go directly to publishing
    step = 'publishing';
    await startPublishing();
  }

  function copyNsec() {
    if (!keypair) return;
    navigator.clipboard.writeText(keypair.nsec);
    nsecCopied = true;
    setTimeout(() => nsecCopied = false, 2000);
  }

  function downloadKey() {
    if (!keypair) return;
    const blob = new Blob([keypair.nsec], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'primal-key.txt';
    a.click();
    URL.revokeObjectURL(url);
    keyDownloaded = true;
  }

  async function startPublishing() {
    if (!keypair || !gift) return;

    // Set up tasks based on gift type
    if (gift.gift_type === 'articles') {
      tasks = gift.articles.map(article => ({ type: 'article' as const, article, status: 'pending' as const }));
    } else {
      tasks = gift.posts.map(post => ({ type: 'post' as const, post, status: 'pending' as const }));
    }
    step = 'publishing';

    const signedEvents: any[] = [];
    const publishedIds: number[] = [];

    try {
      // First, publish profile if available (for post or article gifts)
      if (gift.profile) {
        const profileEvent = createProfileEvent(
          keypair.publicKeyHex,
          gift.profile.display_name || gift.profile.username,
          gift.profile.bio,
          gift.profile.profile_picture_url
        );

        const signedProfile = finalizeEvent(profileEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
        await publishToRelays(signedProfile, NOSTR_RELAYS);
        signedEvents.push(signedProfile);
      }

      // Process items sequentially
      for (let i = 0; i < tasks.length; i++) {
        tasks[i] = { ...tasks[i], status: 'signing' };
        tasks = [...tasks];

        const task = tasks[i];

        try {
          let signedEvent: any;

          if (task.type === 'article') {
            // Create long-form content event (kind 30023)
            const article = task.article;

            // Generate identifier from title (URL-safe slug)
            const identifier = article.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 50) + '-' + Date.now().toString(36);

            // Parse published_at to Unix timestamp
            let publishedAtTimestamp: string | undefined;
            if (article.published_at) {
              try {
                const date = new Date(article.published_at);
                if (!isNaN(date.getTime())) {
                  publishedAtTimestamp = Math.floor(date.getTime() / 1000).toString();
                }
              } catch {
                // Ignore parse errors
              }
            }

            const articleMetadata: ArticleMetadata = {
              identifier,
              title: article.title,
              summary: article.summary || undefined,
              imageUrl: article.blossom_image_url || article.image_url || undefined,
              publishedAt: publishedAtTimestamp,
              hashtags: article.hashtags || undefined,
              content: article.content_markdown
            };

            const articleEvent = createLongFormContentEvent(
              keypair.publicKeyHex,
              articleMetadata
            );

            signedEvent = finalizeEvent(articleEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
          } else {
            // Create post event (kind 1)
            const post = task.post;
            const mediaUploads: MediaUpload[] = post.blossom_urls.map(url => ({
              url,
              sha256: url.split('/').pop() || '',
              mimeType: post.post_type === 'reel' ? 'video/mp4' : 'image/jpeg',
              size: 0,
              width: undefined,
              height: undefined
            }));

            const postEvent = createMultiMediaPostEvent(
              keypair.publicKeyHex,
              mediaUploads,
              post.caption || undefined,
              post.original_date || undefined
            );

            signedEvent = finalizeEvent(postEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
          }

          tasks[i] = { ...tasks[i], status: 'publishing' };
          tasks = [...tasks];

          // Publish to relays
          const publishResult = await publishToRelays(signedEvent, NOSTR_RELAYS);

          if (publishResult.success.length === 0) {
            throw new Error('Failed to publish to any relay');
          }

          signedEvents.push(signedEvent);
          publishedIds.push(task.type === 'article' ? task.article.id : task.post.id);

          tasks[i] = { ...tasks[i], status: 'complete' };
          tasks = [...tasks];

        } catch (err) {
          console.error(`Error publishing item ${i}:`, err);
          tasks[i] = {
            ...tasks[i],
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error'
          };
          tasks = [...tasks];
        }

        // Small delay between items
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Batch import to Primal cache
      if (signedEvents.length > 0) {
        importToPrimalCache(signedEvents).catch(() => {});
      }

      // Mark items as published
      if (publishedIds.length > 0) {
        const action = gift.gift_type === 'articles' ? 'markArticlesPublished' : 'markPostsPublished';
        const idKey = gift.gift_type === 'articles' ? 'articleIds' : 'postIds';

        await fetch(`/api/gifts/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            [idKey]: publishedIds
          })
        });
      }

      // Mark gift as claimed
      await fetch(`/api/gifts/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      });

      step = 'complete';
    } catch (err) {
      console.error('Publishing error:', err);
      error = err instanceof Error ? err.message : 'Failed to publish';
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

  function getMediaPreviewUrl(post: GiftPost): string | null {
    if (post.thumbnail_url) {
      return post.thumbnail_url;
    }
    if (post.post_type !== 'reel' && post.blossom_urls && post.blossom_urls.length > 0) {
      return post.blossom_urls[0];
    }
    return null;
  }
</script>

<svelte:head>
  <title>Claim Your Posts | Own Your Posts</title>
</svelte:head>

<div class="gift-claim-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
  </header>

  <main>
    {#if step === 'loading'}
      <div class="loading-step">
        <div class="spinner-large"></div>
        <p>Loading your gift...</p>
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

    {:else if step === 'preview' && gift}
      <div class="preview-step">
        <div class="gift-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/>
            <path d="M17 3l4 4-8 8H9v-4l8-8z"/>
          </svg>
        </div>
        <h2>Claim Your Nostr Account</h2>
        {#if isArticleGift}
          <p class="subtitle">Your articles from {gift.feed?.title || 'RSS Feed'} are ready to publish on Nostr!</p>
        {:else}
          <p class="subtitle">Your @{gift.handle} content is ready to publish on Nostr!</p>
        {/if}

        {#if gift.profile}
          <div class="profile-preview">
            {#if gift.profile.profile_picture_url}
              <img src={gift.profile.profile_picture_url} alt={gift.profile.username} class="profile-pic" />
            {:else}
              <div class="profile-pic placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            {/if}
            <div class="profile-info">
              <span class="profile-name">{gift.profile.display_name || gift.profile.username}</span>
              <span class="profile-handle">@{gift.handle}</span>
            </div>
          </div>
        {/if}

        <div class="posts-preview">
          <span class="count">{itemCount}</span>
          <span class="label">{isArticleGift ? 'articles' : 'posts'} ready to publish</span>
        </div>

        {#if isArticleGift}
          <div class="articles-list-preview">
            {#each gift.articles.slice(0, 4) as article}
              <div class="article-preview-item">
                {#if article.blossom_image_url || article.image_url}
                  <img src={article.blossom_image_url || article.image_url} alt="" class="article-thumb" />
                {/if}
                <span class="article-title-preview">{article.title}</span>
              </div>
            {/each}
            {#if gift.articles.length > 4}
              <div class="more-articles">+{gift.articles.length - 4} more</div>
            {/if}
          </div>
        {:else}
          <div class="posts-grid">
            {#each gift.posts.slice(0, 6) as post}
              <div class="post-thumb">
                {#if post.thumbnail_url}
                  <img src={post.thumbnail_url} alt="" />
                {:else if post.blossom_urls && post.blossom_urls.length > 0 && post.post_type !== 'reel'}
                  <img src={post.blossom_urls[0]} alt="" />
                {:else}
                  <div class="placeholder">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    </svg>
                  </div>
                {/if}
                {#if post.post_type === 'reel'}
                  <div class="video-badge">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21"/>
                    </svg>
                  </div>
                {/if}
              </div>
            {/each}
            {#if gift.posts.length > 6}
              <div class="post-thumb more">
                <span>+{gift.posts.length - 6}</span>
              </div>
            {/if}
          </div>
        {/if}

        <button class="primary-btn" on:click={claimAccount}>
          Claim My Account
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <h2>Publishing Your {isArticleGift ? 'Articles' : 'Content'}</h2>
        <p class="subtitle">Signing and publishing to Nostr...</p>

        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>
        <p class="progress-text">{completedCount} of {totalCount} {isArticleGift ? 'articles' : 'posts'}</p>

        <div class="tasks-list">
          {#each tasks as task, index}
            <div class="task-item" class:active={task.status === 'signing' || task.status === 'publishing'} class:complete={task.status === 'complete'} class:error={task.status === 'error'}>
              <div class="task-preview">
                {#if task.type === 'article'}
                  {#if task.article.blossom_image_url || task.article.image_url}
                    <img src={task.article.blossom_image_url || task.article.image_url} alt="" />
                  {:else}
                    <div class="placeholder article-placeholder">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                  {/if}
                {:else}
                  {#if getMediaPreviewUrl(task.post)}
                    <img src={getMediaPreviewUrl(task.post)} alt="" />
                  {:else}
                    <div class="placeholder">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      </svg>
                    </div>
                  {/if}
                {/if}
              </div>
              <div class="task-info">
                {#if task.type === 'article'}
                  <span class="task-caption">{task.article.title.slice(0, 30)}{task.article.title.length > 30 ? '...' : ''}</span>
                {:else}
                  <span class="task-caption">{task.post.caption?.slice(0, 30) || 'No caption'}{(task.post.caption?.length || 0) > 30 ? '...' : ''}</span>
                {/if}
                <span class="task-status">{getStatusLabel(task.status)}</span>
              </div>
              <div class="task-indicator">
                {#if task.status === 'signing' || task.status === 'publishing'}
                  <div class="spinner-small"></div>
                {:else if task.status === 'complete'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                {:else if task.status === 'error'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                {:else}
                  <div class="pending-dot"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

    {:else if step === 'complete' && keypair}
      <div class="complete-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Welcome to Nostr!</h2>
        <p class="subtitle">Your account has been created and {completedCount} {isArticleGift ? 'articles' : 'posts'} published.</p>

        <a href="https://primal.net/p/{keypair.npub}" target="_blank" rel="noopener" class="view-profile-btn">
          View Your Profile on Primal
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        <div class="whats-next">
          <h3>What's Next?</h3>

          <div class="step-card">
            <div class="step-number">1</div>
            <div class="step-content">
              <h4>Save Your Key</h4>
              <p>This is your Nostr identity - keep it safe!</p>
              <div class="key-actions">
                <button class="action-btn" on:click={copyNsec}>
                  {#if nsecCopied}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                    Copied!
                  {:else}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                    Copy Key
                  {/if}
                </button>
                <button class="action-btn" on:click={downloadKey}>
                  {#if keyDownloaded}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                    Downloaded!
                  {:else}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download Key
                  {/if}
                </button>
              </div>
            </div>
          </div>

          <div class="step-card">
            <div class="step-number">2</div>
            <div class="step-content">
              <h4>Download Primal on your phone</h4>
              <p>Get the app to access your content anywhere</p>
              <div class="download-row">
                <div class="qr-wrapper">
                  <img
                    src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://primal.net/downloads&bgcolor=ffffff&color=000000"
                    alt="QR Code to download Primal"
                    width="120"
                    height="120"
                  />
                </div>
                <div class="store-buttons">
                  <a href="https://apps.apple.com/us/app/primal/id1673134518" target="_blank" rel="noopener noreferrer" class="store-btn">
                    <svg width="20" height="24" viewBox="0 0 20 24" fill="currentColor">
                      <path d="M16.52 12.46c-.03-2.59 2.11-3.84 2.21-3.9-1.21-1.76-3.08-2-3.75-2.03-1.58-.17-3.11.94-3.91.94-.82 0-2.06-.92-3.39-.9-1.72.03-3.33 1.02-4.22 2.57-1.82 3.14-.46 7.76 1.28 10.3.87 1.24 1.89 2.62 3.23 2.57 1.3-.05 1.79-.83 3.36-.83 1.56 0 2.01.83 3.37.8 1.4-.02 2.28-1.25 3.12-2.5 1-1.43 1.41-2.83 1.43-2.9-.03-.01-2.73-1.05-2.76-4.12h.03zM13.89 4.43c.7-.87 1.18-2.05 1.05-3.25-1.01.04-2.27.69-3 1.54-.64.76-1.22 2-1.07 3.17 1.14.08 2.31-.57 3.02-1.46z"/>
                    </svg>
                    <div class="store-text">
                      <span class="store-label">Download on the</span>
                      <span class="store-name">App Store</span>
                    </div>
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=net.primal.android" target="_blank" rel="noopener noreferrer" class="store-btn">
                    <svg width="20" height="22" viewBox="0 0 20 22" fill="currentColor">
                      <path d="M1 1.16v19.68c0 .67.74 1.07 1.32.71l16.36-9.84c.58-.35.58-1.17 0-1.51L2.32.36C1.74 0 1 .4 1 1.07v.09z"/>
                    </svg>
                    <div class="store-text">
                      <span class="store-label">Get it on</span>
                      <span class="store-name">Google Play</span>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div class="step-card">
            <div class="step-number">3</div>
            <div class="step-content">
              <h4>Log in with your key</h4>
              <p>Open Primal, tap "Login", then "Use login key" and paste your Primal Key</p>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .gift-claim-page {
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

  .loading-step {
    text-align: center;
    padding: 4rem 0;
  }

  .spinner-large {
    width: 3rem;
    height: 3rem;
    border: 3px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1.5rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-step {
    text-align: center;
    padding: 3rem 0;
  }

  .error-icon {
    width: 5rem;
    height: 5rem;
    background: rgba(239, 68, 68, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ef4444;
    margin: 0 auto 1.5rem;
  }

  .error-msg {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  .preview-step {
    text-align: center;
  }

  .gift-icon {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  .profile-preview {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .profile-pic {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .profile-pic.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-muted);
  }

  .profile-info {
    text-align: left;
  }

  .profile-name {
    display: block;
    font-weight: 600;
    color: var(--text-primary);
  }

  .profile-handle {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .posts-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .post-thumb {
    aspect-ratio: 1;
    border-radius: 0.5rem;
    overflow: hidden;
    position: relative;
    background: var(--bg-tertiary);
  }

  .post-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .post-thumb .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .post-thumb .video-badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 1.25rem;
    height: 1.25rem;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .post-thumb.more {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 0.875rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: 2rem;
    line-height: 1.5;
  }

  .posts-preview {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
  }

  .posts-preview .count {
    font-size: 2rem;
    font-weight: 700;
    color: #a855f7;
  }

  .posts-preview .label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .primary-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(168, 85, 247, 0.4);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary-btn {
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .secondary-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  /* Publishing step */
  .publishing-step {
    text-align: center;
  }

  .progress-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a855f7 0%, #8b5cf6 100%);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    transition: all 0.2s;
  }

  .task-item.active {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.05);
  }

  .task-item.complete {
    opacity: 0.7;
  }

  .task-item.error {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.05);
  }

  .task-preview {
    width: 3rem;
    height: 3rem;
    border-radius: 0.5rem;
    overflow: hidden;
    flex-shrink: 0;
  }

  .task-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .task-preview .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-muted);
  }

  .task-info {
    flex: 1;
    text-align: left;
    overflow: hidden;
  }

  .task-caption {
    display: block;
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-status {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .task-indicator {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .spinner-small {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .pending-dot {
    width: 0.5rem;
    height: 0.5rem;
    background: var(--border);
    border-radius: 50%;
  }

  .task-indicator svg {
    color: #22c55e;
  }

  .task-item.error .task-indicator svg {
    color: #ef4444;
  }

  /* Complete step */
  .complete-step {
    text-align: center;
  }

  .success-icon {
    width: 5rem;
    height: 5rem;
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  /* Enhanced complete step */
  .view-profile-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
    margin-bottom: 2rem;
  }

  .view-profile-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(168, 85, 247, 0.4);
  }

  .whats-next {
    text-align: left;
    margin-top: 1rem;
  }

  .whats-next h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-primary);
  }

  .step-card {
    display: flex;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .step-number {
    width: 2rem;
    height: 2rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.875rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .step-content {
    flex: 1;
  }

  .step-content h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }

  .step-content p {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .key-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  .download-row {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .qr-wrapper {
    background: white;
    padding: 0.5rem;
    border-radius: 0.5rem;
    flex-shrink: 0;
  }

  .qr-wrapper img {
    display: block;
  }

  .store-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
    min-width: 160px;
  }

  .store-btn {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    background: #000;
    border: 1px solid #333;
    border-radius: 0.5rem;
    color: white;
    text-decoration: none;
    transition: all 0.2s;
  }

  .store-btn:hover {
    background: #1a1a1a;
    border-color: #555;
  }

  .store-btn svg {
    flex-shrink: 0;
  }

  .store-text {
    display: flex;
    flex-direction: column;
    text-align: left;
  }

  .store-label {
    font-size: 0.625rem;
    color: #aaa;
    line-height: 1.2;
  }

  .store-name {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
  }

  /* Article preview styles */
  .articles-list-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .article-preview-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
  }

  .article-thumb {
    width: 3rem;
    height: 2.25rem;
    object-fit: cover;
    border-radius: 0.375rem;
    flex-shrink: 0;
  }

  .article-title-preview {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more-articles {
    text-align: center;
    padding: 0.5rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .article-placeholder {
    background: rgba(168, 85, 247, 0.1);
    color: #a855f7;
  }
</style>
