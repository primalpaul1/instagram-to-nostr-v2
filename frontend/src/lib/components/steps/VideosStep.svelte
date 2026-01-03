<script lang="ts">
  import { wizard, reelPosts, imagePosts, selectedPosts, selectedPostsCount } from '$lib/stores/wizard';
  import type { PostInfo } from '$lib/stores/wizard';

  let activeTab: 'reels' | 'posts' = 'reels';

  $: currentPosts = activeTab === 'reels' ? $reelPosts : $imagePosts;
  $: currentSelectedCount = currentPosts.filter(p => p.selected).length;
  $: totalSelectedCount = $selectedPostsCount;

  function handleBack() {
    wizard.setStep('keys');
  }

  function handleContinue() {
    if (totalSelectedCount === 0) return;
    wizard.setStep('confirm');
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
</script>

<div class="videos-step">
  <div class="header">
    <h2>Select content to migrate</h2>
    <p class="subtitle">Choose which posts you want to migrate to Nostr</p>
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

  <div class="toolbar">
    <div class="selection-badge" class:has-selection={currentSelectedCount > 0}>
      <span class="count">{currentSelectedCount}</span>
      <span class="label">of {currentPosts.length} selected</span>
    </div>
    <div class="toolbar-actions">
      <button class="text-btn" on:click={selectAllCurrentTab}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
        Select All
      </button>
      <button class="text-btn" on:click={deselectAllCurrentTab}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
        Clear
      </button>
    </div>
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
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              {:else}
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="16" height="16" rx="2"/>
                <rect x="6" y="6" width="16" height="16" rx="2"/>
              </svg>
              {post.media_items.length}
            </span>
          {/if}

          <div class="select-indicator" class:checked={post.selected}>
            {#if post.selected}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            {/if}
          </div>
          <div class="overlay"></div>
        </div>
        <div class="post-meta">
          {#if post.caption}
            <p class="caption">{post.caption.slice(0, 50)}{post.caption.length > 50 ? '...' : ''}</p>
          {:else}
            <p class="caption empty">No caption</p>
          {/if}
          <div class="details">
            {#if post.original_date}
              <span>{formatDate(post.original_date)}</span>
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
    <button class="primary-btn" disabled={totalSelectedCount === 0} on:click={handleContinue}>
      Continue with {totalSelectedCount} item{totalSelectedCount !== 1 ? 's' : ''}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .videos-step {
    width: 100%;
  }

  .header {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 0.9375rem;
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
    transition: color 0.2s ease;
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
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 0.5rem;
    transition: all 0.2s ease;
  }

  .text-btn:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .posts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.875rem;
    max-height: 420px;
    overflow-y: auto;
    padding: 0.25rem;
    margin-bottom: 1.5rem;
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
    transform: translateY(-2px);
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

  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .post-card:hover .overlay {
    opacity: 1;
  }

  .duration {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: white;
  }

  .carousel-badge {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: white;
  }

  .select-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 1.5rem;
    height: 1.5rem;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    border: 2px solid rgba(255, 255, 255, 0.5);
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .select-indicator.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .post-meta {
    padding: 0.75rem;
  }

  .caption {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-primary);
    margin-bottom: 0.375rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .caption.empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .details {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
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

  @media (max-width: 500px) {
    .posts-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .toolbar {
      flex-direction: column;
      gap: 0.75rem;
      align-items: stretch;
    }

    .selection-badge {
      justify-content: center;
    }

    .toolbar-actions {
      justify-content: center;
    }

    .tabs {
      flex-direction: column;
    }
  }
</style>
