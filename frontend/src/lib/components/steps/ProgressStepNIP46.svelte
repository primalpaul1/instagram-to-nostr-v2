<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wizard, selectedVideos, type VideoInfo } from '$lib/stores/wizard';
  import {
    createBlossomAuthEvent,
    createVideoPostEvent,
    signWithNIP46,
    createBlossomAuthHeader,
    calculateSHA256,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type VideoMetadata
  } from '$lib/signing';
  import { closeConnection } from '$lib/nip46';

  interface TaskStatus {
    video: VideoInfo;
    status: 'pending' | 'downloading' | 'signing' | 'uploading' | 'publishing' | 'complete' | 'error';
    blossomUrl?: string;
    nostrEventId?: string;
    error?: string;
  }

  let tasks: TaskStatus[] = [];
  let currentTaskIndex = 0;
  let isProcessing = false;

  const BLOSSOM_SERVER = 'https://blossom.primal.net';

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: errorCount = tasks.filter(t => t.status === 'error').length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  $: allDone = completedCount + errorCount === totalCount && totalCount > 0;

  onMount(() => {
    // Initialize tasks from selected videos
    tasks = $selectedVideos.map(video => ({
      video,
      status: 'pending'
    }));

    // Start processing
    startMigration();
  });

  onDestroy(() => {
    // Cleanup NIP-46 connection when done
    if ($wizard.nip46Connection) {
      closeConnection($wizard.nip46Connection);
    }
  });

  async function startMigration() {
    if (isProcessing) return;
    isProcessing = true;

    // Note: NIP-46 users already have an established Nostr profile
    // We skip profile publishing to preserve their existing identity

    try {
      // Process each video
      for (let i = 0; i < tasks.length; i++) {
        currentTaskIndex = i;
        await processVideo(i);
      }

      // All done - move to complete step
      wizard.setStep('complete');
    } catch (err) {
      console.error('Migration error:', err);
    } finally {
      isProcessing = false;
    }
  }

  async function processVideo(index: number) {
    const task = tasks[index];
    if (!$wizard.nip46Connection || !$wizard.nip46Pubkey) {
      tasks[index] = { ...task, status: 'error', error: 'No NIP-46 connection' };
      return;
    }

    try {
      // Step 1: Download video
      tasks[index] = { ...task, status: 'downloading' };
      tasks = [...tasks]; // Trigger reactivity

      // Fetch video through proxy to avoid CORS
      const proxyResponse = await fetch('/api/proxy-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: task.video.url })
      });

      if (!proxyResponse.ok) {
        throw new Error('Failed to download video');
      }

      const videoData = await proxyResponse.arrayBuffer();
      const sha256 = await calculateSHA256(videoData);

      // Step 2: Sign Blossom auth
      tasks[index] = { ...tasks[index], status: 'signing' };
      tasks = [...tasks];

      const authEvent = createBlossomAuthEvent(
        $wizard.nip46Pubkey,
        sha256,
        videoData.byteLength
      );

      const signedAuth = await signWithNIP46($wizard.nip46Connection, authEvent);
      const authHeader = createBlossomAuthHeader(signedAuth);

      // Step 3: Upload to Blossom
      tasks[index] = { ...tasks[index], status: 'uploading' };
      tasks = [...tasks];

      const uploadResponse = await fetch(`${BLOSSOM_SERVER}/upload`, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'video/mp4',
          'X-SHA-256': sha256
        },
        body: videoData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Blossom upload failed: ${errorText}`);
      }

      const uploadData = await uploadResponse.json();
      const blossomUrl = uploadData.url || `${BLOSSOM_SERVER}/${sha256}`;

      // Step 4: Sign video post
      tasks[index] = { ...tasks[index], status: 'signing', blossomUrl };
      tasks = [...tasks];

      const videoMetadata: VideoMetadata = {
        url: task.video.url,
        sha256,
        mimeType: 'video/mp4',
        size: videoData.byteLength,
        width: task.video.width,
        height: task.video.height,
        duration: task.video.duration,
        caption: task.video.caption,
        originalDate: task.video.original_date
      };

      const postEvent = createVideoPostEvent(
        $wizard.nip46Pubkey,
        videoMetadata,
        blossomUrl
      );

      const signedPost = await signWithNIP46($wizard.nip46Connection, postEvent);

      // Step 5: Publish to relays
      tasks[index] = { ...tasks[index], status: 'publishing' };
      tasks = [...tasks];

      const publishResult = await publishToRelays(signedPost, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      // Also import to Primal cache for immediate visibility (especially for old posts)
      try {
        await importToPrimalCache([signedPost]);
      } catch (err) {
        console.warn('Failed to import to Primal cache:', err);
        // Don't fail the task if cache import fails
      }

      // Success!
      tasks[index] = {
        ...tasks[index],
        status: 'complete',
        nostrEventId: signedPost.id
      };
      tasks = [...tasks];

    } catch (err) {
      console.error(`Error processing video ${index}:`, err);
      tasks[index] = {
        ...tasks[index],
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error'
      };
      tasks = [...tasks];
    }
  }

  function getStatusIcon(status: TaskStatus['status']): string {
    switch (status) {
      case 'pending': return '&#9711;';
      case 'downloading': return '&#8635;';
      case 'signing': return '&#128273;';
      case 'uploading': return '&#8635;';
      case 'publishing': return '&#8635;';
      case 'complete': return '&#10003;';
      case 'error': return '&#10007;';
      default: return '&#9711;';
    }
  }

  function getStatusLabel(status: TaskStatus['status']): string {
    switch (status) {
      case 'pending': return 'Waiting';
      case 'downloading': return 'Downloading';
      case 'signing': return 'Signing with Primal';
      case 'uploading': return 'Uploading';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Complete';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }
</script>

<div class="step-content">
  <h2>Migration in progress</h2>
  <p class="description">
    Keep this tab open. Primal is signing each video post.
  </p>

  <div class="progress-container">
    <div class="progress-header">
      <span class="progress-label">
        {completedCount} of {totalCount} videos complete
      </span>
      <span class="progress-percent">{Math.round(progressPercent)}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progressPercent}%"></div>
    </div>
  </div>


  <div class="tasks-list">
    {#each tasks as task, i}
      <div
        class="task-item"
        class:error={task.status === 'error'}
        class:complete={task.status === 'complete'}
        class:active={i === currentTaskIndex && task.status !== 'complete' && task.status !== 'error'}
      >
        <div
          class="task-status"
          class:spinning={['downloading', 'signing', 'uploading', 'publishing'].includes(task.status)}
        >
          {@html getStatusIcon(task.status)}
        </div>
        <div class="task-info">
          <span class="task-caption">
            {task.video.caption?.slice(0, 40) || 'Untitled'}{(task.video.caption?.length ?? 0) > 40 ? '...' : ''}
          </span>
          <span class="task-label">{getStatusLabel(task.status)}</span>
        </div>
        {#if task.status === 'error' && task.error}
          <div class="task-error">{task.error}</div>
        {/if}
      </div>
    {/each}
  </div>

  {#if errorCount > 0}
    <div class="error-summary">
      {errorCount} video{errorCount !== 1 ? 's' : ''} failed to migrate.
      These will be skipped.
    </div>
  {/if}

  <div class="nip46-notice">
    <strong>NIP-46 Mode:</strong> Your secret key stays safely in Primal.
    Each video requires signing approval from your wallet.
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

  .progress-container {
    margin-bottom: 1.5rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .progress-label {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .progress-percent {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--accent);
  }

  .progress-bar {
    height: 0.5rem;
    background: var(--bg-tertiary);
    border-radius: 9999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #ec4899);
    border-radius: 9999px;
    transition: width 0.3s ease;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 300px;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .task-item.active {
    border-color: var(--accent);
    background: rgba(139, 92, 246, 0.1);
  }

  .task-item.complete {
    border-color: var(--success);
    background: rgba(34, 197, 94, 0.1);
  }

  .task-item.error {
    border-color: var(--error);
    background: rgba(239, 68, 68, 0.1);
  }

  .task-status {
    font-size: 1.25rem;
    min-width: 1.5rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .task-item.complete .task-status {
    color: var(--success);
  }

  .task-item.error .task-status {
    color: var(--error);
  }

  .task-item.active .task-status {
    color: var(--accent);
  }

  .task-status.spinning {
    animation: spin 1s linear infinite;
  }

  .task-info {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    min-width: 0;
  }

  .task-caption {
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .task-error {
    width: 100%;
    font-size: 0.75rem;
    color: var(--error);
    margin-left: 2.5rem;
    margin-top: 0.25rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-summary {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--error);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: var(--error);
    text-align: center;
  }

  .nip46-notice {
    margin-top: 1.5rem;
    padding: 0.75rem 1rem;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid var(--accent);
    border-radius: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .nip46-notice strong {
    color: var(--accent);
  }
</style>
