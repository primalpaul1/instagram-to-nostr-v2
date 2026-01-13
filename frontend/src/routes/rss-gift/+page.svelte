<script lang="ts">
  import { generateSecretKey, getPublicKey, finalizeEvent, type EventTemplate } from 'nostr-tools';
  import { bytesToHex } from '@noble/hashes/utils';
  import {
    createBlossomAuthEvent,
    createBlossomAuthHeader,
    calculateSHA256
  } from '$lib/signing';

  type Step = 'input' | 'fetching' | 'select' | 'uploading' | 'done';

  interface Article {
    id: string;
    title: string;
    summary?: string;
    content_markdown: string;
    published_at?: string;
    link?: string;
    image_url?: string;
    blossom_image_url?: string;
    hashtags: string[];
    selected: boolean;
  }

  interface FeedMeta {
    title: string;
    description?: string;
    link?: string;
    image_url?: string;
  }

  let step: Step = 'input';
  let feedUrl = '';
  let articles: Article[] = [];
  let feedMeta: FeedMeta | null = null;
  let fetchCount = 0;
  let error = '';

  // Upload state
  let uploadProgress = 0;
  let uploadTotal = 0;

  // Result state
  let claimUrl = '';
  let copySuccess = false;

  const BLOSSOM_SERVER = 'https://blossom.primal.net';

  $: selectedArticles = articles.filter(a => a.selected);
  $: selectedCount = selectedArticles.length;

  async function fetchFeed() {
    if (!feedUrl.trim()) {
      error = 'Please enter a feed URL';
      return;
    }

    error = '';
    step = 'fetching';

    try {
      const response = await fetch(`/api/rss-stream?url=${encodeURIComponent(feedUrl)}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch feed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            if (event.type === 'meta') {
              feedMeta = event.data;
            } else if (event.type === 'article') {
              const article: Article = {
                id: event.data.id || crypto.randomUUID(),
                title: event.data.title,
                summary: event.data.summary,
                content_markdown: event.data.content_markdown,
                published_at: event.data.published_at,
                link: event.data.link,
                image_url: event.data.image_url,
                hashtags: event.data.hashtags || [],
                selected: true
              };
              articles = [...articles, article];
              fetchCount++;
            } else if (event.type === 'done') {
              step = 'select';
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (e) {
            console.error('Error parsing stream event:', e);
          }
        }
      }

      if (articles.length === 0) {
        throw new Error('No articles found in feed');
      }

      step = 'select';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to fetch feed';
      step = 'input';
    }
  }

  function toggleArticle(id: string) {
    articles = articles.map(a =>
      a.id === id ? { ...a, selected: !a.selected } : a
    );
  }

  function selectAll() {
    articles = articles.map(a => ({ ...a, selected: true }));
  }

  function deselectAll() {
    articles = articles.map(a => ({ ...a, selected: false }));
  }

  async function uploadImageToBlossom(imageUrl: string): Promise<string | null> {
    try {
      // Generate a temporary keypair for Blossom auth
      const secretKey = generateSecretKey();
      const publicKey = getPublicKey(secretKey);

      // Fetch the image
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) return null;

      const imageBlob = await imageResponse.blob();
      const imageBuffer = await imageBlob.arrayBuffer();
      const imageBytes = new Uint8Array(imageBuffer);

      // Calculate SHA256
      const sha256 = await calculateSHA256(imageBytes);

      // Create Blossom auth event
      const authEvent = createBlossomAuthEvent(publicKey, sha256, imageBytes.length);
      const signedAuth = finalizeEvent(authEvent as EventTemplate, secretKey);
      const authHeader = createBlossomAuthHeader(signedAuth);

      // Upload to Blossom
      const uploadResponse = await fetch(`${BLOSSOM_SERVER}/upload`, {
        method: 'PUT',
        headers: {
          'Content-Type': imageBlob.type || 'image/jpeg',
          'Authorization': authHeader
        },
        body: imageBytes
      });

      if (!uploadResponse.ok) return null;

      const uploadResult = await uploadResponse.json();
      return uploadResult.url || `${BLOSSOM_SERVER}/${sha256}`;
    } catch (err) {
      console.error('Error uploading image:', err);
      return null;
    }
  }

  async function createGift() {
    if (selectedCount === 0) {
      error = 'Please select at least one article';
      return;
    }

    error = '';
    step = 'uploading';
    uploadTotal = selectedArticles.filter(a => a.image_url).length;
    uploadProgress = 0;

    try {
      // Upload images to Blossom
      const articlesWithBlossom: Article[] = [];

      for (const article of selectedArticles) {
        let blossomImageUrl = article.blossom_image_url;

        if (article.image_url && !blossomImageUrl) {
          blossomImageUrl = await uploadImageToBlossom(article.image_url) || undefined;
          uploadProgress++;
        }

        articlesWithBlossom.push({
          ...article,
          blossom_image_url: blossomImageUrl
        });
      }

      // Create the RSS gift
      const response = await fetch('/api/rss-gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feed_url: feedUrl,
          feed_meta: feedMeta,
          articles: articlesWithBlossom.map(a => ({
            title: a.title,
            summary: a.summary,
            content_markdown: a.content_markdown,
            published_at: a.published_at,
            link: a.link,
            image_url: a.image_url,
            blossom_image_url: a.blossom_image_url,
            hashtags: a.hashtags
          }))
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to create gift');
      }

      const result = await response.json();
      claimUrl = result.claimUrl;
      step = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create gift';
      step = 'select';
    }
  }

  function copyClaimUrl() {
    navigator.clipboard.writeText(claimUrl);
    copySuccess = true;
    setTimeout(() => copySuccess = false, 2000);
  }

  function reset() {
    step = 'input';
    feedUrl = '';
    articles = [];
    feedMeta = null;
    fetchCount = 0;
    error = '';
    claimUrl = '';
  }
</script>

<svelte:head>
  <title>Gift Articles | Own Your Posts</title>
</svelte:head>

<div class="rss-gift-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
    <span class="badge">RSS Gift</span>
  </header>

  <main>
    {#if step === 'input'}
      <div class="input-step">
        <h1>Gift Articles</h1>
        <p class="subtitle">Prepare someone's RSS articles for them to claim on Primal</p>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <div class="input-group">
          <label for="feed-url">RSS Feed URL</label>
          <input
            id="feed-url"
            type="url"
            bind:value={feedUrl}
            placeholder="https://example.com/feed.xml"
            on:keydown={(e) => e.key === 'Enter' && fetchFeed()}
          />
        </div>

        <button class="primary-btn" on:click={fetchFeed}>
          Fetch Articles
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

    {:else if step === 'fetching'}
      <div class="fetching-step">
        <div class="spinner-large"></div>
        <h2>Fetching articles...</h2>
        <p class="count">{fetchCount} articles found</p>
      </div>

    {:else if step === 'select'}
      <div class="select-step">
        <div class="select-header">
          <div>
            <h2>Select Articles</h2>
            <p class="subtitle">{selectedCount} of {articles.length} selected</p>
          </div>
          <div class="select-actions">
            <button class="text-btn" on:click={selectAll}>Select all</button>
            <button class="text-btn" on:click={deselectAll}>Deselect all</button>
          </div>
        </div>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <div class="articles-list">
          {#each articles as article}
            <button
              class="article-card"
              class:selected={article.selected}
              on:click={() => toggleArticle(article.id)}
            >
              {#if article.image_url}
                <img src={article.image_url} alt="" class="article-thumb" />
              {:else}
                <div class="article-thumb placeholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 9h6M9 13h6M9 17h4"/>
                  </svg>
                </div>
              {/if}
              <div class="article-info">
                <h3>{article.title}</h3>
                {#if article.summary}
                  <p class="article-summary">{article.summary.slice(0, 100)}{article.summary.length > 100 ? '...' : ''}</p>
                {/if}
                {#if article.published_at}
                  <span class="article-date">{new Date(article.published_at).toLocaleDateString()}</span>
                {/if}
              </div>
              <div class="checkbox" class:checked={article.selected}>
                {#if article.selected}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                {/if}
              </div>
            </button>
          {/each}
        </div>

        <div class="action-bar">
          <button class="secondary-btn" on:click={reset}>Back</button>
          <button class="primary-btn" on:click={createGift} disabled={selectedCount === 0}>
            Create Gift Link
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>

    {:else if step === 'uploading'}
      <div class="uploading-step">
        <div class="spinner-large"></div>
        <h2>Preparing gift...</h2>
        {#if uploadTotal > 0}
          <p class="progress-text">Uploading images: {uploadProgress} / {uploadTotal}</p>
        {/if}
      </div>

    {:else if step === 'done'}
      <div class="done-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Gift Created!</h2>
        <p class="subtitle">Share this link with the recipient to claim their articles</p>

        <div class="claim-url-box">
          <input type="text" value={claimUrl} readonly />
          <button class="copy-btn" on:click={copyClaimUrl}>
            {#if copySuccess}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            {:else}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            {/if}
          </button>
        </div>

        <div class="gift-info">
          <span class="count">{selectedCount}</span>
          <span class="label">articles ready to claim</span>
        </div>

        <button class="secondary-btn" on:click={reset}>Create Another Gift</button>
      </div>
    {/if}
  </main>
</div>

<style>
  .rss-gift-page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    font-weight: 700;
    font-size: 1.125rem;
    color: var(--text-primary);
    text-decoration: none;
  }

  .badge {
    padding: 0.25rem 0.75rem;
    background: rgba(250, 60, 131, 0.15);
    border: 1px solid rgba(250, 60, 131, 0.3);
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
  }

  main {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  .error-banner {
    padding: 0.75rem 1rem;
    background: rgba(255, 75, 75, 0.15);
    border: 1px solid var(--error);
    border-radius: 0.5rem;
    color: var(--error);
    margin-bottom: 1.5rem;
  }

  .input-group {
    margin-bottom: 1.5rem;
  }

  .input-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }

  .input-group input {
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 1rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: var(--accent);
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
    transition: all 0.2s;
  }

  .primary-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(250, 60, 131, 0.4);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary-btn {
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
  }

  .secondary-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .text-btn:hover {
    text-decoration: underline;
  }

  /* Fetching step */
  .fetching-step {
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

  .count {
    color: var(--text-secondary);
  }

  /* Select step */
  .select-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .select-actions {
    display: flex;
    gap: 1rem;
  }

  .articles-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .article-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }

  .article-card:hover {
    border-color: var(--border-light);
  }

  .article-card.selected {
    border-color: var(--accent);
    background: rgba(250, 60, 131, 0.05);
  }

  .article-thumb {
    width: 4rem;
    height: 4rem;
    border-radius: 0.5rem;
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
    min-width: 0;
  }

  .article-info h3 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .article-summary {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }

  .article-date {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .checkbox {
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border-light);
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s;
  }

  .checkbox.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .action-bar {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .action-bar .primary-btn {
    flex: 1;
  }

  /* Uploading step */
  .uploading-step {
    text-align: center;
    padding: 4rem 0;
  }

  .progress-text {
    color: var(--text-secondary);
    margin-top: 1rem;
  }

  /* Done step */
  .done-step {
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

  .claim-url-box {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 2rem;
  }

  .claim-url-box input {
    flex: 1;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .copy-btn {
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .copy-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .gift-info {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
  }

  .gift-info .count {
    font-size: 2rem;
    font-weight: 700;
    color: var(--accent);
  }

  .gift-info .label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
</style>
