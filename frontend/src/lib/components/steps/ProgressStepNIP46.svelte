<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wizard, selectedPosts, type PostInfo, type MediaItemInfo, getMediaCache, clearMediaCache } from '$lib/stores/wizard';
  import {
    createBlossomAuthEvent,
    createMultiMediaPostEvent,
    signWithNIP46,
    createBlossomAuthHeader,
    calculateSHA256,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload
  } from '$lib/signing';
  import { closeConnection } from '$lib/nip46';

  interface TaskStatus {
    post: PostInfo;
    status: 'pending' | 'downloading' | 'signing' | 'uploading' | 'publishing' | 'complete' | 'error';
    blossomUrls?: string[];
    nostrEventId?: string;
    error?: string;
    mediaProgress?: { current: number; total: number };
  }

  let tasks: TaskStatus[] = [];
  let isProcessing = false;
  let activeIndices: Set<number> = new Set();

  const BLOSSOM_SERVER = 'https://blossom.primal.net';
  const CONCURRENCY = 2; // Process 2 posts at a time

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: errorCount = tasks.filter(t => t.status === 'error').length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  $: allDone = completedCount + errorCount === totalCount && totalCount > 0;

  onMount(() => {
    tasks = $selectedPosts.map(post => ({
      post,
      status: 'pending'
    }));
    startMigration();
  });

  onDestroy(() => {
    if ($wizard.nip46Connection) {
      closeConnection($wizard.nip46Connection);
    }
    clearMediaCache();
  });

  async function startMigration() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      // Create a queue of task indices
      const queue: number[] = [...Array(tasks.length).keys()];

      // Process queue with worker functions
      async function processQueue() {
        while (queue.length > 0) {
          const index = queue.shift();
          if (index !== undefined) {
            activeIndices.add(index);
            activeIndices = activeIndices; // Trigger reactivity
            await processPost(index);
            activeIndices.delete(index);
            activeIndices = activeIndices;
          }
        }
      }

      // Start CONCURRENCY number of workers
      const workers = Array(CONCURRENCY).fill(null).map(() => processQueue());
      await Promise.all(workers);

      wizard.setStep('complete');
    } catch (err) {
      console.error('Migration error:', err);
    } finally {
      isProcessing = false;
      clearMediaCache();
    }
  }

  async function uploadMediaItem(
    mediaItem: MediaItemInfo,
    pubkey: string
  ): Promise<MediaUpload> {
    // Check cache first (from pre-download)
    let mediaData = getMediaCache(mediaItem.url);

    if (!mediaData) {
      // Download if not cached
      const proxyResponse = await fetch('/api/proxy-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mediaItem.url })
      });

      if (!proxyResponse.ok) {
        throw new Error(`Failed to download ${mediaItem.media_type}`);
      }

      mediaData = await proxyResponse.arrayBuffer();
    }
    const sha256 = await calculateSHA256(mediaData);

    // Create and sign auth event
    const authEvent = createBlossomAuthEvent(pubkey, sha256, mediaData.byteLength);
    const signedAuth = await signWithNIP46($wizard.nip46Connection!, authEvent);
    const authHeader = createBlossomAuthHeader(signedAuth);

    // Determine content type
    const mimeType = mediaItem.media_type === 'video' ? 'video/mp4' : 'image/jpeg';

    // Upload to Blossom
    const uploadResponse = await fetch(`${BLOSSOM_SERVER}/upload`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': mimeType,
        'X-SHA-256': sha256
      },
      body: mediaData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Blossom upload failed: ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    const blossomUrl = uploadData.url || `${BLOSSOM_SERVER}/${sha256}`;

    return {
      url: blossomUrl,
      sha256,
      mimeType,
      size: mediaData.byteLength,
      width: mediaItem.width,
      height: mediaItem.height
    };
  }

  async function processPost(index: number) {
    const task = tasks[index];
    if (!$wizard.nip46Connection || !$wizard.nip46Pubkey) {
      tasks[index] = { ...task, status: 'error', error: 'No NIP-46 connection' };
      return;
    }

    try {
      const mediaItems = task.post.media_items;

      // Upload all media items (parallel for carousels)
      tasks[index] = {
        ...task,
        status: 'downloading',
        mediaProgress: { current: 0, total: mediaItems.length }
      };
      tasks = [...tasks];

      // Track progress across parallel uploads
      let completedUploads = 0;
      const updateProgress = () => {
        completedUploads++;
        tasks[index] = {
          ...tasks[index],
          mediaProgress: { current: completedUploads, total: mediaItems.length }
        };
        tasks = [...tasks];
      };

      // Upload all items in parallel, preserving order
      const uploadPromises = mediaItems.map((item, i) =>
        uploadMediaItem(item, $wizard.nip46Pubkey!).then(upload => {
          updateProgress();
          return { index: i, upload };
        })
      );
      const results = await Promise.all(uploadPromises);
      const mediaUploads = results.sort((a, b) => a.index - b.index).map(r => r.upload);

      tasks[index] = {
        ...tasks[index],
        status: 'signing',
        blossomUrls: mediaUploads.map(u => u.url)
      };
      tasks = [...tasks];

      // Create post event with all media
      const postEvent = createMultiMediaPostEvent(
        $wizard.nip46Pubkey,
        mediaUploads,
        task.post.caption,
        task.post.original_date
      );

      const signedPost = await signWithNIP46($wizard.nip46Connection, postEvent);

      tasks[index] = { ...tasks[index], status: 'publishing' };
      tasks = [...tasks];

      const publishResult = await publishToRelays(signedPost, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      try {
        await importToPrimalCache([signedPost]);
      } catch (err) {
        console.warn('Failed to import to Primal cache:', err);
      }

      tasks[index] = {
        ...tasks[index],
        status: 'complete',
        nostrEventId: signedPost.id
      };
      tasks = [...tasks];

    } catch (err) {
      console.error(`Error processing post ${index}:`, err);
      tasks[index] = {
        ...tasks[index],
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error'
      };
      tasks = [...tasks];
    }
  }

  function getStatusLabel(task: TaskStatus): string {
    switch (task.status) {
      case 'pending': return 'Waiting';
      case 'downloading':
        if (task.mediaProgress && task.mediaProgress.total > 1) {
          return `Downloading ${task.mediaProgress.current}/${task.mediaProgress.total}`;
        }
        return 'Downloading';
      case 'signing': return 'Signing';
      case 'uploading': return 'Uploading';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Done';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }

  function getPostTypeIcon(postType: string): string {
    switch (postType) {
      case 'reel': return '▶';
      case 'carousel': return '⧉';
      default: return '□';
    }
  }
</script>

<div class="progress-step">
  <div class="header">
    <div class="migrating-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 2l4 4-4 4"/>
        <path d="M3 11v-1a4 4 0 014-4h14"/>
        <path d="M7 22l-4-4 4-4"/>
        <path d="M21 13v1a4 4 0 01-4 4H3"/>
      </svg>
    </div>
    <h2>Migration in progress</h2>
    <p class="subtitle">Primal is signing each video post</p>
  </div>

  <div class="progress-card">
    <div class="progress-header">
      <div class="progress-stats">
        <span class="current">{completedCount}</span>
        <span class="divider">/</span>
        <span class="total">{totalCount}</span>
        <span class="label">posts</span>
      </div>
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
        class:active={activeIndices.has(i) && task.status !== 'complete' && task.status !== 'error'}
      >
        <div class="task-status">
          {#if task.status === 'complete'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          {:else if task.status === 'error'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          {:else if ['downloading', 'signing', 'uploading', 'publishing'].includes(task.status)}
            <div class="task-spinner"></div>
          {:else}
            <div class="task-pending"></div>
          {/if}
        </div>
        <div class="task-info">
          <div class="task-caption-row">
            <span class="task-type-icon" class:reel={task.post.post_type === 'reel'}>{getPostTypeIcon(task.post.post_type)}</span>
            <span class="task-caption">{task.post.caption?.slice(0, 30) || 'Untitled'}{(task.post.caption?.length ?? 0) > 30 ? '...' : ''}</span>
          </div>
          <span class="task-label">{getStatusLabel(task)}</span>
        </div>
      </div>
      {#if task.status === 'error' && task.error}
        <div class="task-error-msg">{task.error}</div>
      {/if}
    {/each}
  </div>

  {#if errorCount > 0}
    <div class="error-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>{errorCount} post{errorCount !== 1 ? 's' : ''} failed. They will be skipped.</span>
    </div>
  {/if}

  <div class="nip46-banner">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
    <div class="nip46-content">
      <strong>Secure Remote Signing</strong>
      <span>Your secret key stays safely in Primal</span>
    </div>
  </div>
</div>

<style>
  .progress-step {
    max-width: 520px;
    margin: 0 auto;
  }

  .header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .migrating-icon {
    width: 3.5rem;
    height: 3.5rem;
    background: rgba(var(--accent-rgb), 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    margin: 0 auto 1rem;
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.2); }
    50% { box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0); }
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

  .progress-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.75rem;
  }

  .progress-stats {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .progress-stats .current {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent);
  }

  .progress-stats .divider {
    color: var(--text-muted);
    margin: 0 0.125rem;
  }

  .progress-stats .total {
    font-size: 1rem;
    color: var(--text-secondary);
  }

  .progress-stats .label {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-left: 0.375rem;
  }

  .progress-percent {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .progress-bar {
    height: 6px;
    background: var(--bg-primary);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent-gradient);
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 250px;
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .tasks-list::-webkit-scrollbar {
    width: 4px;
  }

  .tasks-list::-webkit-scrollbar-thumb {
    background: var(--border-light);
    border-radius: 2px;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    transition: all 0.2s ease;
  }

  .task-item.active {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
  }

  .task-item.complete {
    border-color: var(--success);
    background: rgba(var(--success-rgb), 0.08);
  }

  .task-item.error {
    border-color: var(--error);
    background: rgba(255, 75, 75, 0.08);
  }

  .task-status {
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .task-item.complete .task-status {
    color: var(--success);
  }

  .task-item.error .task-status {
    color: var(--error);
  }

  .task-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--border-light);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .task-pending {
    width: 0.5rem;
    height: 0.5rem;
    background: var(--text-muted);
    border-radius: 50%;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .task-info {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .task-caption-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }

  .task-type-icon {
    font-size: 0.625rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .task-type-icon.reel {
    color: var(--accent);
  }

  .task-caption {
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  .task-item.active .task-label {
    color: var(--accent);
  }

  .task-item.complete .task-label {
    color: var(--success);
  }

  .task-item.error .task-label {
    color: var(--error);
  }

  .task-error-msg {
    font-size: 0.75rem;
    color: var(--error);
    padding: 0.25rem 1rem 0.25rem 3.375rem;
    margin-top: -0.375rem;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-top: 1rem;
    padding: 0.875rem 1rem;
    background: rgba(255, 75, 75, 0.1);
    border: 1px solid var(--error);
    border-radius: 0.75rem;
    color: var(--error);
    font-size: 0.8125rem;
  }

  .nip46-banner {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    margin-top: 1.5rem;
    padding: 1rem 1.25rem;
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.2);
    border-radius: 0.75rem;
    color: var(--accent);
  }

  .nip46-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .nip46-content strong {
    font-size: 0.8125rem;
    color: var(--accent);
  }

  .nip46-content span {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
</style>
