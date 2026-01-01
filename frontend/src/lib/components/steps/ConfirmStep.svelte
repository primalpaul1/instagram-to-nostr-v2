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
        // NIP-46 mode: Frontend handles migration directly
        // No need to create a job - go straight to progress-nip46
        wizard.setStep('progress-nip46');
      } else {
        // Generate keys mode: Create job for worker to process
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

<div class="step-content">
  <h2>Confirm migration</h2>
  <p class="description">
    Review your selection before starting the migration.
  </p>

  <div class="summary">
    <div class="summary-row">
      <span class="label">Instagram Handle</span>
      <span class="value">@{$wizard.handle}</span>
    </div>

    <div class="summary-row">
      <span class="label">Nostr Public Key</span>
      <code class="value">{displayNpub.slice(0, 20)}...</code>
    </div>

    {#if isNip46Mode}
      <div class="summary-row">
        <span class="label">Auth Mode</span>
        <span class="value mode-badge">Connected via Primal</span>
      </div>
    {/if}

    <div class="summary-row highlight">
      <span class="label">Videos to migrate</span>
      <span class="value count">{$selectedVideos.length}</span>
    </div>
  </div>

  <div class="video-preview">
    <h3>Selected videos</h3>
    <div class="preview-list">
      {#each $selectedVideos as video, i}
        <div class="preview-item">
          <span class="preview-number">{i + 1}</span>
          <span class="preview-caption">
            {video.caption?.slice(0, 50) || 'Untitled'}{(video.caption?.length ?? 0) > 50 ? '...' : ''}
          </span>
        </div>
      {/each}
    </div>
  </div>

  <div class="info-box">
    <strong>What happens next:</strong>
    <ul>
      <li>Each video will be downloaded from Instagram</li>
      <li>Videos are uploaded to Blossom media server</li>
      <li>Posts are published to multiple Nostr relays</li>
      {#if isNip46Mode}
        <li>Your Primal wallet will sign each post</li>
        <li><strong>Keep this browser tab open during migration</strong></li>
      {:else}
        <li>This may take several minutes depending on video count</li>
      {/if}
    </ul>
  </div>

  <div class="actions">
    <button class="secondary" on:click={handleBack} disabled={loading}>
      Back
    </button>
    <button class="primary" on:click={handleStart} disabled={loading}>
      {#if loading}
        <span class="spinner"></span>
        Starting...
      {:else}
        Start Migration
      {/if}
    </button>
  </div>
</div>

<style>
  .step-content {
    max-width: 600px;
    margin: 0 auto;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
    text-align: center;
  }

  .description {
    color: var(--text-secondary);
    margin-bottom: 2rem;
    text-align: center;
  }

  .summary {
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
  }

  .summary-row:last-child {
    border-bottom: none;
  }

  .summary-row.highlight {
    background: rgba(139, 92, 246, 0.1);
    margin: 0 -1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.25rem;
    border-bottom: none;
  }

  .label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .value {
    font-weight: 500;
  }

  .value.count {
    font-size: 1.5rem;
    color: var(--accent);
    font-weight: 700;
  }

  .mode-badge {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  code.value {
    font-family: monospace;
    font-size: 0.75rem;
    background: var(--bg-primary);
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .video-preview {
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .video-preview h3 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .preview-list {
    max-height: 150px;
    overflow-y: auto;
  }

  .preview-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.875rem;
  }

  .preview-item:last-child {
    border-bottom: none;
  }

  .preview-number {
    color: var(--text-secondary);
    min-width: 1.5rem;
  }

  .preview-caption {
    color: var(--text-primary);
  }

  .info-box {
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid var(--accent);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  .info-box strong {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--accent);
  }

  .info-box ul {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text-secondary);
  }

  .info-box li {
    margin: 0.25rem 0;
  }

  .info-box li strong {
    display: inline;
    color: var(--warning);
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
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .actions .secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .actions .secondary:hover:not(:disabled) {
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

  .actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
