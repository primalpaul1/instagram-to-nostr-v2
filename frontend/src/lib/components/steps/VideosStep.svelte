<script lang="ts">
  import { wizard, selectedCount } from '$lib/stores/wizard';

  function handleBack() {
    wizard.setStep('keys');
  }

  function handleContinue() {
    if ($selectedCount === 0) return;
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
</script>

<div class="videos-step">
  <div class="header">
    <h2>Select videos to migrate</h2>
    <p class="subtitle">Choose which videos you want to migrate to Nostr</p>
  </div>

  <div class="toolbar">
    <div class="selection-badge" class:has-selection={$selectedCount > 0}>
      <span class="count">{$selectedCount}</span>
      <span class="label">of {$wizard.videos.length} selected</span>
    </div>
    <div class="toolbar-actions">
      <button class="text-btn" on:click={() => wizard.selectAll()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
        Select All
      </button>
      <button class="text-btn" on:click={() => wizard.deselectAll()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
        Clear
      </button>
    </div>
  </div>

  <div class="videos-grid">
    {#each $wizard.videos as video}
      <button
        class="video-card"
        class:selected={video.selected}
        on:click={() => wizard.toggleVideo(video.url)}
      >
        <div class="thumbnail-wrapper">
          {#if video.thumbnail_url}
            <img src={video.thumbnail_url} alt="" loading="lazy" />
          {:else}
            <div class="placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
          {/if}
          {#if video.duration}
            <span class="duration">{formatDuration(video.duration)}</span>
          {/if}
          <div class="select-indicator" class:checked={video.selected}>
            {#if video.selected}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            {/if}
          </div>
          <div class="overlay"></div>
        </div>
        <div class="video-meta">
          {#if video.caption}
            <p class="caption">{video.caption.slice(0, 50)}{video.caption.length > 50 ? '...' : ''}</p>
          {:else}
            <p class="caption empty">No caption</p>
          {/if}
          <div class="details">
            {#if video.original_date}
              <span>{formatDate(video.original_date)}</span>
            {/if}
          </div>
        </div>
      </button>
    {/each}
  </div>

  <div class="actions">
    <button class="secondary-btn" on:click={handleBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Back
    </button>
    <button class="primary-btn" disabled={$selectedCount === 0} on:click={handleContinue}>
      Continue with {$selectedCount} video{$selectedCount !== 1 ? 's' : ''}
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

  .videos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.875rem;
    max-height: 420px;
    overflow-y: auto;
    padding: 0.25rem;
    margin-bottom: 1.5rem;
  }

  .videos-grid::-webkit-scrollbar {
    width: 6px;
  }

  .videos-grid::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 3px;
  }

  .videos-grid::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 3px;
  }

  .video-card {
    background: var(--bg-tertiary);
    border: 2px solid transparent;
    border-radius: 0.75rem;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    padding: 0;
    transition: all 0.2s ease;
  }

  .video-card:hover {
    border-color: var(--border-light);
    transform: translateY(-2px);
  }

  .video-card.selected {
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

  .video-card:hover .thumbnail-wrapper img {
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

  .video-card:hover .overlay {
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

  .video-meta {
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
    .videos-grid {
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
  }
</style>
