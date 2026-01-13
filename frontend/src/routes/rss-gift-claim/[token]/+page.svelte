<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
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
    createLongFormContentEvent,
    signWithNIP46,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type ArticleMetadata
  } from '$lib/signing';
  import type { Event } from 'nostr-tools';

  type PageStep = 'loading' | 'preview' | 'connect' | 'publishing' | 'complete' | 'error';

  interface Article {
    id: number;
    title: string;
    summary?: string;
    content_markdown: string;
    published_at?: string;
    link?: string;
    image_url?: string;
    blossom_image_url?: string;
    hashtags: string[];
    status: string;
  }

  interface RssGift {
    status: string;
    feed_url: string;
    feed_title?: string;
    feed_description?: string;
    feed_image_url?: string;
    articles: Article[];
  }

  let step: PageStep = 'loading';
  let gift: RssGift | null = null;
  let error = '';

  // NIP-46 connection state
  let qrCodeDataUrl = '';
  let connectionURI = '';
  let mobileConnectionURI = '';
  let localKeypair: { secretKey: string; publicKey: string } | null = null;
  let connectionStatus: 'idle' | 'waiting' | 'connected' | 'error' = 'idle';
  let nip46Connection: NIP46Connection | null = null;
  let nip46Pubkey: string | null = null;

  // Publishing state
  interface TaskStatus {
    article: Article;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  let tasks: TaskStatus[] = [];
  let publishedEvents: Event[] = [];

  const SIGN_TIMEOUT = 30000;

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: errorCount = tasks.filter(t => t.status === 'error').length;
  $: progressPercent = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
  $: allDone = completedCount + errorCount === tasks.length && tasks.length > 0;

  const token = $page.params.token;

  onMount(async () => {
    await loadGift();
  });

  onDestroy(() => {
    if (nip46Connection) {
      closeConnection(nip46Connection);
    }
  });

  async function loadGift() {
    try {
      const response = await fetch(`/api/rss-gifts/${token}`);

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

      gift = data;
      step = 'preview';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load gift';
      step = 'error';
    }
  }

  async function startConnect() {
    step = 'connect';
    connectionStatus = 'waiting';

    try {
      localKeypair = generateLocalKeypair();
      const secret = generateSecret();
      connectionURI = createConnectionURI(localKeypair.publicKey, secret);
      mobileConnectionURI = connectionURI.replace('nostrconnect://', 'primal://nostrconnect/');
      qrCodeDataUrl = await generateQRCode(connectionURI);

      const result = await waitForConnection(localKeypair, secret);
      nip46Connection = result.connection;
      nip46Pubkey = result.remotePubkey;
      connectionStatus = 'connected';

      // Start publishing
      await startPublishing();
    } catch (err) {
      connectionStatus = 'error';
      error = err instanceof Error ? err.message : 'Connection failed';
    }
  }

  async function startPublishing() {
    if (!nip46Connection || !nip46Pubkey || !gift) return;

    step = 'publishing';
    tasks = gift.articles.map(article => ({ article, status: 'pending' }));
    publishedEvents = [];
    const publishedArticleIds: number[] = [];

    for (let i = 0; i < tasks.length; i++) {
      tasks[i] = { ...tasks[i], status: 'signing' };
      tasks = [...tasks];

      const article = tasks[i].article;

      try {
        // Create long-form content event
        const metadata: ArticleMetadata = {
          title: article.title,
          summary: article.summary,
          image: article.blossom_image_url || article.image_url,
          publishedAt: article.published_at ? Math.floor(new Date(article.published_at).getTime() / 1000) : undefined,
          hashtags: article.hashtags
        };

        const articleEvent = createLongFormContentEvent(
          nip46Pubkey,
          article.content_markdown,
          metadata
        );

        // Sign with NIP-46
        const signedEvent = await signWithNIP46(
          nip46Connection,
          articleEvent,
          SIGN_TIMEOUT
        );

        tasks[i] = { ...tasks[i], status: 'publishing' };
        tasks = [...tasks];

        // Publish to relays
        const publishResult = await publishToRelays(signedEvent, NOSTR_RELAYS);

        if (publishResult.success.length === 0) {
          throw new Error('Failed to publish to any relay');
        }

        publishedEvents.push(signedEvent);
        publishedArticleIds.push(article.id);

        tasks[i] = { ...tasks[i], status: 'complete' };
        tasks = [...tasks];

      } catch (err) {
        console.error(`Error publishing article ${i}:`, err);
        tasks[i] = {
          ...tasks[i],
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error'
        };
        tasks = [...tasks];
      }

      // Small delay between articles
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Import to Primal cache
    if (publishedEvents.length > 0) {
      importToPrimalCache(publishedEvents).catch(() => {});
    }

    // Mark articles as published
    if (publishedArticleIds.length > 0) {
      await fetch(`/api/rss-gifts/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markArticlesPublished',
          articleIds: publishedArticleIds
        })
      });
    }

    // Mark gift as claimed
    await fetch(`/api/rss-gifts/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' })
    });

    step = 'complete';
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
</script>

<svelte:head>
  <title>Claim Articles | Own Your Posts</title>
</svelte:head>

<div class="claim-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
  </header>

  <main>
    {#if step === 'loading'}
      <div class="loading-step">
        <div class="spinner-large"></div>
        <p>Loading your articles...</p>
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
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
          </svg>
        </div>
        <h2>Claim Your Articles</h2>
        <p class="subtitle">
          {#if gift.feed_title}
            {gift.articles.length} articles from <strong>{gift.feed_title}</strong> are ready for you
          {:else}
            {gift.articles.length} articles are ready for you to claim
          {/if}
        </p>

        <div class="articles-preview">
          {#each gift.articles.slice(0, 5) as article}
            <div class="article-preview">
              {#if article.image_url || article.blossom_image_url}
                <img src={article.blossom_image_url || article.image_url} alt="" class="article-thumb" />
              {:else}
                <div class="article-thumb placeholder">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 9h6M9 13h6M9 17h4"/>
                  </svg>
                </div>
              {/if}
              <div class="article-info">
                <h4>{article.title}</h4>
                {#if article.published_at}
                  <span class="article-date">{new Date(article.published_at).toLocaleDateString()}</span>
                {/if}
              </div>
            </div>
          {/each}
          {#if gift.articles.length > 5}
            <div class="more-articles">
              +{gift.articles.length - 5} more articles
            </div>
          {/if}
        </div>

        <button class="primary-btn" on:click={startConnect}>
          Connect Primal to Claim
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

    {:else if step === 'connect'}
      <div class="connect-step">
        <h2>Connect Your Primal</h2>
        <p class="subtitle">Scan this QR code with your Primal app to sign the articles</p>

        {#if qrCodeDataUrl}
          <div class="qr-container">
            <img src={qrCodeDataUrl} alt="QR Code" class="qr-code" />
          </div>
        {/if}

        <a href={mobileConnectionURI} class="mobile-btn">
          Open Primal App
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        {#if connectionStatus === 'waiting'}
          <p class="status waiting">Waiting for connection...</p>
        {:else if connectionStatus === 'connected'}
          <p class="status connected">Connected! Publishing articles...</p>
        {:else if connectionStatus === 'error'}
          <p class="status error">{error}</p>
        {/if}
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <h2>Publishing Articles</h2>
        <p class="subtitle">Your articles are being published to Nostr</p>

        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>
        <p class="progress-text">{completedCount} of {tasks.length} articles</p>

        <div class="tasks-list">
          {#each tasks as task}
            <div class="task-item" class:active={task.status === 'signing' || task.status === 'publishing'} class:complete={task.status === 'complete'} class:error={task.status === 'error'}>
              <div class="task-info">
                <span class="task-title">{task.article.title.slice(0, 40)}{task.article.title.length > 40 ? '...' : ''}</span>
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

    {:else if step === 'complete' && nip46Pubkey}
      <div class="complete-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Articles Published!</h2>
        <p class="subtitle">{completedCount} articles are now on your Nostr profile</p>

        <a href="https://primal.net/p/{hexToNpub(nip46Pubkey)}" target="_blank" rel="noopener" class="primary-btn">
          View on Primal
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        <a href="/" class="secondary-btn">Back to Home</a>
      </div>
    {/if}
  </main>
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
    max-width: 500px;
    margin: 0 auto;
    padding: 2rem;
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

  /* Loading step */
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

  /* Error step */
  .error-step {
    text-align: center;
    padding: 3rem 0;
  }

  .error-icon {
    width: 5rem;
    height: 5rem;
    background: rgba(255, 75, 75, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--error);
    margin: 0 auto 1.5rem;
  }

  .error-msg {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  /* Preview step */
  .preview-step {
    text-align: center;
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

  .articles-preview {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 2rem;
    overflow: hidden;
  }

  .article-preview {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .article-preview:last-child {
    border-bottom: none;
  }

  .article-thumb {
    width: 3rem;
    height: 3rem;
    border-radius: 0.375rem;
    object-fit: cover;
    flex-shrink: 0;
  }

  .article-thumb.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    color: var(--text-muted);
  }

  .article-info {
    flex: 1;
    text-align: left;
    min-width: 0;
  }

  .article-info h4 {
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .article-date {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .more-articles {
    padding: 0.75rem 1rem;
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.875rem;
    background: var(--bg-secondary);
  }

  .primary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 2rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .primary-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(250, 60, 131, 0.4);
  }

  .secondary-btn {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }

  .secondary-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Connect step */
  .connect-step {
    text-align: center;
  }

  .qr-container {
    background: white;
    padding: 1rem;
    border-radius: 1rem;
    display: inline-block;
    margin-bottom: 1.5rem;
  }

  .qr-code {
    width: 200px;
    height: 200px;
    display: block;
  }

  .mobile-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--text-primary);
    text-decoration: none;
    font-size: 0.9375rem;
    margin-bottom: 1.5rem;
  }

  .mobile-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .status {
    font-size: 0.875rem;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
  }

  .status.waiting {
    color: var(--text-secondary);
  }

  .status.connected {
    color: var(--success);
    background: rgba(0, 210, 106, 0.1);
  }

  .status.error {
    color: var(--error);
    background: rgba(255, 75, 75, 0.1);
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
    background: var(--accent-gradient);
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
    max-height: 300px;
    overflow-y: auto;
    text-align: left;
  }

  .task-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    transition: all 0.2s;
  }

  .task-item.active {
    border-color: var(--accent);
    background: rgba(250, 60, 131, 0.05);
  }

  .task-item.complete {
    opacity: 0.7;
  }

  .task-item.error {
    border-color: var(--error);
    background: rgba(255, 75, 75, 0.05);
  }

  .task-info {
    flex: 1;
    min-width: 0;
  }

  .task-title {
    display: block;
    font-size: 0.8125rem;
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
    border-top-color: var(--accent);
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
    color: var(--success);
  }

  .task-item.error .task-indicator svg {
    color: var(--error);
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

  .complete-step .primary-btn {
    margin-bottom: 1rem;
  }
</style>
