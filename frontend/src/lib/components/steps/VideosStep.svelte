<script lang="ts">
  import { onDestroy } from 'svelte';
  import { wizard, reelPosts, imagePosts, selectedPosts, selectedPostsCount, selectedArticles, selectedArticlesCount, setMediaCache, getMediaCache } from '$lib/stores/wizard';
  import type { PostInfo, MediaItemInfo, ArticleInfo } from '$lib/stores/wizard';
  import { hexToNpub } from '$lib/nip46';

  let isCreatingMigration = false;
  let email = '';
  let showEmailPrompt = false;

  // Pre-download state
  const MAX_CONCURRENT_DOWNLOADS = 3;
  let downloadQueue: MediaItemInfo[] = [];
  let activeDownloads = 0;
  let downloadedUrls = new Set<string>();

  // Watch for selection changes and queue downloads
  $: {
    const selected = $selectedPosts;
    // Sort by date descending (latest first) and queue media items
    const sortedPosts = [...selected].sort((a, b) => {
      const dateA = a.original_date ? new Date(a.original_date).getTime() : 0;
      const dateB = b.original_date ? new Date(b.original_date).getTime() : 0;
      return dateB - dateA;
    });

    for (const post of sortedPosts) {
      for (const media of post.media_items) {
        if (!downloadedUrls.has(media.url) && !downloadQueue.some(m => m.url === media.url)) {
          downloadQueue.push(media);
        }
      }
    }
    processDownloadQueue();
  }

  async function processDownloadQueue() {
    while (downloadQueue.length > 0 && activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      const media = downloadQueue.shift();
      if (!media || downloadedUrls.has(media.url) || getMediaCache(media.url)) continue;

      activeDownloads++;
      downloadMedia(media).finally(() => {
        activeDownloads--;
        processDownloadQueue();
      });
    }
  }

  async function downloadMedia(media: MediaItemInfo) {
    try {
      const response = await fetch('/api/proxy-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: media.url })
      });

      if (response.ok) {
        const data = await response.arrayBuffer();
        setMediaCache(media.url, data);
        downloadedUrls.add(media.url);
      }
    } catch (err) {
      console.warn('Pre-download failed:', media.url, err);
    }
  }

  onDestroy(() => {
    downloadQueue = [];
  });

  let activeTab: 'reels' | 'posts' = 'reels';

  $: currentPosts = activeTab === 'reels' ? $reelPosts : $imagePosts;
  $: currentSelectedCount = currentPosts.filter(p => p.selected).length;
  $: totalSelectedCount = $selectedPostsCount;

  // For Twitter, we need all posts including text-only
  $: allPosts = $wizard.posts;

  function handleBack() {
    // Both modes go back to handle step
    wizard.setStep('handle');
  }

  async function handleContinue() {
    const count = $wizard.contentType === 'articles' ? $selectedArticlesCount : totalSelectedCount;
    if (count === 0) return;

    // For NIP-46 mode, create proposal directly and go to proposal-created
    if ($wizard.authMode === 'nip46') {
      await handleCreateProposal();
      return;
    }

    // For generate mode, show email prompt first
    showEmailPrompt = true;
  }

  async function handleEmailSubmit() {
    handleClaimPosts();
  }

  async function handleEmailSkip() {
    email = '';
    handleClaimPosts();
  }

  async function handleCreateProposal() {
    if (isCreatingMigration) return;

    isCreatingMigration = true;
    wizard.setLoading(true);
    wizard.setError(null);

    try {
      const isArticlesMode = $wizard.contentType === 'articles';

      const selectedPostsData = $selectedPosts.map(p => ({
        id: p.id,
        post_type: p.post_type,
        caption: p.caption,
        original_date: p.original_date,
        thumbnail_url: p.thumbnail_url,
        media_items: p.media_items
      }));

      const selectedArticlesData = $selectedArticles.map(a => ({
        title: a.title,
        summary: a.summary,
        content_markdown: a.content_markdown,
        published_at: a.published_at,
        link: a.link,
        image_url: a.image_url,
        hashtags: a.hashtags
      }));

      const userNpub = hexToNpub($wizard.nip46Pubkey!);

      const response = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: $wizard.handle,
          targetNpub: userNpub,
          preparedByNpub: userNpub, // Same = self-proposal
          posts: isArticlesMode ? [] : selectedPostsData,
          articles: isArticlesMode ? selectedArticlesData : [],
          profile: $wizard.profile,
          proposal_type: $wizard.contentType,
          feed: $wizard.feedInfo ? {
            url: $wizard.handle,
            title: $wizard.feedInfo.title,
            description: $wizard.feedInfo.description,
            image_url: $wizard.feedInfo.image_url
          } : undefined
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create proposal');
      }

      const data = await response.json();
      wizard.setProposalToken(data.claimToken, data.claimUrl);
      wizard.setStep('proposal-created');
    } catch (err) {
      wizard.setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      isCreatingMigration = false;
      wizard.setLoading(false);
    }
  }

  async function handleClaimPosts() {
    const count = $wizard.contentType === 'articles' ? $selectedArticlesCount : totalSelectedCount;
    if (count === 0 || isCreatingMigration) return;

    isCreatingMigration = true;

    try {
      const trimmedEmail = email.trim();

      // If user provided an email, use the gift flow (has a stable claim URL for the email link)
      if (trimmedEmail) {
        await createGiftWithEmail(trimmedEmail);
        return;
      }

      // Otherwise, use the standard migration flow (client-side signing, no stable URL)
      // Determine source type
      const sourceType = $wizard.sourceType || ($wizard.contentType === 'articles' ? 'rss' : 'instagram');

      // Build profile data
      let profileData: { name?: string; bio?: string; picture_url?: string } | undefined;
      if ($wizard.profile) {
        profileData = {
          name: $wizard.profile.display_name || $wizard.profile.username,
          bio: $wizard.profile.bio,
          picture_url: $wizard.profile.profile_picture_url
        };
      }

      // For RSS migrations, construct profile from feed info (like gift flow)
      if (!profileData && $wizard.feedInfo && $wizard.contentType === 'articles') {
        profileData = {
          name: $wizard.feedInfo.author_name || $wizard.feedInfo.title,
          bio: $wizard.feedInfo.author_bio || $wizard.feedInfo.description,
          picture_url: $wizard.feedInfo.author_image || $wizard.feedInfo.image_url
        };
      }

      // Build feed data for RSS (include author fields)
      let feedData: {
        url: string;
        title?: string;
        description?: string;
        image_url?: string;
        author_name?: string;
        author_bio?: string;
        author_image?: string;
      } | undefined;
      if ($wizard.feedInfo) {
        feedData = {
          url: $wizard.handle,
          title: $wizard.feedInfo.title,
          description: $wizard.feedInfo.description,
          image_url: $wizard.feedInfo.image_url,
          author_name: $wizard.feedInfo.author_name,
          author_bio: $wizard.feedInfo.author_bio,
          author_image: $wizard.feedInfo.author_image
        };
      }

      // Build request body based on content type
      const body: Record<string, unknown> = {
        sourceType,
        sourceHandle: $wizard.handle,
        profile: profileData,
        feed: feedData
      };

      if ($wizard.contentType === 'articles') {
        // Articles for RSS
        body.articles = $selectedArticles.map(a => ({
          title: a.title,
          summary: a.summary,
          content_markdown: a.content_markdown,
          published_at: a.published_at,
          link: a.link,
          image_url: a.image_url,
          hashtags: a.hashtags
        }));
      } else {
        // Posts for Instagram/TikTok
        body.posts = $selectedPosts.map(p => ({
          id: p.id,
          post_type: p.post_type,
          caption: p.caption,
          original_date: p.original_date,
          thumbnail_url: p.thumbnail_url,
          media_items: p.media_items.map(m => ({
            url: m.url,
            media_type: m.media_type,
            width: m.width,
            height: m.height,
            duration: m.duration,
            thumbnail_url: m.thumbnail_url
          }))
        }));
      }

      // Create migration
      const response = await fetch('/api/migrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create migration');
      }

      const { migrationId } = await response.json();
      wizard.setMigrationId(migrationId);
      wizard.setStep('progress');
    } catch (err) {
      console.error('Error creating migration:', err);
      wizard.setError(err instanceof Error ? err.message : 'Failed to create migration');
    } finally {
      isCreatingMigration = false;
    }
  }

  async function createGiftWithEmail(userEmail: string) {
    // Gift flow: creates a gift with a stable claim URL, worker uploads media,
    // then sends email with the link so the user can return and claim later.
    const selectedPostsData = $selectedPosts.map(p => ({
      id: p.id,
      post_type: p.post_type,
      caption: p.caption,
      original_date: p.original_date,
      thumbnail_url: p.thumbnail_url,
      media_items: p.media_items
    }));

    const selectedArticlesData = $selectedArticles.map(a => ({
      title: a.title,
      summary: a.summary,
      content_markdown: a.content_markdown,
      published_at: a.published_at,
      link: a.link,
      image_url: a.image_url,
      hashtags: a.hashtags
    }));

    const hasPosts = selectedPostsData.length > 0;
    const hasArticles = selectedArticlesData.length > 0;
    let giftType: 'posts' | 'articles' | 'combined' = 'posts';
    if (hasPosts && hasArticles) {
      giftType = 'combined';
    } else if (hasArticles) {
      giftType = 'articles';
    }

    const response = await fetch('/api/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: $wizard.handle,
        posts: hasPosts ? selectedPostsData : undefined,
        articles: hasArticles ? selectedArticlesData : undefined,
        profile: $wizard.profile,
        gift_type: giftType,
        feed: $wizard.feedInfo ? {
          url: $wizard.handle,
          title: $wizard.feedInfo.title,
          description: $wizard.feedInfo.description,
          image_url: $wizard.feedInfo.image_url
        } : undefined,
        email: userEmail
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create gift');
    }

    const data = await response.json();
    // Redirect to the gift claim page (stable URL the email will also link to)
    window.location.href = data.claimUrl;
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

  function selectAllCurrentTab() {
    if (activeTab === 'reels') {
      wizard.selectAllPosts('reel');
    } else {
      // Select both images and carousels
      wizard.selectAllPosts('image');
      wizard.selectAllPosts('carousel');
    }
  }

  function deselectAllCurrentTab() {
    if (activeTab === 'reels') {
      wizard.deselectAllPosts('reel');
    } else {
      wizard.deselectAllPosts('image');
      wizard.deselectAllPosts('carousel');
    }
  }

  function getPostTypeLabel(post: PostInfo): string {
    if (post.post_type === 'carousel') {
      return `${post.media_items.length} items`;
    }
    return '';
  }

  function getFirstMediaDuration(post: PostInfo): number | undefined {
    const firstVideo = post.media_items.find(m => m.media_type === 'video');
    return firstVideo?.duration;
  }

  // Article helpers
  function formatArticleDate(dateStr?: string): string {
    if (!dateStr) return '';
    try {
      // Handle Unix timestamps (backend returns these as strings)
      const timestamp = parseInt(dateStr, 10);
      if (!isNaN(timestamp) && timestamp > 0) {
        return new Date(timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  }

  function estimateReadTime(content: string): string {
    const words = content.split(/\s+/).length;
    const minutes = Math.ceil(words / 200);
    return `${minutes} min read`;
  }
</script>

<div class="videos-step">
  {#if $wizard.contentType === 'articles'}
    <!-- Articles Selection UI -->
    <div class="header">
      <h2>Choose articles to own forever</h2>
      <p class="subtitle">Select the articles you want to bring to Primal</p>
      {#if $wizard.feedInfo}
        <p class="feed-title">{$wizard.feedInfo.title}</p>
      {/if}
    </div>

    <div class="toolbar">
      <div class="selection-badge" class:has-selection={$selectedArticlesCount > 0}>
        <span class="count">{$selectedArticlesCount}</span>
        <span class="label">of {$wizard.articles.length} selected</span>
      </div>
      <div class="toolbar-actions">
        <button class="text-btn" on:click={() => wizard.selectAllArticles()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          Select All
        </button>
        <button class="text-btn" on:click={() => wizard.deselectAllArticles()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          Clear
        </button>
      </div>
    </div>

    <div class="articles-list">
      {#each $wizard.articles as article (article.id)}
        <button class="article-card" class:selected={article.selected} on:click={() => wizard.toggleArticle(article.id)}>
          {#if article.image_url}
            <div class="article-image">
              <img src={article.image_url} alt="" loading="lazy" />
            </div>
          {/if}
          <div class="article-content">
            <h3>{article.title}</h3>
            {#if article.summary}
              <p class="article-summary">{article.summary}</p>
            {/if}
            <div class="article-meta">
              {#if article.published_at}
                <span class="date">{formatArticleDate(article.published_at)}</span>
              {/if}
              <span class="read-time">{estimateReadTime(article.content_markdown)}</span>
              {#if article.hashtags && article.hashtags.length > 0}
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
      {:else}
        <div class="empty-state">
          <p>No articles found</p>
        </div>
      {/each}
    </div>

    <div class="actions">
      <button class="secondary-btn" on:click={handleBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>
      <button class="primary-btn" disabled={$selectedArticlesCount === 0 || isCreatingMigration} on:click={handleContinue}>
        {#if isCreatingMigration}
          <div class="btn-spinner"></div>
          Creating migration...
        {:else if $wizard.authMode === 'nip46'}
          Prepare {$selectedArticlesCount} Article{$selectedArticlesCount !== 1 ? 's' : ''}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {:else}
          Claim My {$selectedArticlesCount} Article{$selectedArticlesCount !== 1 ? 's' : ''}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {/if}
      </button>
    </div>

  {:else if $wizard.sourceType === 'twitter'}
    <!-- Twitter Tweets Selection UI -->
    <div class="header">
      <h2>Choose tweets to own forever</h2>
      <p class="subtitle">Select the tweets you want to bring to Primal</p>
    </div>

    <div class="toolbar">
      <div class="selection-badge" class:has-selection={totalSelectedCount > 0}>
        <span class="count">{totalSelectedCount}</span>
        <span class="label">of {allPosts.length} selected</span>
      </div>
      <div class="toolbar-actions">
        <button class="text-btn" on:click={() => wizard.selectAllPosts()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          Select All
        </button>
        <button class="text-btn" on:click={() => wizard.deselectAllPosts()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          Clear
        </button>
      </div>
    </div>

    <div class="tweets-list">
      {#each allPosts as post (post.id)}
        <button type="button" class="tweet-card" class:selected={post.selected} on:click|preventDefault={() => wizard.togglePost(post.id)}>
          {#if post.thumbnail_url}
            <div class="tweet-media">
              <img src={post.thumbnail_url} alt="" loading="lazy" />
              {#if post.post_type === 'reel'}
                <span class="media-badge video">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                </span>
              {:else if post.media_items.length > 1}
                <span class="media-badge carousel">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="2" width="16" height="16" rx="2"/>
                    <rect x="6" y="6" width="16" height="16" rx="2"/>
                  </svg>
                  {post.media_items.length}
                </span>
              {/if}
            </div>
          {/if}
          <div class="tweet-content">
            <p class="tweet-text">{post.caption || ''}</p>
            <div class="tweet-meta">
              {#if post.original_date}
                <span class="date">{formatDate(post.original_date)}</span>
              {/if}
              {#if post.post_type === 'text'}
                <span class="type-badge text">Text</span>
              {:else if post.post_type === 'reel'}
                <span class="type-badge video">Video</span>
              {:else}
                <span class="type-badge photo">Photo</span>
              {/if}
            </div>
          </div>
          <div class="select-indicator" class:checked={post.selected}>
            {#if post.selected}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            {/if}
          </div>
        </button>
      {:else}
        <div class="empty-state">
          <p>No tweets found</p>
        </div>
      {/each}
    </div>

    <div class="actions">
      <button class="secondary-btn" on:click={handleBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>
      <button class="primary-btn" disabled={totalSelectedCount === 0 || isCreatingMigration} on:click={handleContinue}>
        {#if isCreatingMigration}
          <div class="btn-spinner"></div>
          Creating migration...
        {:else if $wizard.authMode === 'nip46'}
          Prepare {totalSelectedCount} Tweet{totalSelectedCount !== 1 ? 's' : ''}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {:else}
          Claim My {totalSelectedCount} Tweet{totalSelectedCount !== 1 ? 's' : ''}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {/if}
      </button>
    </div>

  {:else}
    <!-- Posts Selection UI (Instagram/TikTok) -->
    <div class="header compact">
      <h2>Own your posts forever</h2>
      <p class="subtitle">Tap to select, then claim on Primal</p>
    </div>

    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'reels'}
        on:click={() => activeTab = 'reels'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Reels
        <span class="tab-count">{$reelPosts.length}</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === 'posts'}
        on:click={() => activeTab = 'posts'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        Posts
        <span class="tab-count">{$imagePosts.length}</span>
      </button>
    </div>

    <div class="toolbar-inline">
      <span class="selection-inline" class:has-selection={currentSelectedCount > 0}>{currentSelectedCount} of {currentPosts.length}</span>
      <button class="link-btn" on:click={selectAllCurrentTab}>Select All</button>
      <button class="link-btn" on:click={deselectAllCurrentTab}>Clear</button>
    </div>

    <div class="posts-grid">
      {#each currentPosts as post (post.id)}
        <button
          class="post-card"
          class:selected={post.selected}
          on:click={() => wizard.togglePost(post.id)}
        >
          <div class="thumbnail-wrapper">
            {#if post.thumbnail_url}
              <img src={post.thumbnail_url} alt="" loading="lazy" />
            {:else}
              <div class="placeholder">
                {#if post.post_type === 'reel'}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                {:else}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                {/if}
              </div>
            {/if}

            {#if post.post_type === 'reel'}
              {#if getFirstMediaDuration(post)}
                <span class="duration">{formatDuration(getFirstMediaDuration(post))}</span>
              {/if}
            {/if}

            {#if post.post_type === 'carousel'}
              <span class="carousel-badge">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="2" width="16" height="16" rx="2"/>
                  <rect x="6" y="6" width="16" height="16" rx="2"/>
                </svg>
                {post.media_items.length}
              </span>
            {/if}

            <div class="select-indicator" class:checked={post.selected}>
              {#if post.selected}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              {/if}
            </div>
            <div class="caption-overlay">
              {#if post.caption}
                <span class="caption-text">{post.caption.split('\n')[0].slice(0, 40)}</span>
              {/if}
            </div>
          </div>
        </button>
      {:else}
        <div class="empty-state">
          <p>No {activeTab === 'reels' ? 'reels' : 'posts'} found</p>
        </div>
      {/each}
    </div>

    <div class="actions">
      <button class="secondary-btn" on:click={handleBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>
      <button class="primary-btn" disabled={totalSelectedCount === 0 || isCreatingMigration} on:click={handleContinue}>
        {#if isCreatingMigration}
          <div class="btn-spinner"></div>
          Creating migration...
        {:else if $wizard.authMode === 'nip46'}
          Prepare {totalSelectedCount} Post{totalSelectedCount !== 1 ? 's' : ''}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {:else}
          Claim My {totalSelectedCount} Post{totalSelectedCount !== 1 ? 's' : ''}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        {/if}
      </button>
    </div>
  {/if}

  {#if showEmailPrompt}
    <div class="email-overlay">
      <div class="email-prompt">
        <div class="email-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M22 7l-10 7L2 7"/>
          </svg>
        </div>
        <h2>Where should we send your link?</h2>
        <p class="email-subtitle">We'll email you when your {$wizard.contentType === 'articles' ? 'articles are' : 'posts are'} ready to claim on Primal.</p>

        <form on:submit|preventDefault={handleEmailSubmit}>
          <input
            type="email"
            placeholder="Enter your email"
            bind:value={email}
            disabled={isCreatingMigration}
            autofocus
          />
          <button type="submit" class="primary-btn" disabled={!email.trim() || isCreatingMigration}>
            {#if isCreatingMigration}
              <span class="btn-spinner"></span>
              Setting up...
            {:else}
              Continue
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            {/if}
          </button>
        </form>

        <button class="skip-link" on:click={handleEmailSkip} disabled={isCreatingMigration}>
          Skip, I'll keep this tab open
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .videos-step {
    width: 100%;
  }

  .header {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .header.compact {
    margin-bottom: 0.75rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    letter-spacing: -0.02em;
  }

  .header.compact h2 {
    font-size: 1.25rem;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 0.875rem;
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
    transition: all 0.2s ease;
  }

  .tab:hover {
    color: var(--text-primary);
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

  .toolbar-inline {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    font-size: 0.8125rem;
  }

  .selection-inline {
    color: var(--text-muted);
    font-weight: 500;
  }

  .selection-inline.has-selection {
    color: var(--accent);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .link-btn:hover {
    color: var(--text-primary);
  }

  .posts-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    max-height: 480px;
    overflow-y: auto;
    margin-bottom: 1.5rem;
    border-radius: 0.375rem;
    overflow-x: hidden;
  }

  .posts-grid::-webkit-scrollbar {
    width: 6px;
  }

  .posts-grid::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 3px;
  }

  .posts-grid::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 3px;
  }

  .post-card {
    background: var(--bg-tertiary);
    border: none;
    border-radius: 0;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    padding: 0;
    transition: all 0.15s ease;
    position: relative;
  }

  .post-card:hover {
    opacity: 0.85;
  }

  .post-card.selected {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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
    transition: transform 0.3s ease;
  }

  .post-card:hover .thumbnail-wrapper img {
    transform: scale(1.05);
  }

  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .caption-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.45);
    padding: 0.125rem 0.25rem;
    pointer-events: none;
  }

  .caption-text {
    display: block;
    font-size: 0.5rem;
    line-height: 1.2;
    color: rgba(255, 255, 255, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
    padding: 0.125rem 0.375rem;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 600;
    color: white;
  }

  .carousel-badge {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.375rem;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 600;
    color: white;
  }

  .select-indicator {
    position: absolute;
    top: 0.2rem;
    right: 0.2rem;
    width: 1rem;
    height: 1rem;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    border: 1.5px solid rgba(255, 255, 255, 0.4);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .select-indicator.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
  }

  .email-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-primary);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .email-prompt {
    max-width: 400px;
    width: 100%;
    text-align: center;
  }

  .email-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    margin: 0 auto 1.5rem;
    background: rgba(var(--accent-rgb), 0.12);
    border-radius: 50%;
    color: var(--accent);
  }

  .email-prompt h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .email-subtitle {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.5;
    margin-bottom: 2rem;
  }

  .email-prompt form {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .email-prompt input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: var(--bg-tertiary);
    border: 1.5px solid var(--border);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 1rem;
    outline: none;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
    text-align: center;
  }

  .email-prompt input:focus {
    border-color: var(--accent);
  }

  .email-prompt input::placeholder {
    color: var(--text-muted);
  }

  .email-prompt .primary-btn {
    width: 100%;
  }

  .skip-link {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.5rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .skip-link:hover:not(:disabled) {
    color: var(--text-secondary);
  }

  .skip-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions {
    display: flex;
    gap: 1rem;
  }

  .secondary-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1.25rem;
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
    border-color: var(--text-secondary);
  }

  .primary-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 0.9375rem;
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
    transform: none;
  }

  .btn-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: btn-spin 0.8s linear infinite;
  }

  @keyframes btn-spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 500px) {
    .posts-grid {
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
    }

    .tabs {
      flex-direction: row;
    }
  }

  /* Article styles */
  .feed-title {
    font-size: 0.875rem;
    color: var(--accent);
    font-weight: 500;
    margin-top: 0.25rem;
  }

  .articles-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 420px;
    overflow-y: auto;
    margin-bottom: 1.5rem;
    padding: 0.25rem;
  }

  .articles-list::-webkit-scrollbar {
    width: 6px;
  }

  .articles-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 3px;
  }

  .articles-list::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 3px;
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
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .article-summary {
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

  .article-card .select-indicator {
    position: relative;
    top: auto;
    right: auto;
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
    background: transparent;
  }

  .article-card .select-indicator.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  @media (max-width: 500px) {
    .article-card {
      flex-direction: column;
    }

    .article-image {
      width: 100%;
      height: 120px;
    }
  }

  /* Twitter Tweets list styles */
  .tweets-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 420px;
    overflow-y: auto;
    margin-bottom: 1.5rem;
    padding: 0.25rem;
  }

  .tweets-list::-webkit-scrollbar {
    width: 6px;
  }

  .tweets-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 3px;
  }

  .tweets-list::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 3px;
  }

  .tweet-card {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem;
    background: var(--bg-tertiary);
    border: 2px solid transparent;
    border-radius: 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
    width: 100%;
  }

  .tweet-card:hover {
    border-color: var(--border-light);
  }

  .tweet-card.selected {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .tweet-media {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 0.5rem;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-primary);
  }

  .tweet-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .media-badge {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.25rem;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 600;
    color: white;
  }

  .tweet-content {
    flex: 1;
    min-width: 0;
  }

  .tweet-text {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }

  .tweet-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .type-badge {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 500;
  }

  .type-badge.text {
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
  }

  .type-badge.video {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .type-badge.photo {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .tweet-card .select-indicator {
    position: relative;
    top: auto;
    right: auto;
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
    background: transparent;
  }

  .tweet-card .select-indicator.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  @media (max-width: 500px) {
    .tweets-list {
      max-height: 50vh;
      gap: 0.375rem;
    }

    .tweet-card {
      padding: 0.75rem;
      gap: 0.625rem;
    }

    .tweet-media {
      width: 48px;
      height: 48px;
    }

    .tweet-text {
      font-size: 0.8125rem;
      -webkit-line-clamp: 2;
      margin-bottom: 0.375rem;
    }

    .tweet-meta {
      gap: 0.375rem;
      font-size: 0.6875rem;
    }

    .tweet-card .select-indicator {
      width: 1.25rem;
      height: 1.25rem;
    }

    .type-badge {
      font-size: 0.625rem;
      padding: 0.0625rem 0.25rem;
    }
  }
</style>
