<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wizard, selectedPosts, selectedArticles, type PostInfo, type ArticleInfo, type MediaItemInfo, getMediaCache, clearMediaCache } from '$lib/stores/wizard';
  import {
    createBlossomAuthEvent,
    createMultiMediaPostEvent,
    createLongFormContentEvent,
    createProfileEvent,
    signWithNIP46,
    createBlossomAuthHeader,
    calculateSHA256,
    publishToRelays,
    importToPrimalCache,
    importSingleToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload,
    type ArticleMetadata
  } from '$lib/signing';
  import { closeConnection } from '$lib/nip46';
  import { generateSecretKey, getPublicKey, finalizeEvent, type EventTemplate, type Event } from 'nostr-tools';

  // Temp keypair for Blossom uploads - much faster than NIP-46 round trips
  interface TempKeypair {
    publicKey: string;
    secretKey: Uint8Array;
  }

  function generateTempKeypair(): TempKeypair {
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);
    return { publicKey, secretKey };
  }

  function signBlossomAuthLocally(
    event: Omit<Event, 'sig'>,
    secretKey: Uint8Array
  ): Event {
    return finalizeEvent(event as EventTemplate, secretKey);
  }

  interface PostTaskStatus {
    post: PostInfo;
    type: 'post';
    status: 'pending' | 'downloading' | 'signing' | 'uploading' | 'publishing' | 'complete' | 'error';
    blossomUrls?: string[];
    nostrEventId?: string;
    error?: string;
    mediaProgress?: { current: number; total: number };
  }

  interface ArticleTaskStatus {
    article: ArticleInfo;
    type: 'article';
    status: 'pending' | 'downloading' | 'signing' | 'uploading' | 'publishing' | 'complete' | 'error';
    nostrEventId?: string;
    error?: string;
  }

  type TaskStatus = PostTaskStatus | ArticleTaskStatus;

  let tasks: TaskStatus[] = [];
  $: isArticlesMode = $wizard.contentType === 'articles';
  let isProcessing = false;
  let activeIndices: Set<number> = new Set();

  const BLOSSOM_SERVER = 'https://blossom.primal.net';
  const CONCURRENCY = 4; // Parallel downloads/uploads, signing is serialized via queue
  const SIGN_TIMEOUT = 30000; // 30 second timeout for signing
  const SIGN_RETRIES = 2; // Retry failed signs

  // Signing queue - only one NIP-46 signing request at a time to avoid overwhelming the remote signer
  let signingQueue: Promise<void> = Promise.resolve();

  function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Signing timeout')), ms)
      )
    ]);
  }

  async function withSigningQueue<T>(fn: () => Promise<T>): Promise<T> {
    // Chain onto the queue so signing happens one at a time
    const result = signingQueue.then(async () => {
      await delay(500); // Small delay between signs to give wallet breathing room
      return fn();
    });
    signingQueue = result.then(() => {}, () => {}); // Swallow errors in queue chain
    return result;
  }

  async function signWithRetry(
    connection: typeof $wizard.nip46Connection,
    event: Parameters<typeof signWithNIP46>[1]
  ): Promise<Awaited<ReturnType<typeof signWithNIP46>>> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= SIGN_RETRIES; attempt++) {
      try {
        return await withTimeout(signWithNIP46(connection!, event), SIGN_TIMEOUT);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Sign failed');
        console.warn(`Sign attempt ${attempt + 1} failed:`, lastError.message);
        if (attempt < SIGN_RETRIES) {
          await delay(1000); // Wait 1s before retry
        }
      }
    }
    throw lastError;
  }

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: errorCount = tasks.filter(t => t.status === 'error').length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  $: allDone = completedCount + errorCount === totalCount && totalCount > 0;

  onMount(() => {
    if (isArticlesMode) {
      tasks = $selectedArticles.map(article => ({
        article,
        type: 'article' as const,
        status: 'pending'
      }));
    } else {
      tasks = $selectedPosts.map(post => ({
        post,
        type: 'post' as const,
        status: 'pending'
      }));
    }
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

    // Generate temp keypair for Blossom uploads - much faster than NIP-46 round trips
    // This keypair is ephemeral (not stored) and only used for Blossom auth
    const tempKeypair = generateTempKeypair();

    try {
      // Create a queue of task indices
      const queue: number[] = [...Array(tasks.length).keys()];

      // Publish profile first if available (for RSS migrations)
      if (isArticlesMode && $wizard.feedInfo) {
        await publishProfile(tempKeypair);
      }

      // Process queue with worker functions
      async function processQueue() {
        while (queue.length > 0) {
          const index = queue.shift();
          if (index !== undefined) {
            activeIndices.add(index);
            activeIndices = activeIndices; // Trigger reactivity
            const task = tasks[index];
            if (task.type === 'article') {
              await processArticle(index, tempKeypair);
            } else {
              await processPost(index, tempKeypair);
            }
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
    tempKeypair: TempKeypair
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

    // Create and sign auth event locally (much faster than NIP-46 round trip)
    // Blossom uses content-addressed storage, so it doesn't matter who signs the auth
    const authEvent = createBlossomAuthEvent(tempKeypair.publicKey, sha256, mediaData.byteLength);
    const signedAuth = signBlossomAuthLocally(authEvent, tempKeypair.secretKey);
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

  async function processPost(index: number, tempKeypair: TempKeypair) {
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

      // Upload all items in parallel using temp keypair for Blossom auth (fast, local signing)
      const uploadPromises = mediaItems.map((item, i) =>
        uploadMediaItem(item, tempKeypair).then(upload => {
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

      // Use signing queue to serialize NIP-46 requests (one at a time) with retry
      const signedPost = await withSigningQueue(() =>
        signWithRetry($wizard.nip46Connection, postEvent)
      );

      tasks[index] = { ...tasks[index], status: 'publishing' };
      tasks = [...tasks];

      // Publish to relays and import to Primal cache in parallel (they're independent)
      const [publishResult] = await Promise.all([
        publishToRelays(signedPost, NOSTR_RELAYS),
        importToPrimalCache([signedPost]).catch(err => {
          console.warn('Failed to import to Primal cache:', err);
        })
      ]);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
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

  async function publishProfile(tempKeypair: TempKeypair) {
    if (!$wizard.nip46Connection || !$wizard.nip46Pubkey || !$wizard.feedInfo) return;

    try {
      const feedInfo = $wizard.feedInfo;
      const name = feedInfo.author_name || feedInfo.title;
      const bio = feedInfo.author_bio || feedInfo.description;
      let picture = feedInfo.author_image || feedInfo.image_url;

      // Upload profile picture to Blossom if needed
      if (picture && !picture.includes('blossom')) {
        try {
          picture = await uploadImageToBlossom(picture, tempKeypair);
        } catch (err) {
          console.warn('Failed to upload profile picture:', err);
        }
      }

      if (name) {
        const profileEvent = createProfileEvent($wizard.nip46Pubkey, name, bio, picture);

        // Sign with NIP-46
        const signedProfile = await withSigningQueue(() =>
          signWithRetry($wizard.nip46Connection, profileEvent)
        );

        // Publish to relays
        const relayResult = await publishToRelays(signedProfile, NOSTR_RELAYS);
        console.log('Profile relay result:', relayResult);

        // Import to Primal cache
        await importSingleToPrimalCache(signedProfile).catch(err => {
          console.warn('Failed to import profile to Primal cache:', err);
        });
      }
    } catch (err) {
      console.warn('Failed to publish profile:', err);
    }
  }

  async function uploadImageToBlossom(imageUrl: string, tempKeypair: TempKeypair): Promise<string> {
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
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Use temp keypair for Blossom auth (fast, local signing)
    const authEvent = createBlossomAuthEvent(tempKeypair.publicKey, sha256, imageData.byteLength);
    const signedAuth = signBlossomAuthLocally(authEvent, tempKeypair.secretKey);
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

  // Extract slug from URL for d-tag
  function extractSlugFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/$/, '');
      const slug = path.split('/').pop() || '';
      const clean = slug.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      return clean.toLowerCase() || null;
    } catch {
      return null;
    }
  }

  async function processArticle(index: number, tempKeypair: TempKeypair) {
    const task = tasks[index] as ArticleTaskStatus;
    if (!$wizard.nip46Connection || !$wizard.nip46Pubkey) {
      tasks[index] = { ...task, status: 'error', error: 'No NIP-46 connection' };
      return;
    }

    try {
      const article = task.article;

      // Update status to uploading (for images)
      tasks[index] = { ...task, status: 'uploading' };
      tasks = [...tasks];

      // Upload header image if needed
      let headerImageUrl = article.image_url;
      if (headerImageUrl && !headerImageUrl.includes('blossom')) {
        try {
          headerImageUrl = await uploadImageToBlossom(headerImageUrl, tempKeypair);
        } catch (err) {
          console.warn('Failed to upload header image:', err);
        }
      }

      // Process inline images
      let content = article.content_markdown;
      const imageRegex = /!\[[^\]]*\]\(([^\s)]+)/g;
      let match;
      const imagesToUpload: string[] = [];

      while ((match = imageRegex.exec(article.content_markdown)) !== null) {
        const imageUrl = match[1];
        if (!imageUrl.includes('blossom') && !imagesToUpload.includes(imageUrl)) {
          imagesToUpload.push(imageUrl);
        }
      }

      const imageReplacements: { original: string; blossom: string }[] = [];
      for (const imageUrl of imagesToUpload) {
        try {
          const blossomUrl = await uploadImageToBlossom(imageUrl, tempKeypair);
          imageReplacements.push({ original: imageUrl, blossom: blossomUrl });
        } catch (err) {
          console.warn('Failed to upload inline image:', err);
        }
      }

      for (const { original, blossom } of imageReplacements) {
        content = content.split(original).join(blossom);
      }

      // Update status to signing
      tasks[index] = { ...task, status: 'signing' };
      tasks = [...tasks];

      // Create article event
      const identifier = extractSlugFromUrl(article.link) || `article-${article.id}`;
      const articleData: ArticleMetadata = {
        identifier,
        title: article.title,
        summary: article.summary,
        imageUrl: headerImageUrl,
        publishedAt: article.published_at,
        hashtags: article.hashtags || [],
        content
      };

      const articleEvent = createLongFormContentEvent($wizard.nip46Pubkey, articleData);

      // Sign with NIP-46
      const signedArticle = await withSigningQueue(() =>
        signWithRetry($wizard.nip46Connection, articleEvent)
      );

      // Update status to publishing
      tasks[index] = { ...task, status: 'publishing' };
      tasks = [...tasks];

      // Publish to relays first (priority for kind 30023)
      const relayResult = await publishToRelays(signedArticle, NOSTR_RELAYS);
      console.log('Article relay result:', relayResult);

      if (relayResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      // Also import to Primal cache
      await importSingleToPrimalCache(signedArticle).catch(err => {
        console.warn('Failed to import article to Primal cache:', err);
      });

      tasks[index] = {
        ...task,
        status: 'complete',
        nostrEventId: signedArticle.id
      };
      tasks = [...tasks];

    } catch (err) {
      console.error(`Error processing article ${index}:`, err);
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
        if (task.type === 'post' && task.mediaProgress && task.mediaProgress.total > 1) {
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
    <h2>Claiming your {isArticlesMode ? 'articles' : 'posts'}</h2>
    <p class="subtitle">Your content is being published to Primal</p>
  </div>

  <div class="progress-card">
    <div class="progress-header">
      <div class="progress-stats">
        <span class="current">{completedCount}</span>
        <span class="divider">/</span>
        <span class="total">{totalCount}</span>
        <span class="label">{isArticlesMode ? 'articles' : 'posts'}</span>
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
            {#if task.type === 'article'}
              <span class="task-type-icon article">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </span>
              <span class="task-caption">{task.article.title?.slice(0, 30) || 'Untitled'}{(task.article.title?.length ?? 0) > 30 ? '...' : ''}</span>
            {:else}
              <span class="task-type-icon" class:reel={task.post.post_type === 'reel'}>{getPostTypeIcon(task.post.post_type)}</span>
              <span class="task-caption">{task.post.caption?.slice(0, 30) || 'Untitled'}{(task.post.caption?.length ?? 0) > 30 ? '...' : ''}</span>
            {/if}
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
      <span>{errorCount} {isArticlesMode ? 'article' : 'post'}{errorCount !== 1 ? 's' : ''} failed. They will be skipped.</span>
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

  .task-type-icon.article {
    color: var(--accent);
    display: flex;
    align-items: center;
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
