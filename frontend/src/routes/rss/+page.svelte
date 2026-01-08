<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
    createBlossomAuthEvent,
    createLongFormContentEvent,
    signWithNIP46,
    createBlossomAuthHeader,
    calculateSHA256,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type ArticleMetadata
  } from '$lib/signing';
  import { generateSecretKey, getPublicKey, finalizeEvent, type EventTemplate, type Event } from 'nostr-tools';

  type Step = 'input' | 'fetching' | 'select' | 'connect' | 'publishing' | 'done';

  interface Article {
    id: string;
    title: string;
    summary?: string;
    content_markdown: string;
    content_html?: string;
    published_at?: string;
    link?: string;
    image_url?: string;
    hashtags: string[];
    inline_images: string[];
    selected: boolean;
  }

  interface FeedMeta {
    title: string;
    description?: string;
    link?: string;
    image_url?: string;
  }

  interface TempKeypair {
    publicKey: string;
    secretKey: Uint8Array;
  }

  interface TaskStatus {
    article: Article;
    status: 'pending' | 'uploading' | 'signing' | 'publishing' | 'complete' | 'error';
    blossomImageUrl?: string;
    nostrEventId?: string;
    error?: string;
  }

  let step: Step = 'input';
  let feedUrl = '';
  let articles: Article[] = [];
  let fetchedArticles: Article[] = [];
  let feedMeta: FeedMeta | null = null;
  let fetchCount = 0;
  let error = '';
  let abortController: AbortController | null = null;

  // NIP-46 connection state
  let qrCodeDataUrl = '';
  let connectionSecret = '';
  let connectionURI = '';
  let mobileConnectionURI = '';
  let localKeypair: { secretKey: string; publicKey: string } | null = null;
  let connectionStatus: 'idle' | 'waiting' | 'connected' | 'error' = 'idle';
  let connectionError = '';
  let nip46Connection: NIP46Connection | null = null;
  let nip46Pubkey: string | null = null;

  // Publishing state
  let tasks: TaskStatus[] = [];
  let isProcessing = false;
  let publishedEvents: Event[] = [];

  const BLOSSOM_SERVER = 'https://blossom.primal.net';
  const CONCURRENCY = 2;
  const SIGN_TIMEOUT = 30000;
  const SIGN_RETRIES = 2;
  let signingQueue: Promise<void> = Promise.resolve();

  $: selectedArticles = articles.filter(a => a.selected);
  $: selectedCount = selectedArticles.length;
  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: errorCount = tasks.filter(t => t.status === 'error').length;
  $: progressPercent = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
  $: allDone = completedCount + errorCount === tasks.length && tasks.length > 0;

  function generateTempKeypair(): TempKeypair {
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);
    return { publicKey, secretKey };
  }

  function signBlossomAuthLocally(event: Omit<Event, 'sig'>, secretKey: Uint8Array): Event {
    return finalizeEvent(event as EventTemplate, secretKey);
  }

  function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Signing timeout')), ms)
      )
    ]);
  }

  async function withSigningQueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = signingQueue.then(async () => {
      await delay(500);
      return fn();
    });
    signingQueue = result.then(() => {}, () => {});
    return result;
  }

  async function signWithRetry(event: Parameters<typeof signWithNIP46>[1]): Promise<Event> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= SIGN_RETRIES; attempt++) {
      try {
        return await withTimeout(signWithNIP46(nip46Connection!, event), SIGN_TIMEOUT);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Sign failed');
        console.warn(`Sign attempt ${attempt + 1} failed:`, lastError.message);
        if (attempt < SIGN_RETRIES) {
          await delay(1000);
        }
      }
    }
    throw lastError;
  }

  function reset() {
    step = 'input';
    feedUrl = '';
    articles = [];
    fetchedArticles = [];
    feedMeta = null;
    fetchCount = 0;
    error = '';
    tasks = [];
    publishedEvents = [];
  }

  async function fetchFeed() {
    if (!feedUrl.trim()) return;

    step = 'fetching';
    error = '';
    articles = [];
    fetchedArticles = [];
    fetchCount = 0;
    abortController = new AbortController();

    try {
      const response = await fetch(`/api/rss-stream?feed_url=${encodeURIComponent(feedUrl.trim())}`, {
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch feed');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Streaming not supported');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.progress === true) {
                fetchCount = data.count;
                if (data.articles) {
                  fetchedArticles = data.articles;
                }
                if (data.feed) {
                  feedMeta = data.feed;
                }
              } else if (typeof data.progress === 'string') {
                // Text progress update
              }

              if (data.done) {
                if (!data.articles || data.articles.length === 0) {
                  throw new Error('No articles found in this feed');
                }

                articles = (data.articles || []).map((a: any) => ({ ...a, selected: true }));
                feedMeta = data.feed || null;
                step = 'select';
                return;
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
                throw parseErr;
              }
            }
          }
        }
      }

      throw new Error('Stream ended unexpectedly');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      error = err instanceof Error ? err.message : 'An error occurred';
      step = 'input';
    } finally {
      abortController = null;
    }
  }

  function pauseFetch() {
    if (!abortController || fetchedArticles.length === 0) return;
    abortController.abort();
    articles = fetchedArticles.map((a: any) => ({ ...a, selected: true }));
    step = 'select';
  }

  function toggleArticle(id: string) {
    articles = articles.map(a => a.id === id ? { ...a, selected: !a.selected } : a);
  }

  function selectAll() {
    articles = articles.map(a => ({ ...a, selected: true }));
  }

  function deselectAll() {
    articles = articles.map(a => ({ ...a, selected: false }));
  }

  function proceedToConnect() {
    if (selectedCount === 0) return;
    step = 'connect';
    initNIP46Connection();
  }

  async function initNIP46Connection() {
    try {
      connectionStatus = 'waiting';
      connectionError = '';
      localKeypair = generateLocalKeypair();
      connectionSecret = generateSecret();

      connectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret, false);
      const callbackUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      mobileConnectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret, true, callbackUrl);

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('nip46_pending_rss', JSON.stringify({
          localSecretKey: localKeypair.secretKey,
          localPublicKey: localKeypair.publicKey,
          secret: connectionSecret
        }));
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
      nip46Pubkey = connection.remotePubkey;
      connectionStatus = 'connected';
      sessionStorage.removeItem('nip46_pending_rss');
    } catch (err) {
      connectionStatus = 'error';
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }
  }

  async function retryConnection() {
    if (nip46Connection) {
      closeConnection(nip46Connection);
      nip46Connection = null;
    }
    nip46Pubkey = null;
    await initNIP46Connection();
  }

  function startPublishing() {
    if (connectionStatus !== 'connected' || !nip46Connection || !nip46Pubkey) return;
    step = 'publishing';
    tasks = selectedArticles.map(article => ({
      article,
      status: 'pending'
    }));
    publishArticles();
  }

  async function publishArticles() {
    if (isProcessing) return;
    isProcessing = true;

    const tempKeypair = generateTempKeypair();

    try {
      const queue: number[] = [...Array(tasks.length).keys()];

      async function processQueue() {
        while (queue.length > 0) {
          const index = queue.shift();
          if (index !== undefined) {
            await processArticle(index, tempKeypair);
          }
        }
      }

      const workers = Array(CONCURRENCY).fill(null).map(() => processQueue());
      await Promise.all(workers);

      // Import all published events to Primal cache
      if (publishedEvents.length > 0) {
        await importToPrimalCache(publishedEvents);
      }
    } catch (err) {
      console.error('Publishing error:', err);
    } finally {
      isProcessing = false;
    }
  }

  async function processArticle(index: number, tempKeypair: TempKeypair) {
    const task = tasks[index];

    try {
      // Step 1: Upload header image if exists
      tasks[index].status = 'uploading';
      tasks = tasks;

      let headerImageUrl: string | undefined;
      if (task.article.image_url) {
        try {
          headerImageUrl = await uploadImage(task.article.image_url, tempKeypair);
          tasks[index].blossomImageUrl = headerImageUrl;
          tasks = tasks;
        } catch (err) {
          console.warn('Failed to upload header image:', err);
          // Continue without header image
        }
      }

      // Step 2: Process inline images in content
      let processedContent = task.article.content_markdown;
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      const imageReplacements: { original: string; blossom: string }[] = [];

      // Collect all images first
      const imagesToUpload: string[] = [];
      while ((match = imageRegex.exec(task.article.content_markdown)) !== null) {
        const imageUrl = match[2];
        if (!imagesToUpload.includes(imageUrl)) {
          imagesToUpload.push(imageUrl);
        }
      }

      // Upload each unique image
      for (const imageUrl of imagesToUpload) {
        try {
          const blossomUrl = await uploadImage(imageUrl, tempKeypair);
          imageReplacements.push({ original: imageUrl, blossom: blossomUrl });
        } catch (err) {
          console.warn('Failed to upload inline image:', imageUrl, err);
        }
      }

      // Replace all occurrences
      for (const { original, blossom } of imageReplacements) {
        processedContent = processedContent.split(original).join(blossom);
      }

      // Step 3: Create and sign the event
      tasks[index].status = 'signing';
      tasks = tasks;

      const articleData: ArticleMetadata = {
        identifier: task.article.id,
        title: task.article.title,
        summary: task.article.summary,
        imageUrl: headerImageUrl,
        publishedAt: task.article.published_at,
        hashtags: task.article.hashtags,
        content: processedContent
      };

      const eventTemplate = createLongFormContentEvent(nip46Pubkey!, articleData);

      const signedEvent = await withSigningQueue(() => signWithRetry(eventTemplate));

      // Step 4: Publish to relays
      tasks[index].status = 'publishing';
      tasks = tasks;

      const publishResult = await publishToRelays(signedEvent, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      tasks[index].nostrEventId = signedEvent.id;
      tasks[index].status = 'complete';
      tasks = tasks;

      publishedEvents.push(signedEvent);
    } catch (err) {
      console.error('Error processing article:', err);
      tasks[index].status = 'error';
      tasks[index].error = err instanceof Error ? err.message : 'Unknown error';
      tasks = tasks;
    }
  }

  async function uploadImage(imageUrl: string, tempKeypair: TempKeypair): Promise<string> {
    // Fetch image through our proxy
    const response = await fetch('/api/proxy-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch image');
    }

    const imageData = await response.arrayBuffer();
    const sha256 = await calculateSHA256(imageData);
    const size = imageData.byteLength;

    // Determine content type
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Create and sign Blossom auth event locally
    const authEvent = createBlossomAuthEvent(tempKeypair.publicKey, sha256, size);
    const signedAuth = signBlossomAuthLocally(authEvent, tempKeypair.secretKey);
    const authHeader = createBlossomAuthHeader(signedAuth);

    // Upload to Blossom
    const uploadResponse = await fetch(`${BLOSSOM_SERVER}/upload`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': contentType,
        'X-SHA-256': sha256
      },
      body: imageData
    });

    if (!uploadResponse.ok) {
      throw new Error('Blossom upload failed');
    }

    const result = await uploadResponse.json();
    return result.url || `${BLOSSOM_SERVER}/${sha256}`;
  }

  function viewOnPrimal() {
    if (nip46Pubkey) {
      const npub = hexToNpub(nip46Pubkey);
      window.open(`https://primal.net/p/${npub}/reads`, '_blank');
    }
  }

  function formatDate(dateStr: string): string {
    try {
      const timestamp = parseInt(dateStr, 10);
      if (!isNaN(timestamp)) {
        return new Date(timestamp * 1000).toLocaleDateString();
      }
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return '';
    }
  }

  function estimateReadTime(content: string): string {
    const words = content.split(/\s+/).length;
    const minutes = Math.ceil(words / 200);
    return `${minutes} min read`;
  }

  onMount(async () => {
    // Check for pending NIP-46 connection from redirect
    const pending = sessionStorage.getItem('nip46_pending_rss');
    if (pending && step === 'connect') {
      try {
        const { localSecretKey, localPublicKey, secret } = JSON.parse(pending);
        localKeypair = { secretKey: localSecretKey, publicKey: localPublicKey };
        connectionSecret = secret;
        connectionURI = createConnectionURI(localPublicKey, secret, false);
        mobileConnectionURI = createConnectionURI(localPublicKey, secret, true, window.location.href);
        qrCodeDataUrl = await generateQRCode(connectionURI);
        connectionStatus = 'waiting';
        waitForPrimalConnection();
      } catch (err) {
        console.error('Failed to restore NIP-46 connection:', err);
        sessionStorage.removeItem('nip46_pending_rss');
      }
    }
  });

  onDestroy(() => {
    if (nip46Connection) {
      closeConnection(nip46Connection);
    }
  });
</script>

<svelte:head>
  <title>Import RSS Feed | Own Your Posts</title>
</svelte:head>

<div class="rss-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
    <span class="badge">RSS Import</span>
  </header>

  <main>
    {#if step === 'input'}
      <div class="input-step">
        <h1>Import RSS Feed</h1>
        <p class="subtitle">Publish your blog posts as long-form articles on Nostr</p>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <form on:submit|preventDefault={fetchFeed}>
          <div class="input-group">
            <label for="feedUrl">RSS Feed URL</label>
            <input
              id="feedUrl"
              type="url"
              bind:value={feedUrl}
              placeholder="https://yourblog.substack.com/feed"
              autocomplete="off"
            />
            <span class="input-hint">Works with Substack, WordPress, Medium, and any RSS/Atom feed</span>
          </div>

          <button type="submit" class="primary-btn" disabled={!feedUrl.trim()}>
            Fetch Articles
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>

        <div class="examples">
          <h3>Examples</h3>
          <ul>
            <li><code>username.substack.com/feed</code></li>
            <li><code>yourblog.com/feed</code></li>
            <li><code>medium.com/feed/@username</code></li>
          </ul>
        </div>
      </div>

    {:else if step === 'fetching'}
      <div class="fetching-step">
        <div class="spinner-large"></div>
        <h2>Fetching articles...</h2>
        <p class="count">{fetchCount} articles found</p>
        {#if fetchedArticles.length > 0}
          <button class="secondary-btn" on:click={pauseFetch}>
            Continue with {fetchedArticles.length} articles
          </button>
        {/if}
      </div>

    {:else if step === 'select'}
      <div class="select-step">
        <div class="select-header">
          <div>
            <h2>{feedMeta?.title || 'Select Articles'}</h2>
            {#if feedMeta?.description}
              <p class="subtitle">{feedMeta.description}</p>
            {/if}
          </div>
          <button class="back-btn" on:click={reset}>Start Over</button>
        </div>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <div class="toolbar">
          <div class="selection-badge" class:has-selection={selectedCount > 0}>
            <span class="count">{selectedCount}</span>
            <span class="label">of {articles.length} selected</span>
          </div>
          <div class="toolbar-actions">
            <button class="text-btn" on:click={selectAll}>Select All</button>
            <button class="text-btn" on:click={deselectAll}>Clear</button>
          </div>
        </div>

        <div class="articles-list">
          {#each articles as article (article.id)}
            <button class="article-card" class:selected={article.selected} on:click={() => toggleArticle(article.id)}>
              {#if article.image_url}
                <div class="article-image">
                  <img src={article.image_url} alt="" loading="lazy" />
                </div>
              {/if}
              <div class="article-content">
                <h3>{article.title}</h3>
                {#if article.summary}
                  <p class="summary">{article.summary}</p>
                {/if}
                <div class="article-meta">
                  {#if article.published_at}
                    <span class="date">{formatDate(article.published_at)}</span>
                  {/if}
                  <span class="read-time">{estimateReadTime(article.content_markdown)}</span>
                  {#if article.hashtags.length > 0}
                    <span class="tags">{article.hashtags.slice(0, 3).map(t => `#${t}`).join(' ')}</span>
                  {/if}
                </div>
              </div>
              <div class="select-indicator" class:checked={article.selected}>
                {#if article.selected}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                {/if}
              </div>
            </button>
          {/each}
        </div>

        <div class="actions">
          <div class="total-selected">
            <strong>{selectedCount}</strong> articles selected
          </div>
          <button class="primary-btn" disabled={selectedCount === 0} on:click={proceedToConnect}>
            Continue
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>

    {:else if step === 'connect'}
      <div class="connect-step">
        <h2>Connect Your Nostr Wallet</h2>
        <p class="subtitle">Sign in with Primal to publish articles to your account</p>

        <div class="qr-section">
          {#if connectionStatus === 'connected'}
            <div class="connected-state">
              <div class="success-ring">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <span class="connected-label">Connected</span>
              <code class="pubkey">{hexToNpub(nip46Pubkey || '').slice(0, 24)}...</code>

              <button class="primary-btn" on:click={startPublishing}>
                Publish {selectedCount} Articles
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          {:else if connectionStatus === 'error'}
            <div class="error-state">
              <p class="error-text">{connectionError}</p>
              <button class="retry-btn" on:click={retryConnection}>Try Again</button>
            </div>
          {:else if qrCodeDataUrl}
            <a href={mobileConnectionURI} class="primal-login-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Log in with Primal
            </a>

            <div class="qr-divider">
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

        <button class="back-link" on:click={() => step = 'select'}>Back to selection</button>
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <h2>Publishing Articles</h2>

        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>
        <p class="progress-text">{completedCount} of {tasks.length} complete</p>

        <div class="tasks-list">
          {#each tasks as task (task.article.id)}
            <div class="task-item" class:complete={task.status === 'complete'} class:error={task.status === 'error'}>
              <div class="task-status">
                {#if task.status === 'complete'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                {:else if task.status === 'error'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M15 9l-6 6M9 9l6 6"/>
                  </svg>
                {:else if task.status === 'pending'}
                  <div class="status-dot pending"></div>
                {:else}
                  <div class="spinner-small"></div>
                {/if}
              </div>
              <div class="task-info">
                <span class="task-title">{task.article.title}</span>
                <span class="task-status-text">
                  {#if task.status === 'uploading'}Uploading images...
                  {:else if task.status === 'signing'}Signing...
                  {:else if task.status === 'publishing'}Publishing...
                  {:else if task.status === 'complete'}Published
                  {:else if task.status === 'error'}{task.error}
                  {:else}Waiting...
                  {/if}
                </span>
              </div>
            </div>
          {/each}
        </div>

        {#if allDone}
          <div class="done-actions">
            <button class="primary-btn" on:click={viewOnPrimal}>
              View on Primal
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
            <button class="secondary-btn" on:click={reset}>Import More</button>
          </div>
        {/if}
      </div>

    {:else if step === 'done'}
      <div class="done-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Articles Published!</h2>
        <p class="subtitle">{completedCount} articles are now on Nostr</p>

        <div class="done-actions">
          <button class="primary-btn" on:click={viewOnPrimal}>
            View on Primal
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button class="secondary-btn" on:click={reset}>Import More</button>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .rss-page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
    text-decoration: none;
  }

  .badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: white;
    border-radius: 999px;
  }

  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  h1, h2 {
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  h1 { font-size: 1.75rem; }
  h2 { font-size: 1.5rem; }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .input-group {
    margin-bottom: 1.25rem;
  }

  .input-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .input-group input {
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 1rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .input-hint {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.875rem 1.5rem;
    background: var(--accent-gradient);
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
    box-shadow: 0 4px 20px rgba(var(--accent-rgb), 0.4);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary-btn {
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .secondary-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .examples {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .examples h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }

  .examples ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .examples li {
    padding: 0.5rem 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .examples code {
    background: var(--bg-tertiary);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-family: monospace;
  }

  .fetching-step, .connect-step, .publishing-step, .done-step {
    text-align: center;
    padding: 2rem 0;
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

  .spinner-small {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .count {
    color: var(--text-secondary);
    font-size: 1.125rem;
    margin-bottom: 1rem;
  }

  .select-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .back-btn {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .back-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
  }

  .selection-badge {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }

  .selection-badge .count {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .selection-badge.has-selection .count {
    color: var(--accent);
  }

  .selection-badge .label {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .toolbar-actions {
    display: flex;
    gap: 0.5rem;
  }

  .text-btn {
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: none;
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .text-btn:hover {
    text-decoration: underline;
  }

  .articles-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .article-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 2px solid transparent;
    border-radius: 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
    width: 100%;
  }

  .article-card:hover {
    border-color: var(--border-light);
  }

  .article-card.selected {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .article-image {
    width: 80px;
    height: 80px;
    border-radius: 0.5rem;
    overflow: hidden;
    flex-shrink: 0;
  }

  .article-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .article-content {
    flex: 1;
    min-width: 0;
  }

  .article-content h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .article-content .summary {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .select-indicator {
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .select-indicator.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .total-selected {
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .actions .primary-btn {
    width: auto;
  }

  .qr-section {
    padding: 2rem;
    background: var(--bg-tertiary);
    border-radius: 1rem;
    margin-bottom: 1.5rem;
  }

  .connected-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
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

  .pubkey {
    font-size: 0.75rem;
    background: var(--bg-primary);
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    color: var(--text-secondary);
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .error-text {
    color: var(--error);
    font-size: 0.875rem;
  }

  .retry-btn {
    padding: 0.5rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .primal-login-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1.25rem;
    background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 50%, #D946EF 100%);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
  }

  .qr-divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .qr-divider::before,
  .qr-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .qr-wrapper {
    padding: 1rem;
    background: white;
    border-radius: 1rem;
    display: inline-block;
  }

  .qr-code {
    display: block;
    width: 180px;
    height: 180px;
  }

  .waiting-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
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

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .qr-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .back-link {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
    text-decoration: underline;
  }

  .progress-bar {
    width: 100%;
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
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }

  .tasks-list {
    text-align: left;
    margin-bottom: 1.5rem;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .task-item.complete {
    background: rgba(16, 185, 129, 0.1);
  }

  .task-item.error {
    background: rgba(239, 68, 68, 0.1);
  }

  .task-status {
    width: 1.5rem;
    height: 1.5rem;
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

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
  }

  .status-dot.pending {
    background: var(--text-muted);
  }

  .task-info {
    flex: 1;
    min-width: 0;
  }

  .task-title {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-status-text {
    display: block;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .done-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
  }

  .done-actions .primary-btn {
    width: auto;
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
</style>
