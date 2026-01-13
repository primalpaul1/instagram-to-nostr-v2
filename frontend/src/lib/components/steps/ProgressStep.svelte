<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wizard, selectedArticles } from '$lib/stores/wizard';
  import type { ArticleInfo } from '$lib/stores/wizard';
  import {
    createBlossomAuthEvent,
    createLongFormContentEvent,
    createBlossomAuthHeader,
    calculateSHA256,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type ArticleMetadata
  } from '$lib/signing';
  import { generateSecretKey, getPublicKey, finalizeEvent, type EventTemplate, type Event } from 'nostr-tools';

  // Post task status (for backend job polling)
  interface TaskStatus {
    id: string;
    status: 'pending' | 'uploading' | 'publishing' | 'complete' | 'error';
    caption?: string;
    blossom_url?: string;
    nostr_event_id?: string;
    error?: string;
  }

  interface JobStatus {
    status: 'pending' | 'processing' | 'complete' | 'error';
    tasks: TaskStatus[];
  }

  // Article task status (for client-side publishing)
  interface ArticleTaskStatus {
    article: ArticleInfo;
    status: 'pending' | 'uploading' | 'signing' | 'publishing' | 'complete' | 'error';
    blossomImageUrl?: string;
    nostrEventId?: string;
    error?: string;
  }

  // Posts state
  let jobStatus: JobStatus | null = null;
  let pollInterval: ReturnType<typeof setInterval>;

  // Articles state
  let articleTasks: ArticleTaskStatus[] = [];
  let isProcessingArticles = false;
  let publishedEvents: Event[] = [];

  const BLOSSOM_SERVER = 'https://blossom.primal.net';
  const CONCURRENCY = 2;

  // Reactive counts based on content type
  $: isArticleMode = $wizard.contentType === 'articles';
  $: completedCount = isArticleMode
    ? articleTasks.filter(t => t.status === 'complete').length
    : (jobStatus?.tasks.filter(t => t.status === 'complete').length ?? 0);
  $: totalCount = isArticleMode
    ? articleTasks.length
    : (jobStatus?.tasks.length ?? 0);
  $: errorCount = isArticleMode
    ? articleTasks.filter(t => t.status === 'error').length
    : (jobStatus?.tasks.filter(t => t.status === 'error').length ?? 0);
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  $: allArticlesDone = isArticleMode && articleTasks.length > 0 && (completedCount + errorCount === totalCount);

  onMount(() => {
    if ($wizard.contentType === 'articles') {
      startArticlePublishing();
    } else {
      pollStatus();
      pollInterval = setInterval(pollStatus, 2000);
    }
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  // Posts: poll backend job status
  async function pollStatus() {
    if (!$wizard.jobId) return;

    try {
      const response = await fetch(`/api/jobs/${$wizard.jobId}/status`);
      if (!response.ok) throw new Error('Failed to fetch status');

      jobStatus = await response.json();

      if (jobStatus?.status === 'complete' || jobStatus?.status === 'error') {
        clearInterval(pollInterval);
        wizard.setStep('complete');
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  }

  // Articles: client-side publishing
  async function startArticlePublishing() {
    const selected = $selectedArticles;
    if (selected.length === 0) {
      wizard.setStep('complete');
      return;
    }

    articleTasks = selected.map(article => ({
      article,
      status: 'pending'
    }));

    isProcessingArticles = true;
    await publishArticles();
  }

  async function publishArticles() {
    if (!$wizard.keyPair) {
      console.error('No keypair available');
      return;
    }

    // Convert hex secret key to Uint8Array
    const secretKeyHex = $wizard.keyPair.secretKey;
    const secretKey = new Uint8Array(secretKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const publicKey = $wizard.keyPair.publicKey;

    try {
      const queue: number[] = [...Array(articleTasks.length).keys()];

      async function processQueue() {
        while (queue.length > 0) {
          const index = queue.shift();
          if (index !== undefined) {
            await processArticle(index, secretKey, publicKey);
          }
        }
      }

      const workers = Array(CONCURRENCY).fill(null).map(() => processQueue());
      await Promise.all(workers);

      // Import all published events to Primal cache
      if (publishedEvents.length > 0) {
        await importToPrimalCache(publishedEvents);
      }

      wizard.setStep('complete');
    } catch (err) {
      console.error('Publishing error:', err);
    } finally {
      isProcessingArticles = false;
    }
  }

  async function processArticle(index: number, secretKey: Uint8Array, publicKey: string) {
    const task = articleTasks[index];

    try {
      // Step 1: Upload header image if exists
      articleTasks[index].status = 'uploading';
      articleTasks = articleTasks;

      let headerImageUrl: string | undefined;
      if (task.article.image_url) {
        try {
          headerImageUrl = await uploadImage(task.article.image_url, secretKey, publicKey);
          articleTasks[index].blossomImageUrl = headerImageUrl;
          articleTasks = articleTasks;
        } catch (err) {
          console.warn('Failed to upload header image:', err);
          headerImageUrl = task.article.image_url;
        }
      }

      // Step 2: Process inline images in content
      let processedContent = task.article.content_markdown;
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      const imageReplacements: { original: string; blossom: string }[] = [];

      const imagesToUpload: string[] = [];
      while ((match = imageRegex.exec(task.article.content_markdown)) !== null) {
        const imageUrl = match[2];
        if (!imagesToUpload.includes(imageUrl)) {
          imagesToUpload.push(imageUrl);
        }
      }

      for (const imageUrl of imagesToUpload) {
        try {
          const blossomUrl = await uploadImage(imageUrl, secretKey, publicKey);
          imageReplacements.push({ original: imageUrl, blossom: blossomUrl });
        } catch (err) {
          console.warn('Failed to upload inline image:', imageUrl, err);
        }
      }

      for (const { original, blossom } of imageReplacements) {
        processedContent = processedContent.split(original).join(blossom);
      }

      // Step 3: Create and sign the event
      articleTasks[index].status = 'signing';
      articleTasks = articleTasks;

      const articleData: ArticleMetadata = {
        identifier: task.article.id,
        title: task.article.title,
        summary: task.article.summary,
        imageUrl: headerImageUrl,
        publishedAt: task.article.published_at,
        hashtags: task.article.hashtags || [],
        content: processedContent
      };

      const eventTemplate = createLongFormContentEvent(publicKey, articleData);
      const signedEvent = finalizeEvent(eventTemplate as EventTemplate, secretKey);

      // Step 4: Publish to relays
      articleTasks[index].status = 'publishing';
      articleTasks = articleTasks;

      const publishResult = await publishToRelays(signedEvent, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      articleTasks[index].nostrEventId = signedEvent.id;
      articleTasks[index].status = 'complete';
      articleTasks = articleTasks;

      publishedEvents.push(signedEvent);
    } catch (err) {
      console.error('Error processing article:', err);
      articleTasks[index].status = 'error';
      articleTasks[index].error = err instanceof Error ? err.message : 'Unknown error';
      articleTasks = articleTasks;
    }
  }

  async function uploadImage(imageUrl: string, secretKey: Uint8Array, publicKey: string): Promise<string> {
    const response = await fetch('/api/proxy-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch image');
    }

    const imageData = await response.arrayBuffer();
    const sha256 = await calculateSHA256(imageData);
    const size = imageData.byteLength;
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    const authEvent = createBlossomAuthEvent(publicKey, sha256, size);
    const signedAuth = finalizeEvent(authEvent as EventTemplate, secretKey);
    const authHeader = createBlossomAuthHeader(signedAuth);

    const uploadResponse = await fetch(`${BLOSSOM_SERVER}/upload`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': contentType,
        'X-SHA-256': sha256
      },
      body: imageData
    });

    if (!uploadResponse.ok) {
      throw new Error('Blossom upload failed');
    }

    const result = await uploadResponse.json();
    return result.url || `${BLOSSOM_SERVER}/${sha256}`;
  }

  function getStatusLabel(status: TaskStatus['status'] | ArticleTaskStatus['status']): string {
    switch (status) {
      case 'pending': return 'Waiting';
      case 'uploading': return 'Uploading';
      case 'signing': return 'Signing';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Done';
      case 'error': return 'Failed';
      default: return 'Unknown';
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
    <h2>{isArticleMode ? 'Publishing articles' : 'Migration in progress'}</h2>
    <p class="subtitle">Keep this page open while we {isArticleMode ? 'publish your articles' : 'migrate your content'}</p>
  </div>

  <div class="progress-card">
    <div class="progress-header">
      <div class="progress-stats">
        <span class="current">{completedCount}</span>
        <span class="divider">/</span>
        <span class="total">{totalCount}</span>
        <span class="label">{isArticleMode ? 'articles' : 'posts'}</span>
      </div>
      <span class="progress-percent">{Math.round(progressPercent)}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progressPercent}%"></div>
    </div>
  </div>

  {#if isArticleMode}
    <!-- Article tasks (client-side) -->
    {#if articleTasks.length > 0}
      <div class="tasks-list">
        {#each articleTasks as task}
          <div class="task-item" class:error={task.status === 'error'} class:complete={task.status === 'complete'} class:active={task.status === 'uploading' || task.status === 'signing' || task.status === 'publishing'}>
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
              {:else if task.status === 'uploading' || task.status === 'signing' || task.status === 'publishing'}
                <div class="task-spinner"></div>
              {:else}
                <div class="task-pending"></div>
              {/if}
            </div>
            <div class="task-info">
              <span class="task-caption">{task.article.title.slice(0, 40)}{task.article.title.length > 40 ? '...' : ''}</span>
              <span class="task-label">{getStatusLabel(task.status)}</span>
            </div>
          </div>
          {#if task.status === 'error' && task.error}
            <div class="task-error-msg">{task.error}</div>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <span>Preparing articles...</span>
      </div>
    {/if}
  {:else}
    <!-- Post tasks (backend job polling) -->
    {#if jobStatus}
      <div class="tasks-list">
        {#each jobStatus.tasks as task}
          <div class="task-item" class:error={task.status === 'error'} class:complete={task.status === 'complete'} class:active={task.status === 'uploading' || task.status === 'publishing'}>
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
              {:else if task.status === 'uploading' || task.status === 'publishing'}
                <div class="task-spinner"></div>
              {:else}
                <div class="task-pending"></div>
              {/if}
            </div>
            <div class="task-info">
              <span class="task-caption">{task.caption?.slice(0, 35) || 'Untitled'}{(task.caption?.length ?? 0) > 35 ? '...' : ''}</span>
              <span class="task-label">{getStatusLabel(task.status)}</span>
            </div>
          </div>
          {#if task.status === 'error' && task.error}
            <div class="task-error-msg">{task.error}</div>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <span>Connecting to server...</span>
      </div>
    {/if}
  {/if}

  {#if errorCount > 0}
    <div class="error-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>{errorCount} {isArticleMode ? 'article' : 'post'}{errorCount !== 1 ? 's' : ''} failed. They will be skipped.</span>
    </div>
  {/if}
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
    max-height: 280px;
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

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 2rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .loading-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
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
</style>
