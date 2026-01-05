<script lang="ts">
  import { onMount } from 'svelte';

  type Step = 'input' | 'fetching' | 'select' | 'creating' | 'done';
  type PostType = 'reel' | 'image' | 'carousel';

  interface MediaItem {
    url: string;
    media_type: 'image' | 'video';
    width?: number;
    height?: number;
    duration?: number;
    thumbnail_url?: string;
  }

  interface Post {
    id: string;
    post_type: PostType;
    caption?: string;
    original_date?: string;
    thumbnail_url?: string;
    media_items: MediaItem[];
    selected: boolean;
  }

  interface Profile {
    username: string;
    display_name?: string;
    bio?: string;
    profile_picture_url?: string;
  }

  let step: Step = 'input';
  let handle = '';
  let targetNpub = '';
  let posts: Post[] = [];
  let fetchedPosts: any[] = [];  // Accumulates during streaming
  let profile: Profile | null = null;
  let fetchCount = 0;
  let error = '';
  let claimUrl = '';
  let abortController: AbortController | null = null;

  $: reelPosts = posts.filter(p => p.post_type === 'reel');
  $: imagePosts = posts.filter(p => p.post_type === 'image' || p.post_type === 'carousel');
  $: selectedPosts = posts.filter(p => p.selected);
  $: selectedCount = selectedPosts.length;

  let activeTab: 'reels' | 'posts' = 'reels';
  $: currentPosts = activeTab === 'reels' ? reelPosts : imagePosts;
  $: currentSelectedCount = currentPosts.filter(p => p.selected).length;

  function validateNpub(npub: string): boolean {
    return npub.startsWith('npub1') && npub.length === 63;
  }

  async function fetchContent() {
    if (!handle.trim() || !targetNpub.trim()) return;

    if (!validateNpub(targetNpub.trim())) {
      error = 'Invalid npub format. Must start with npub1 and be 63 characters.';
      return;
    }

    step = 'fetching';
    error = '';
    posts = [];
    fetchedPosts = [];
    fetchCount = 0;
    abortController = new AbortController();

    try {
      const cleanHandle = handle.replace('@', '').trim();
      const response = await fetch(`/api/videos-stream/${encodeURIComponent(cleanHandle)}`, {
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch content');
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

              if (data.progress) {
                fetchCount = data.count;
                if (data.posts) {
                  fetchedPosts = data.posts;
                }
                if (data.profile) {
                  profile = data.profile;
                }
              }

              if (data.done) {
                if (!data.posts || data.posts.length === 0) {
                  throw new Error('No content found for this account');
                }

                // All posts selected by default
                posts = (data.posts || []).map((p: any) => ({ ...p, selected: true }));
                profile = data.profile || null;
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
        // Don't change step - pauseFetch already set it to 'select'
        return;
      }
      error = err instanceof Error ? err.message : 'An error occurred';
      step = 'input';
    } finally {
      abortController = null;
    }
  }

  function pauseFetch() {
    if (!abortController || fetchedPosts.length === 0) return;
    abortController.abort();
    // Use accumulated posts with all selected by default
    posts = fetchedPosts.map((p: any) => ({ ...p, selected: true }));
    step = 'select';
  }

  function togglePost(id: string) {
    posts = posts.map(p => p.id === id ? { ...p, selected: !p.selected } : p);
  }

  function selectAllCurrentTab() {
    if (activeTab === 'reels') {
      posts = posts.map(p => p.post_type === 'reel' ? { ...p, selected: true } : p);
    } else {
      posts = posts.map(p => (p.post_type === 'image' || p.post_type === 'carousel') ? { ...p, selected: true } : p);
    }
  }

  function deselectAllCurrentTab() {
    if (activeTab === 'reels') {
      posts = posts.map(p => p.post_type === 'reel' ? { ...p, selected: false } : p);
    } else {
      posts = posts.map(p => (p.post_type === 'image' || p.post_type === 'carousel') ? { ...p, selected: false } : p);
    }
  }

  async function createProposal() {
    if (selectedCount === 0) return;

    step = 'creating';
    error = '';

    try {
      const cleanHandle = handle.replace('@', '').trim();
      const response = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: cleanHandle,
          targetNpub: targetNpub.trim(),
          posts: selectedPosts.map(p => ({
            id: p.id,
            post_type: p.post_type,
            caption: p.caption,
            original_date: p.original_date,
            thumbnail_url: p.thumbnail_url,
            media_items: p.media_items
          })),
          profile
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to create proposal');
      }

      const data = await response.json();
      claimUrl = data.claimUrl;
      step = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create proposal';
      step = 'select';
    }
  }

  function reset() {
    step = 'input';
    handle = '';
    targetNpub = '';
    posts = [];
    profile = null;
    fetchCount = 0;
    error = '';
    claimUrl = '';
  }

  function copyClaimUrl() {
    navigator.clipboard.writeText(claimUrl);
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function formatDate(date?: string): string {
    if (!date) return '';
    try {
      return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  }

  function getFirstMediaDuration(post: Post): number | undefined {
    const firstVideo = post.media_items.find(m => m.media_type === 'video');
    return firstVideo?.duration;
  }
</script>

<svelte:head>
  <title>Propose Migration | Insta to Primal</title>
</svelte:head>

<div class="propose-page">
  <header>
    <a href="/" class="logo">Insta to Primal</a>
    <span class="badge">Propose Mode</span>
  </header>

  <main>
    {#if step === 'input'}
      <div class="input-step">
        <h1>Propose a Migration</h1>
        <p class="subtitle">Fetch someone's Instagram content and create a claim link for them</p>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <form on:submit|preventDefault={fetchContent}>
          <div class="input-group">
            <label for="handle">Instagram Handle</label>
            <div class="input-wrapper">
              <span class="at-symbol">@</span>
              <input
                id="handle"
                type="text"
                bind:value={handle}
                placeholder="username"
                autocomplete="off"
                autocapitalize="off"
              />
            </div>
          </div>

          <div class="input-group">
            <label for="npub">Target Nostr Pubkey</label>
            <input
              id="npub"
              type="text"
              bind:value={targetNpub}
              placeholder="npub1..."
              class="npub-input"
              autocomplete="off"
            />
            <span class="input-hint">The npub of the person who will claim this content</span>
          </div>

          <button type="submit" class="primary-btn" disabled={!handle.trim() || !targetNpub.trim()}>
            Fetch Content
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>
      </div>

    {:else if step === 'fetching'}
      <div class="fetching-step">
        <div class="spinner-large"></div>
        <h2>Fetching content...</h2>
        <p class="count">{fetchCount} posts found</p>
        {#if fetchedPosts.length > 0}
          <button class="secondary-btn" on:click={pauseFetch}>
            Continue with {fetchedPosts.length} posts
          </button>
        {/if}
      </div>

    {:else if step === 'select'}
      <div class="select-step">
        <div class="select-header">
          <div>
            <h2>Select content for @{handle}</h2>
            <p class="subtitle">Target: {targetNpub.slice(0, 20)}...</p>
          </div>
          <button class="back-btn" on:click={reset}>Start Over</button>
        </div>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <div class="tabs">
          <button class="tab" class:active={activeTab === 'reels'} on:click={() => activeTab = 'reels'}>
            Reels <span class="tab-count">{reelPosts.length}</span>
          </button>
          <button class="tab" class:active={activeTab === 'posts'} on:click={() => activeTab = 'posts'}>
            Posts <span class="tab-count">{imagePosts.length}</span>
          </button>
        </div>

        <div class="toolbar">
          <div class="selection-badge" class:has-selection={currentSelectedCount > 0}>
            <span class="count">{currentSelectedCount}</span>
            <span class="label">of {currentPosts.length} selected</span>
          </div>
          <div class="toolbar-actions">
            <button class="text-btn" on:click={selectAllCurrentTab}>Select All</button>
            <button class="text-btn" on:click={deselectAllCurrentTab}>Clear</button>
          </div>
        </div>

        <div class="posts-grid">
          {#each currentPosts as post (post.id)}
            <button class="post-card" class:selected={post.selected} on:click={() => togglePost(post.id)}>
              <div class="thumbnail-wrapper">
                {#if post.thumbnail_url}
                  <img src={post.thumbnail_url} alt="" loading="lazy" />
                {:else}
                  <div class="placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    </svg>
                  </div>
                {/if}

                {#if post.post_type === 'reel' && getFirstMediaDuration(post)}
                  <span class="duration">{formatDuration(getFirstMediaDuration(post))}</span>
                {/if}

                {#if post.post_type === 'carousel'}
                  <span class="carousel-badge">{post.media_items.length}</span>
                {/if}

                <div class="select-indicator" class:checked={post.selected}>
                  {#if post.selected}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  {/if}
                </div>
              </div>
              <div class="post-meta">
                <p class="caption">{post.caption?.slice(0, 40) || 'No caption'}{(post.caption?.length || 0) > 40 ? '...' : ''}</p>
                {#if post.original_date}
                  <span class="date">{formatDate(post.original_date)}</span>
                {/if}
              </div>
            </button>
          {:else}
            <div class="empty-state">No {activeTab === 'reels' ? 'reels' : 'posts'} found</div>
          {/each}
        </div>

        <div class="actions">
          <div class="total-selected">
            Total: <strong>{selectedCount}</strong> items selected
          </div>
          <button class="primary-btn" disabled={selectedCount === 0} on:click={createProposal}>
            Create Proposal
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>

    {:else if step === 'creating'}
      <div class="creating-step">
        <div class="spinner-large"></div>
        <h2>Creating proposal...</h2>
        <p class="subtitle">This will just take a moment</p>
      </div>

    {:else if step === 'done'}
      <div class="done-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Proposal Created!</h2>
        <p class="subtitle">Share this link with @{handle}'s Nostr identity</p>

        <div class="claim-link-box">
          <code>{claimUrl}</code>
          <button class="copy-btn" on:click={copyClaimUrl}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy
          </button>
        </div>

        <div class="summary-card">
          <div class="summary-row">
            <span class="label">Instagram</span>
            <span class="value">@{handle}</span>
          </div>
          <div class="summary-row">
            <span class="label">Target npub</span>
            <span class="value mono">{targetNpub.slice(0, 24)}...</span>
          </div>
          <div class="summary-row">
            <span class="label">Posts</span>
            <span class="value">{selectedCount} items</span>
          </div>
          <div class="summary-row">
            <span class="label">Expires</span>
            <span class="value">30 days</span>
          </div>
        </div>

        <button class="secondary-btn" on:click={reset}>Create Another Proposal</button>
      </div>
    {/if}
  </main>
</div>

<style>
  .propose-page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    padding: 0.375rem 0.75rem;
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 2rem;
  }

  /* Input Step */
  .input-step {
    text-align: center;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
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

  .error-banner {
    background: rgba(var(--error-rgb, 239, 68, 68), 0.15);
    color: var(--error, #ef4444);
    padding: 0.875rem 1rem;
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .input-group {
    text-align: left;
  }

  .input-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    padding: 0 1rem;
  }

  .input-wrapper:focus-within {
    border-color: var(--accent);
  }

  .at-symbol {
    color: var(--text-muted);
    font-size: 1.125rem;
  }

  .input-wrapper input {
    flex: 1;
    padding: 0.875rem 0.5rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 1rem;
    outline: none;
  }

  .npub-input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .npub-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .input-hint {
    display: block;
    margin-top: 0.375rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
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
    border-radius: 0.75rem;
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

  /* Fetching Step */
  .fetching-step, .creating-step {
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
    color: var(--accent);
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }

  /* Select Step */
  .select-step {
    width: 100%;
    max-width: 100%;
  }

  .select-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .back-btn {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.25rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
  }

  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .tab.active {
    background: var(--bg-secondary);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .tab-count {
    padding: 0.125rem 0.5rem;
    background: var(--bg-primary);
    border-radius: 1rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .tab.active .tab-count {
    background: rgba(var(--accent-rgb), 0.2);
    color: var(--accent);
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 1rem;
  }

  .selection-badge {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }

  .selection-badge .count {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-muted);
    margin: 0;
  }

  .selection-badge.has-selection .count {
    color: var(--accent);
  }

  .selection-badge .label {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .toolbar-actions {
    display: flex;
    gap: 0.25rem;
  }

  .text-btn {
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 0.5rem;
  }

  .text-btn:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .posts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
    max-height: 400px;
    overflow-y: auto;
    padding: 0.25rem;
    margin-bottom: 1.5rem;
  }

  .post-card {
    background: var(--bg-tertiary);
    border: 2px solid transparent;
    border-radius: 0.75rem;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    padding: 0;
    transition: all 0.2s ease;
  }

  .post-card:hover {
    border-color: var(--border-light);
  }

  .post-card.selected {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
  }

  .thumbnail-wrapper {
    position: relative;
    aspect-ratio: 1;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .thumbnail-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .duration, .carousel-badge {
    position: absolute;
    bottom: 0.375rem;
    right: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: rgba(0, 0, 0, 0.75);
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 600;
    color: white;
  }

  .select-indicator {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    width: 1.25rem;
    height: 1.25rem;
    background: rgba(0, 0, 0, 0.5);
    border: 2px solid rgba(255, 255, 255, 0.5);
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .select-indicator.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .post-meta {
    padding: 0.5rem;
  }

  .caption {
    font-size: 0.6875rem;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .date {
    font-size: 0.625rem;
    color: var(--text-muted);
  }

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 2rem;
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .total-selected {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .total-selected strong {
    color: var(--accent);
  }

  /* Done Step */
  .done-step {
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

  .claim-link-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 0.875rem 1rem;
    margin: 1.5rem 0;
  }

  .claim-link-box code {
    flex: 1;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: var(--accent);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }

  .summary-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
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
</style>
