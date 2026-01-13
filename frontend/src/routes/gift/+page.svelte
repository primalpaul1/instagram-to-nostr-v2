<script lang="ts">
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

  interface Article {
    id: string;
    title: string;
    summary?: string;
    content_markdown: string;
    published_at?: string;
    link?: string;
    image_url?: string;
    blossom_image_url?: string;
    hashtags?: string[];
    selected: boolean;
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
    author_name?: string;
    author_image?: string;
    author_bio?: string;
  }

  let step: Step = 'input';
  let handle = '';
  let feedUrl = '';
  let platform: 'instagram' | 'tiktok' | 'rss' = 'instagram';
  let posts: Post[] = [];
  let articles: Article[] = [];
  let fetchedPosts: any[] = [];
  let fetchedArticles: any[] = [];
  let profile: Profile | null = null;
  let feedInfo: FeedInfo | null = null;
  let fetchCount = 0;
  let error = '';
  let claimUrl = '';
  let abortController: AbortController | null = null;

  // Manual post adding
  let showAddModal = false;
  let manualVideoUrl = '';
  let manualCaption = '';
  let manualPostType: PostType = 'reel';
  let uploadMode: 'url' | 'file' = 'file';
  let isUploading = false;
  let uploadProgress = '';
  let fileInput: HTMLInputElement;

  $: reelPosts = posts.filter(p => p.post_type === 'reel');
  $: imagePosts = posts.filter(p => p.post_type === 'image' || p.post_type === 'carousel');
  $: selectedPosts = posts.filter(p => p.selected);
  $: selectedArticles = articles.filter(a => a.selected);
  $: selectedCount = platform === 'rss' ? selectedArticles.length : selectedPosts.length;

  let activeTab: 'reels' | 'posts' = 'reels';
  $: currentPosts = activeTab === 'reels' ? reelPosts : imagePosts;
  $: currentSelectedCount = currentPosts.filter(p => p.selected).length;

  async function fetchContent() {
    if (platform === 'rss') {
      if (!feedUrl.trim()) return;
    } else {
      if (!handle.trim()) return;
    }

    step = 'fetching';
    error = '';
    posts = [];
    articles = [];
    fetchedPosts = [];
    fetchedArticles = [];
    fetchCount = 0;
    abortController = new AbortController();

    try {
      let endpoint: string;
      if (platform === 'rss') {
        endpoint = `/api/rss-stream?feed_url=${encodeURIComponent(feedUrl.trim())}`;
      } else {
        const cleanHandle = handle.replace('@', '').trim();
        endpoint = platform === 'tiktok'
          ? `/api/tiktok-stream/${encodeURIComponent(cleanHandle)}`
          : `/api/videos-stream/${encodeURIComponent(cleanHandle)}`;
      }

      const response = await fetch(endpoint, {
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
                if (platform === 'rss') {
                  if (data.articles) {
                    fetchedArticles = data.articles;
                  }
                  if (data.feed) {
                    feedInfo = data.feed;
                  }
                } else {
                  if (data.posts) {
                    fetchedPosts = data.posts;
                  }
                  if (data.profile) {
                    profile = data.profile;
                  }
                }
              }

              if (data.done) {
                if (platform === 'rss') {
                  if (!data.articles || data.articles.length === 0) {
                    throw new Error('No articles found in this feed');
                  }
                  articles = (data.articles || []).map((a: any, idx: number) => ({
                    ...a,
                    id: a.id || `article-${idx}`,
                    selected: true
                  }));
                  feedInfo = data.feed || { url: feedUrl.trim() };
                  // Set profile from feed author info (for Substack)
                  if (data.feed && (data.feed.author_name || data.feed.title)) {
                    profile = {
                      username: data.feed.author_name || data.feed.title,
                      display_name: data.feed.author_name || data.feed.title,
                      bio: data.feed.author_bio || data.feed.description,
                      profile_picture_url: data.feed.author_image || data.feed.image_url
                    };
                  }
                } else {
                  if (!data.posts || data.posts.length === 0) {
                    throw new Error('No content found for this account');
                  }
                  posts = (data.posts || []).map((p: any) => ({ ...p, selected: true }));
                  profile = data.profile || null;
                }
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
    if (!abortController) return;
    if (platform === 'rss') {
      if (fetchedArticles.length === 0) return;
      abortController.abort();
      articles = fetchedArticles.map((a: any, idx: number) => ({
        ...a,
        id: a.id || `article-${idx}`,
        selected: true
      }));
    } else {
      if (fetchedPosts.length === 0) return;
      abortController.abort();
      posts = fetchedPosts.map((p: any) => ({ ...p, selected: true }));
    }
    step = 'select';
  }

  function toggleArticle(id: string) {
    articles = articles.map(a => a.id === id ? { ...a, selected: !a.selected } : a);
  }

  function selectAllArticles() {
    articles = articles.map(a => ({ ...a, selected: true }));
  }

  function deselectAllArticles() {
    articles = articles.map(a => ({ ...a, selected: false }));
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

  async function createGift() {
    if (selectedCount === 0) return;

    step = 'creating';
    error = '';

    try {
      let body: any;

      if (platform === 'rss') {
        body = {
          gift_type: 'articles',
          articles: selectedArticles.map(a => ({
            title: a.title,
            summary: a.summary,
            content_markdown: a.content_markdown,
            published_at: a.published_at,
            link: a.link,
            image_url: a.image_url,
            blossom_image_url: a.blossom_image_url,
            hashtags: a.hashtags
          })),
          feed: feedInfo,
          profile
        };
      } else {
        const cleanHandle = handle.replace('@', '').trim();
        body = {
          gift_type: 'posts',
          handle: cleanHandle,
          posts: selectedPosts.map(p => ({
            id: p.id,
            post_type: p.post_type,
            caption: p.caption,
            original_date: p.original_date,
            thumbnail_url: p.thumbnail_url,
            media_items: p.media_items
          })),
          profile
        };
      }

      const response = await fetch('/api/gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to create gift');
      }

      const data = await response.json();
      claimUrl = data.claimUrl;
      step = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create gift';
      step = 'select';
    }
  }

  function reset() {
    step = 'input';
    handle = '';
    feedUrl = '';
    posts = [];
    articles = [];
    profile = null;
    feedInfo = null;
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

  function openAddModal() {
    showAddModal = true;
    manualVideoUrl = '';
    manualCaption = '';
    manualPostType = 'reel';
    uploadMode = 'file';
    isUploading = false;
    uploadProgress = '';
  }

  function closeAddModal() {
    showAddModal = false;
  }

  async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    isUploading = true;
    uploadProgress = 'Uploading to Blossom...';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const result = await response.json();
      manualVideoUrl = result.url;
      uploadProgress = 'Uploaded!';

      if (file.type.startsWith('video/')) {
        manualPostType = 'reel';
      } else if (file.type.startsWith('image/')) {
        manualPostType = 'image';
      }
    } catch (err) {
      uploadProgress = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      isUploading = false;
    }
  }

  function addManualPost() {
    if (!manualVideoUrl.trim()) return;

    const newPost: Post = {
      id: `manual-${Date.now()}`,
      post_type: manualPostType,
      caption: manualCaption.trim() || undefined,
      original_date: new Date().toISOString(),
      thumbnail_url: undefined,
      media_items: [{
        url: manualVideoUrl.trim(),
        media_type: manualPostType === 'reel' ? 'video' : 'image'
      }],
      selected: true
    };

    posts = [newPost, ...posts];
    closeAddModal();
  }
</script>

<svelte:head>
  <title>Gift Freedom | Own Your Posts</title>
</svelte:head>

<div class="gift-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
    <span class="badge">Gift Mode</span>
  </header>

  <main>
    {#if step === 'input'}
      <div class="input-step">
        <h1>Gift Freedom</h1>
        <p class="subtitle">Help someone new own their content on Nostr. They'll create their account with a password.</p>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        <form on:submit|preventDefault={fetchContent}>
          <div class="platform-toggle">
            <button
              type="button"
              class="platform-btn"
              class:active={platform === 'instagram'}
              on:click={() => platform = 'instagram'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              Instagram
            </button>
            <button
              type="button"
              class="platform-btn"
              class:active={platform === 'tiktok'}
              on:click={() => platform = 'tiktok'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
              </svg>
              TikTok
            </button>
            <button
              type="button"
              class="platform-btn"
              class:active={platform === 'rss'}
              on:click={() => platform = 'rss'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z"/>
              </svg>
              RSS
            </button>
          </div>

          {#if platform === 'rss'}
            <div class="input-group">
              <label for="feed-url">RSS Feed URL</label>
              <input
                id="feed-url"
                type="url"
                bind:value={feedUrl}
                placeholder="https://example.com/feed.xml"
                autocomplete="off"
                class="full-input"
              />
            </div>
          {:else}
            <div class="input-group">
              <label for="handle">{platform === 'tiktok' ? 'TikTok' : 'Instagram'} Handle</label>
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
          {/if}

          <div class="info-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            <p>The recipient will choose a password to create their Nostr account. You won't have access to their private key.</p>
          </div>

          <button type="submit" class="primary-btn" disabled={platform === 'rss' ? !feedUrl.trim() : !handle.trim()}>
            Fetch {platform === 'rss' ? 'Articles' : 'Content'}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>
      </div>

    {:else if step === 'fetching'}
      <div class="fetching-step">
        <div class="spinner-large"></div>
        <h2>Fetching {platform === 'rss' ? 'articles' : 'content'}...</h2>
        <p class="count">{fetchCount} {platform === 'rss' ? 'articles' : 'posts'} found</p>
        {#if platform === 'rss' ? fetchedArticles.length > 0 : fetchedPosts.length > 0}
          <button class="secondary-btn" on:click={pauseFetch}>
            Continue with {platform === 'rss' ? fetchedArticles.length : fetchedPosts.length} {platform === 'rss' ? 'articles' : 'posts'}
          </button>
        {/if}
      </div>

    {:else if step === 'select'}
      <div class="select-step">
        <div class="select-header">
          <div>
            {#if platform === 'rss'}
              <h2>Select articles from {feedInfo?.title || 'RSS Feed'}</h2>
            {:else}
              <h2>Select content for @{handle}</h2>
            {/if}
            <p class="subtitle">Recipient will claim with their own password</p>
          </div>
          <button class="back-btn" on:click={reset}>Start Over</button>
        </div>

        {#if error}
          <div class="error-banner">{error}</div>
        {/if}

        {#if platform === 'rss'}
          <!-- RSS Articles View -->
          <div class="toolbar">
            <div class="selection-badge" class:has-selection={selectedArticles.length > 0}>
              <span class="count">{selectedArticles.length}</span>
              <span class="label">of {articles.length} selected</span>
            </div>
            <div class="toolbar-actions">
              <button class="text-btn" on:click={selectAllArticles}>Select All</button>
              <button class="text-btn" on:click={deselectAllArticles}>Clear</button>
            </div>
          </div>

          <div class="articles-list">
            {#each articles as article (article.id)}
              <button class="article-card" class:selected={article.selected} on:click={() => toggleArticle(article.id)}>
                <div class="article-checkbox" class:checked={article.selected}>
                  {#if article.selected}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  {/if}
                </div>
                <div class="article-content">
                  {#if article.image_url || article.blossom_image_url}
                    <img src={article.blossom_image_url || article.image_url} alt="" class="article-image" loading="lazy" />
                  {/if}
                  <div class="article-info">
                    <h4 class="article-title">{article.title}</h4>
                    {#if article.summary}
                      <p class="article-summary">{article.summary.slice(0, 120)}{article.summary.length > 120 ? '...' : ''}</p>
                    {/if}
                    <div class="article-meta">
                      {#if article.published_at}
                        <span class="date">{formatDate(article.published_at)}</span>
                      {/if}
                      {#if article.hashtags && article.hashtags.length > 0}
                        <span class="tags">{article.hashtags.slice(0, 3).map(t => `#${t}`).join(' ')}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              </button>
            {:else}
              <div class="empty-state">No articles found</div>
            {/each}
          </div>
        {:else}
          <!-- Posts View (Instagram/TikTok) -->
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
              <button class="add-btn" on:click={openAddModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Add Post
              </button>
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
        {/if}

        <div class="actions">
          <div class="total-selected">
            Total: <strong>{selectedCount}</strong> {platform === 'rss' ? 'articles' : 'items'} selected
          </div>
          <button class="primary-btn" disabled={selectedCount === 0} on:click={createGift}>
            Create Gift
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>

    {:else if step === 'creating'}
      <div class="creating-step">
        <div class="spinner-large"></div>
        <h2>Creating gift...</h2>
        <p class="subtitle">This will just take a moment</p>
      </div>

    {:else if step === 'done'}
      <div class="done-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/>
            <path d="M17 3l4 4-8 8H9v-4l8-8z"/>
          </svg>
        </div>
        <h2>Gift Created!</h2>
        {#if platform === 'rss'}
          <p class="subtitle">Share this link with the recipient. They'll choose a password to claim their Nostr account.</p>
        {:else}
          <p class="subtitle">Share this link with @{handle}. They'll choose a password to claim their Nostr account.</p>
        {/if}

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
          {#if platform === 'rss'}
            <div class="summary-row">
              <span class="label">Feed</span>
              <span class="value">{feedInfo?.title || 'RSS Feed'}</span>
            </div>
            <div class="summary-row">
              <span class="label">Articles</span>
              <span class="value">{selectedCount} items</span>
            </div>
          {:else}
            <div class="summary-row">
              <span class="label">{platform === 'tiktok' ? 'TikTok' : 'Instagram'}</span>
              <span class="value">@{handle}</span>
            </div>
            <div class="summary-row">
              <span class="label">Posts</span>
              <span class="value">{selectedCount} items</span>
            </div>
          {/if}
          <div class="summary-row">
            <span class="label">Expires</span>
            <span class="value">30 days</span>
          </div>
        </div>

        <div class="note-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>You will not have access to their private key. They create their own password.</span>
        </div>

        <button class="secondary-btn" on:click={reset}>Create Another Gift</button>
      </div>
    {/if}
  </main>

  {#if showAddModal}
    <div class="modal-backdrop" on:click={closeAddModal} on:keydown={(e) => e.key === 'Escape' && closeAddModal()} role="button" tabindex="-1">
      <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>Add Post Manually</h3>
          <button class="close-btn" on:click={closeAddModal}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="input-group">
            <label for="post-type">Post Type</label>
            <div class="type-selector">
              <button
                class="type-option"
                class:active={manualPostType === 'reel'}
                on:click={() => manualPostType = 'reel'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Video
              </button>
              <button
                class="type-option"
                class:active={manualPostType === 'image'}
                on:click={() => manualPostType = 'image'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
                Image
              </button>
            </div>
          </div>

          <div class="input-group">
            <label>Media Source</label>
            <div class="source-toggle">
              <button
                class="source-option"
                class:active={uploadMode === 'file'}
                on:click={() => uploadMode = 'file'}
              >
                Upload File
              </button>
              <button
                class="source-option"
                class:active={uploadMode === 'url'}
                on:click={() => uploadMode = 'url'}
              >
                Paste URL
              </button>
            </div>
          </div>

          {#if uploadMode === 'file'}
            <div class="input-group">
              <label for="file-upload">Choose File</label>
              <div class="file-upload-area" class:has-file={manualVideoUrl} class:uploading={isUploading}>
                {#if isUploading}
                  <div class="upload-spinner"></div>
                  <span>{uploadProgress}</span>
                {:else if manualVideoUrl}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  <span class="upload-success">File uploaded!</span>
                  <button class="change-file-btn" on:click={() => fileInput.click()}>Change</button>
                {:else}
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Drop a file or click to browse</span>
                  <span class="file-types">.mp4, .mov, .jpg, .png</span>
                {/if}
                <input
                  bind:this={fileInput}
                  id="file-upload"
                  type="file"
                  accept="video/*,image/*"
                  on:change={handleFileUpload}
                  class="file-input-hidden"
                />
              </div>
              {#if uploadProgress && !isUploading && !manualVideoUrl}
                <span class="input-hint error">{uploadProgress}</span>
              {/if}
            </div>
          {:else}
            <div class="input-group">
              <label for="media-url">Media URL</label>
              <input
                id="media-url"
                type="text"
                bind:value={manualVideoUrl}
                placeholder={manualPostType === 'reel' ? 'https://example.com/video.mp4' : 'https://example.com/image.jpg'}
                class="modal-input"
              />
              <span class="input-hint">Direct link to the {manualPostType === 'reel' ? 'video' : 'image'} file</span>
            </div>
          {/if}

          <div class="input-group">
            <label for="caption">Caption</label>
            <textarea
              id="caption"
              bind:value={manualCaption}
              placeholder="Write your caption here..."
              class="modal-textarea"
              rows="4"
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="secondary-btn" on:click={closeAddModal}>Cancel</button>
          <button class="primary-btn" disabled={!manualVideoUrl.trim()} on:click={addManualPost}>
            Add Post
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .gift-page {
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
    background: rgba(147, 51, 234, 0.15);
    color: #a855f7;
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 2rem;
  }

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

  .platform-toggle {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-bottom: 0.5rem;
  }

  .platform-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .platform-btn:hover {
    border-color: var(--text-secondary);
  }

  .platform-btn.active {
    border-color: var(--accent);
    background: rgba(147, 51, 234, 0.1);
    color: var(--accent);
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

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(147, 51, 234, 0.1);
    border: 1px solid rgba(147, 51, 234, 0.2);
    border-radius: 0.75rem;
    text-align: left;
  }

  .info-box svg {
    color: #a855f7;
    flex-shrink: 0;
  }

  .info-box p {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
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
    transition: all 0.2s ease;
  }

  .secondary-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  .fetching-step, .creating-step {
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

  .count {
    color: #a855f7;
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }

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
    background: rgba(168, 85, 247, 0.2);
    color: #a855f7;
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
    color: #a855f7;
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
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.08);
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
    background: #a855f7;
    border-color: #a855f7;
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
    color: #a855f7;
  }

  .done-step {
    text-align: center;
    padding: 2rem 0;
  }

  .success-icon {
    width: 5rem;
    height: 5rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
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
    background: #a855f7;
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

  .note-box {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .note-box svg {
    color: #22c55e;
    flex-shrink: 0;
  }

  .note-box span {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .add-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 0.5rem;
    color: #a855f7;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .add-btn:hover {
    background: rgba(168, 85, 247, 0.25);
    border-color: #a855f7;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 1rem;
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    font-size: 1.125rem;
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

  .modal-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .type-selector {
    display: flex;
    gap: 0.5rem;
  }

  .type-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.75rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .type-option:hover {
    border-color: var(--border-light);
    color: var(--text-primary);
  }

  .type-option.active {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.1);
    color: #a855f7;
  }

  .modal-input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .modal-input:focus {
    border-color: #a855f7;
    outline: none;
  }

  .modal-textarea {
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

  .modal-textarea:focus {
    border-color: #a855f7;
    outline: none;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid var(--border);
  }

  .source-toggle {
    display: flex;
    gap: 0.5rem;
  }

  .source-option {
    flex: 1;
    padding: 0.625rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .source-option:hover {
    border-color: var(--border-light);
  }

  .source-option.active {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.1);
    color: #a855f7;
  }

  .file-upload-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
    background: var(--bg-tertiary);
    border: 2px dashed var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }

  .file-upload-area:hover {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.05);
  }

  .file-upload-area.uploading {
    border-color: #a855f7;
    cursor: wait;
  }

  .file-upload-area.has-file {
    border-style: solid;
    border-color: var(--success);
    background: rgba(var(--success-rgb, 34, 197, 94), 0.1);
  }

  .file-upload-area span {
    font-size: 0.875rem;
  }

  .file-types {
    font-size: 0.75rem !important;
    color: var(--text-muted);
  }

  .file-input-hidden {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .upload-spinner {
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .upload-success {
    color: var(--success);
    font-weight: 500;
  }

  .change-file-btn {
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    margin-top: 0.25rem;
  }

  .change-file-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  .input-hint {
    display: block;
    margin-top: 0.375rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .input-hint.error {
    color: var(--error, #ef4444);
  }

  /* RSS Input */
  .full-input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 1rem;
  }

  .full-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  /* Articles List */
  .articles-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 400px;
    overflow-y: auto;
    padding: 0.25rem;
    margin-bottom: 1.5rem;
  }

  .article-card {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 2px solid transparent;
    border-radius: 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
  }

  .article-card:hover {
    border-color: var(--border-light);
  }

  .article-card.selected {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.08);
  }

  .article-checkbox {
    width: 1.5rem;
    height: 1.5rem;
    background: var(--bg-primary);
    border: 2px solid var(--border-light);
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .article-checkbox.checked {
    background: #a855f7;
    border-color: #a855f7;
    color: white;
  }

  .article-content {
    flex: 1;
    display: flex;
    gap: 1rem;
    min-width: 0;
  }

  .article-image {
    width: 80px;
    height: 60px;
    object-fit: cover;
    border-radius: 0.5rem;
    flex-shrink: 0;
  }

  .article-info {
    flex: 1;
    min-width: 0;
  }

  .article-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 0.375rem 0;
    line-height: 1.3;
  }

  .article-summary {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin: 0 0 0.5rem 0;
    line-height: 1.4;
  }

  .article-meta {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .article-meta .date {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .article-meta .tags {
    font-size: 0.75rem;
    color: #a855f7;
  }
</style>
