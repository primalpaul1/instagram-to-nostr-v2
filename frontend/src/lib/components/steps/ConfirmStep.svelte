<script lang="ts">
  import { wizard, selectedVideos } from '$lib/stores/wizard';
  import { hexToNpub } from '$lib/nip46';

  let loading = false;

  $: isNip46Mode = $wizard.authMode === 'nip46';
  $: displayNpub = isNip46Mode
    ? ($wizard.nip46Pubkey ? hexToNpub($wizard.nip46Pubkey) : '')
    : $wizard.keyPair?.npub || '';

  function handleBack() {
    wizard.setStep('videos');
  }

  async function handleStart() {
    if (loading) return;

    loading = true;
    wizard.setLoading(true);
    wizard.setError(null);

    try {
      if (isNip46Mode) {
        wizard.setStep('progress-nip46');
      } else {
        const videos = $selectedVideos.map(v => ({
          url: v.url,
          filename: v.filename,
          caption: v.caption,
          original_date: v.original_date,
          width: v.width,
          height: v.height,
          duration: v.duration,
          thumbnail_url: v.thumbnail_url
        }));

        const response = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle: $wizard.handle,
            publicKey: $wizard.keyPair?.publicKey,
            secretKey: $wizard.keyPair?.secretKey,
            videos,
            profile: $wizard.profile
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create job');
        }

        const data = await response.json();
        wizard.setJobId(data.jobId);
        wizard.setStep('progress');
      }
    } catch (err) {
      wizard.setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      loading = false;
      wizard.setLoading(false);
    }
  }
</script>

<div class="confirm-step">
  <div class="header">
    <h2>Ready to migrate</h2>
    <p class="subtitle">Review your selection before starting</p>
  </div>

  <div class="summary-card">
    <div class="summary-item">
      <span class="summary-label">Instagram</span>
      <span class="summary-value">@{$wizard.handle}</span>
    </div>
    <div class="divider"></div>
    <div class="summary-item">
      <span class="summary-label">Nostr Key</span>
      <code class="summary-value mono">{displayNpub.slice(0, 16)}...</code>
    </div>
    {#if isNip46Mode}
      <div class="divider"></div>
      <div class="summary-item">
        <span class="summary-label">Signing</span>
        <span class="auth-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Primal Connected
        </span>
      </div>
    {/if}
    <div class="divider"></div>
    <div class="summary-item highlight">
      <span class="summary-label">Videos</span>
      <span class="video-count">{$selectedVideos.length}</span>
    </div>
  </div>

  <div class="preview-section">
    <div class="preview-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span>Selected videos</span>
    </div>
    <div class="preview-list">
      {#each $selectedVideos as video, i}
        <div class="preview-item">
          <span class="item-number">{i + 1}</span>
          <span class="item-title">{video.caption?.slice(0, 45) || 'Untitled video'}{(video.caption?.length ?? 0) > 45 ? '...' : ''}</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="info-card">
    <div class="info-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4M12 8h.01"/>
      </svg>
      <span>What happens next</span>
    </div>
    <ul class="info-list">
      <li>Videos download from Instagram</li>
      <li>Upload to Blossom media server</li>
      <li>Publish to Nostr relays</li>
      {#if isNip46Mode}
        <li class="highlight">Your Primal wallet signs each post</li>
      {/if}
    </ul>
    {#if isNip46Mode}
      <div class="warning-note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Keep this tab open during migration</span>
      </div>
    {/if}
  </div>

  <div class="actions">
    <button class="secondary-btn" on:click={handleBack} disabled={loading}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Back
    </button>
    <button class="primary-btn" on:click={handleStart} disabled={loading}>
      {#if loading}
        <span class="spinner"></span>
        Starting...
      {:else}
        Start Migration
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      {/if}
    </button>
  </div>
</div>

<style>
  .confirm-step {
    max-width: 520px;
    margin: 0 auto;
  }

  .header {
    text-align: center;
    margin-bottom: 2rem;
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

  .summary-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .summary-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.625rem 0;
  }

  .summary-item.highlight {
    background: rgba(var(--accent-rgb), 0.1);
    margin: 0 -1.25rem;
    padding: 0.875rem 1.25rem;
    border-radius: 0.5rem;
  }

  .summary-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .summary-value {
    font-weight: 500;
    color: var(--text-primary);
  }

  .summary-value.mono {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75rem;
    background: var(--bg-primary);
    padding: 0.375rem 0.625rem;
    border-radius: 0.375rem;
    color: var(--text-secondary);
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.25rem 0;
  }

  .auth-badge {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: rgba(var(--success-rgb), 0.15);
    color: var(--success);
    padding: 0.375rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .video-count {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent);
  }

  .preview-section {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .preview-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .preview-list {
    max-height: 140px;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .preview-list::-webkit-scrollbar {
    width: 4px;
  }

  .preview-list::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 2px;
  }

  .preview-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1.25rem;
    font-size: 0.8125rem;
  }

  .item-number {
    color: var(--text-muted);
    font-weight: 500;
    min-width: 1.25rem;
  }

  .item-title {
    color: var(--text-primary);
  }

  .info-card {
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.2);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 2rem;
  }

  .info-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .info-list {
    margin: 0;
    padding-left: 1.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .info-list li {
    padding: 0.25rem 0;
  }

  .info-list li.highlight {
    color: var(--accent);
  }

  .warning-note {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(var(--accent-rgb), 0.2);
    color: var(--warning);
    font-size: 0.8125rem;
    font-weight: 500;
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

  .secondary-btn:hover:not(:disabled) {
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

  .primary-btn:disabled,
  .secondary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .spinner {
    width: 1.125rem;
    height: 1.125rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
