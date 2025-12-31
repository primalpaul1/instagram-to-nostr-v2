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
      return new Date(date).toLocaleDateString();
    } catch {
      return '';
    }
  }
</script>

<div class="step-content">
  <div class="header">
    <h2>Select videos to migrate</h2>
    <p class="description">
      Choose which videos you want to migrate to Nostr. Videos will be uploaded to Blossom
      and published as posts.
    </p>
  </div>

  <div class="toolbar">
    <div class="selection-info">
      {$selectedCount} of {$wizard.videos.length} selected
    </div>
    <div class="toolbar-actions">
      <button class="text-btn" on:click={() => wizard.selectAll()}>Select All</button>
      <button class="text-btn" on:click={() => wizard.deselectAll()}>Deselect All</button>
    </div>
  </div>

  <div class="videos-grid">
    {#each $wizard.videos as video}
      <button
        class="video-card"
        class:selected={video.selected}
        on:click={() => wizard.toggleVideo(video.url)}
      >
        <div class="video-thumbnail">
          {#if video.thumbnail_url}
            <img src={video.thumbnail_url} alt="" loading="lazy" />
          {:else}
            <div class="placeholder-thumb">
              <span>&#9658;</span>
            </div>
          {/if}
          {#if video.duration}
            <span class="duration">{formatDuration(video.duration)}</span>
          {/if}
          <div class="checkbox" class:checked={video.selected}>
            {#if video.selected}
              <span>&#10003;</span>
            {/if}
          </div>
        </div>
        <div class="video-info">
          {#if video.caption}
            <p class="caption">{video.caption.slice(0, 60)}{video.caption.length > 60 ? '...' : ''}</p>
          {:else}
            <p class="caption no-caption">No caption</p>
          {/if}
          <div class="meta">
            {#if video.original_date}
              <span>{formatDate(video.original_date)}</span>
            {/if}
            {#if video.width && video.height}
              <span>{video.width}x{video.height}</span>
            {/if}
          </div>
        </div>
      </button>
    {/each}
  </div>

  <div class="actions">
    <button class="secondary" on:click={handleBack}>Back</button>
    <button class="primary" disabled={$selectedCount === 0} on:click={handleContinue}>
      Continue with {$selectedCount} video{$selectedCount !== 1 ? 's' : ''}
    </button>
  </div>
</div>

<style>
  .step-content {
    max-width: 100%;
  }

  .header {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
  }

  .description {
    color: var(--text-secondary);
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .selection-info {
    font-weight: 600;
    color: var(--accent);
  }

  .toolbar-actions {
    display: flex;
    gap: 1rem;
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.875rem;
    padding: 0.25rem 0.5rem;
  }

  .text-btn:hover {
    color: var(--text-primary);
  }

  .videos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
    max-height: 400px;
    overflow-y: auto;
    padding: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .video-card {
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    padding: 0;
  }

  .video-card:hover {
    border-color: var(--text-secondary);
  }

  .video-card.selected {
    border-color: var(--accent);
    background: rgba(139, 92, 246, 0.1);
  }

  .video-thumbnail {
    position: relative;
    aspect-ratio: 1;
    background: var(--bg-primary);
  }

  .video-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder-thumb {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: var(--text-secondary);
  }

  .duration {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    background: rgba(0, 0, 0, 0.8);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .checkbox {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 1.5rem;
    height: 1.5rem;
    background: var(--bg-primary);
    border: 2px solid var(--border);
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .checkbox.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .video-info {
    padding: 0.75rem;
  }

  .caption {
    font-size: 0.75rem;
    line-height: 1.4;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
  }

  .caption.no-caption {
    color: var(--text-secondary);
    font-style: italic;
  }

  .meta {
    display: flex;
    gap: 0.75rem;
    font-size: 0.625rem;
    color: var(--text-secondary);
  }

  .actions {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .actions button {
    padding: 0.875rem 1.5rem;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .actions .secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .actions .secondary:hover {
    border-color: var(--text-secondary);
  }

  .actions .primary {
    flex: 1;
    background: var(--accent);
    border: none;
    color: white;
  }

  .actions .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .actions .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 500px) {
    .videos-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
