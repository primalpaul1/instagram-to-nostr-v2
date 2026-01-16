<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wizard } from '$lib/stores/wizard';
  import {
    createBlossomAuthEvent,
    createLongFormContentEvent,
    createMultiMediaPostEvent,
    createProfileEvent,
    createBlossomAuthHeader,
    calculateSHA256,
    publishToRelays,
    importSingleToPrimalCache,
    NOSTR_RELAYS,
    type ArticleMetadata,
    type MediaUpload
  } from '$lib/signing';
  import { generateSecretKey, getPublicKey, finalizeEvent, type EventTemplate, type Event } from 'nostr-tools';
  import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
  import { nip19 } from 'nostr-tools';

  // Migration data from API
  interface MigrationPost {
    id: number;
    post_type: 'reel' | 'image' | 'carousel' | 'video';
    caption: string | null;
    original_date: string | null;
    media_items: string;
    blossom_urls: string | null;
    status: string;
  }

  interface MigrationArticle {
    id: number;
    title: string;
    summary: string | null;
    content_markdown: string;
    published_at: string | null;
    link: string | null;
    image_url: string | null;
    blossom_image_url: string | null;
    hashtags: string | null;
    inline_image_urls: string | null;
    status: string;
  }

  interface MigrationData {
    migration: {
      id: string;
      source_type: string;
      source_handle: string;
      profile_data: string | null;
      status: string;
    };
    posts: MigrationPost[];
    articles: MigrationArticle[];
    progress: {
      totalPosts: number;
      readyPosts: number;
      totalArticles: number;
      readyArticles: number;
      isReady: boolean;
    };
  }

  // Task status for UI
  interface TaskStatus {
    id: number;
    title: string;
    type: 'post' | 'article';
    status: 'waiting' | 'uploading' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }

  // Legacy job status (for backward compatibility)
  interface LegacyTaskStatus {
    id: string;
    status: 'pending' | 'uploading' | 'publishing' | 'complete' | 'error';
    caption?: string;
    blossom_url?: string;
    nostr_event_id?: string;
    error?: string;
  }

  interface LegacyJobStatus {
    status: 'pending' | 'processing' | 'complete' | 'error';
    tasks: LegacyTaskStatus[];
  }

  // State
  let phase: 'waiting' | 'uploading' | 'signing' | 'complete' = 'waiting';
  let migrationData: MigrationData | null = null;
  let tasks: TaskStatus[] = [];
  let pollInterval: ReturnType<typeof setInterval>;
  let publishedEvents: Event[] = [];

  // Key state (for immediate display)
  let nsecCopied = false;
  let keyDownloaded = false;
  $: keySaved = nsecCopied || keyDownloaded;

  // Legacy state
  let legacyJobStatus: LegacyJobStatus | null = null;

  const BLOSSOM_SERVER = 'https://blossom.primal.net';
  const CONCURRENCY = 2;

  // Computed values
  $: isMigrationMode = !!$wizard.migrationId;
  $: isLegacyMode = !isMigrationMode && !!$wizard.jobId;

  $: totalCount = isMigrationMode
    ? tasks.length
    : (legacyJobStatus?.tasks.length ?? 0);

  $: completedCount = isMigrationMode
    ? tasks.filter(t => t.status === 'complete').length
    : (legacyJobStatus?.tasks.filter(t => t.status === 'complete').length ?? 0);

  $: errorCount = isMigrationMode
    ? tasks.filter(t => t.status === 'error').length
    : (legacyJobStatus?.tasks.filter(t => t.status === 'error').length ?? 0);

  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  $: statusMessage = getStatusMessage();

  function getStatusMessage(): string {
    if (phase === 'waiting') {
      if (migrationData) {
        const ready = migrationData.progress.readyPosts + migrationData.progress.readyArticles;
        const total = migrationData.progress.totalPosts + migrationData.progress.totalArticles;
        return `Preparing media... ${ready}/${total}`;
      }
      return 'Connecting to server...';
    }
    if (phase === 'uploading') {
      return 'Uploading remaining media...';
    }
    if (phase === 'signing') {
      return 'Signing and publishing...';
    }
    return 'Complete!';
  }

  onMount(() => {
    // Check for saved migration state (iOS resume support)
    const savedMigration = sessionStorage.getItem('migration_in_progress');
    if (savedMigration && !$wizard.migrationId) {
      try {
        const { migrationId, secretKeyHex, publicKeyHex, npub, nsec } = JSON.parse(savedMigration);
        wizard.setMigrationId(migrationId);
        wizard.setKeyPair({ publicKey: publicKeyHex, secretKey: secretKeyHex, npub, nsec });
      } catch (err) {
        console.warn('Failed to restore migration state:', err);
        sessionStorage.removeItem('migration_in_progress');
      }
    }

    if (isMigrationMode) {
      startMigrationFlow();
    } else if (isLegacyMode) {
      pollLegacyStatus();
      pollInterval = setInterval(pollLegacyStatus, 2000);
    }
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  // ============================================
  // Migration Flow (new client-side signing)
  // ============================================

  async function startMigrationFlow() {
    let secretKeyBytes: Uint8Array;
    let secretKeyHex: string;
    let publicKeyHex: string;

    // Check if we're resuming with existing keypair
    if ($wizard.keyPair) {
      // Resuming - use existing keypair
      secretKeyHex = $wizard.keyPair.secretKey;
      secretKeyBytes = hexToBytes(secretKeyHex);
      publicKeyHex = $wizard.keyPair.publicKey;
    } else {
      // New migration - generate keypair
      secretKeyBytes = generateSecretKey();
      secretKeyHex = bytesToHex(secretKeyBytes);
      publicKeyHex = getPublicKey(secretKeyBytes);
      const npub = nip19.npubEncode(publicKeyHex);
      const nsec = nip19.nsecEncode(secretKeyBytes);

      wizard.setKeyPair({
        publicKey: publicKeyHex,
        secretKey: secretKeyHex,
        npub,
        nsec
      });
    }

    // Save to sessionStorage for iOS resume support
    if (typeof sessionStorage !== 'undefined' && $wizard.migrationId) {
      sessionStorage.setItem('migration_in_progress', JSON.stringify({
        migrationId: $wizard.migrationId,
        secretKeyHex,
        publicKeyHex,
        npub: $wizard.keyPair?.npub,
        nsec: $wizard.keyPair?.nsec
      }));
    }

    // Phase 1: Poll until migration is ready
    await pollUntilReady();

    if (!migrationData || migrationData.migration.status !== 'ready') {
      wizard.setError('Migration preparation failed');
      return;
    }

    // Phase 2: Sign and publish
    phase = 'signing';

    // Phase 3: Publish profile if available
    await publishProfile(secretKeyBytes, publicKeyHex);

    // Phase 4: Sign and publish content
    await publishContent(secretKeyBytes, publicKeyHex);

    // Phase 5: Mark migration complete
    await markMigrationComplete();

    // Clear sessionStorage on success
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('migration_in_progress');
    }

    // Done!
    wizard.setStep('complete');
  }

  async function pollUntilReady() {
    const migrationId = $wizard.migrationId;
    if (!migrationId) return;

    while (true) {
      try {
        const response = await fetch(`/api/migrations/${migrationId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch migration status');
        }

        migrationData = await response.json();

        if (migrationData.migration.status === 'ready') {
          // Initialize tasks from migration data
          initializeTasks();
          return;
        }

        if (migrationData.migration.status === 'complete') {
          // Already complete, skip to end
          wizard.setStep('complete');
          return;
        }

        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error('Error polling migration:', err);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  function initializeTasks() {
    if (!migrationData) return;

    tasks = [];

    // Add posts
    for (const post of migrationData.posts) {
      tasks.push({
        id: post.id,
        title: post.caption?.slice(0, 40) || `Post ${post.id}`,
        type: 'post',
        status: post.status === 'published' ? 'complete' : 'waiting'
      });
    }

    // Add articles
    for (const article of migrationData.articles) {
      tasks.push({
        id: article.id,
        title: article.title.slice(0, 40),
        type: 'article',
        status: article.status === 'published' ? 'complete' : 'waiting'
      });
    }
  }

  async function publishProfile(secretKeyBytes: Uint8Array, publicKeyHex: string) {
    if (!migrationData?.migration.profile_data) return;

    try {
      const profileData = JSON.parse(migrationData.migration.profile_data);
      const name = profileData.name || profileData.profile?.display_name || profileData.profile?.username;
      const bio = profileData.bio || profileData.profile?.bio;
      let picture = profileData.blossom_picture_url || profileData.picture_url || profileData.profile?.profile_picture_url;

      // If picture isn't a blossom URL, try to upload it
      if (picture && !picture.includes('blossom')) {
        try {
          picture = await uploadImage(picture, secretKeyBytes, publicKeyHex);
        } catch (err) {
          console.warn('Failed to upload profile picture:', err);
          // Keep original URL
        }
      }

      if (name) {
        const profileEvent = createProfileEvent(publicKeyHex, name, bio, picture);
        const signed = finalizeEvent(profileEvent as EventTemplate, secretKeyBytes);
        await publishToRelays(signed, NOSTR_RELAYS);
        await importSingleToPrimalCache(signed);
        publishedEvents.push(signed);
      }
    } catch (err) {
      console.warn('Failed to publish profile:', err);
    }
  }

  async function publishContent(secretKeyBytes: Uint8Array, publicKeyHex: string) {
    if (!migrationData) return;

    const queue: number[] = [];

    // Queue posts that aren't published yet
    for (let i = 0; i < migrationData.posts.length; i++) {
      if (migrationData.posts[i].status !== 'published') {
        queue.push(i);
      }
    }

    // Queue articles that aren't published yet
    const articleOffset = migrationData.posts.length;
    for (let i = 0; i < migrationData.articles.length; i++) {
      if (migrationData.articles[i].status !== 'published') {
        queue.push(articleOffset + i);
      }
    }

    // Process with concurrency
    async function processQueue() {
      while (queue.length > 0) {
        const index = queue.shift();
        if (index === undefined) break;

        if (index < articleOffset) {
          await processPost(index, secretKeyBytes, publicKeyHex);
        } else {
          await processArticle(index - articleOffset, secretKeyBytes, publicKeyHex);
        }
      }
    }

    const workers = Array(CONCURRENCY).fill(null).map(() => processQueue());
    await Promise.all(workers);
  }

  async function processPost(postIndex: number, secretKeyBytes: Uint8Array, publicKeyHex: string) {
    if (!migrationData) return;

    const post = migrationData.posts[postIndex];
    const taskIndex = tasks.findIndex(t => t.type === 'post' && t.id === post.id);
    if (taskIndex === -1) return;

    try {
      tasks[taskIndex].status = 'signing';
      tasks = tasks;

      // Parse blossom URLs and media items
      const blossomUrls: string[] = post.blossom_urls ? JSON.parse(post.blossom_urls) : [];
      const mediaItems: { url: string; media_type: string; width?: number; height?: number }[] = JSON.parse(post.media_items);

      if (blossomUrls.length === 0) {
        throw new Error('No uploaded media URLs');
      }

      // Build media uploads for event
      const mediaUploads: MediaUpload[] = blossomUrls.map((url, i) => {
        const item = mediaItems[i] || {};
        const sha256 = extractSha256FromBlossomUrl(url);
        const mimeType = item.media_type === 'video' ? 'video/mp4' : 'image/jpeg';

        return {
          url,
          sha256,
          mimeType,
          size: 0, // Size not needed for event creation
          width: item.width,
          height: item.height
        };
      });

      // Create event
      const eventTemplate = createMultiMediaPostEvent(
        publicKeyHex,
        mediaUploads,
        post.caption || undefined,
        post.original_date || undefined
      );

      const signed = finalizeEvent(eventTemplate as EventTemplate, secretKeyBytes);

      // Publish
      tasks[taskIndex].status = 'publishing';
      tasks = tasks;

      const result = await publishToRelays(signed, NOSTR_RELAYS);
      if (result.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      await importSingleToPrimalCache(signed);
      publishedEvents.push(signed);

      // Checkpoint
      await fetch(`/api/migrations/${$wizard.migrationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markPostPublished', postId: post.id })
      });

      tasks[taskIndex].status = 'complete';
      tasks = tasks;
    } catch (err) {
      console.error('Error processing post:', err);
      tasks[taskIndex].status = 'error';
      tasks[taskIndex].error = err instanceof Error ? err.message : 'Unknown error';
      tasks = tasks;
    }
  }

  async function processArticle(articleIndex: number, secretKeyBytes: Uint8Array, publicKeyHex: string) {
    if (!migrationData) return;

    const article = migrationData.articles[articleIndex];
    const taskIndex = tasks.findIndex(t => t.type === 'article' && t.id === article.id);
    if (taskIndex === -1) return;

    try {
      tasks[taskIndex].status = 'uploading';
      tasks = tasks;

      // Get processed content (worker may have already processed inline images)
      let content = article.content_markdown;
      let headerImageUrl = article.blossom_image_url || article.image_url;

      // If header image isn't on Blossom yet, upload it
      if (headerImageUrl && !headerImageUrl.includes('blossom')) {
        try {
          headerImageUrl = await uploadImage(headerImageUrl, secretKeyBytes, publicKeyHex);
        } catch (err) {
          console.warn('Failed to upload header image:', err);
        }
      }

      // Process any remaining inline images not yet on Blossom
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      const imagesToUpload: string[] = [];

      while ((match = imageRegex.exec(article.content_markdown)) !== null) {
        const imageUrl = match[2];
        if (!imageUrl.includes('blossom') && !imagesToUpload.includes(imageUrl)) {
          imagesToUpload.push(imageUrl);
        }
      }

      const imageReplacements: { original: string; blossom: string }[] = [];
      for (const imageUrl of imagesToUpload) {
        try {
          const blossomUrl = await uploadImage(imageUrl, secretKeyBytes, publicKeyHex);
          imageReplacements.push({ original: imageUrl, blossom: blossomUrl });
        } catch (err) {
          console.warn('Failed to upload inline image:', err);
        }
      }

      for (const { original, blossom } of imageReplacements) {
        content = content.split(original).join(blossom);
      }

      // Create event
      tasks[taskIndex].status = 'signing';
      tasks = tasks;

      const hashtags: string[] = article.hashtags ? JSON.parse(article.hashtags) : [];

      const articleData: ArticleMetadata = {
        identifier: `article-${article.id}`,
        title: article.title,
        summary: article.summary || undefined,
        imageUrl: headerImageUrl || undefined,
        publishedAt: article.published_at || undefined,
        hashtags,
        content
      };

      const eventTemplate = createLongFormContentEvent(publicKeyHex, articleData);
      const signed = finalizeEvent(eventTemplate as EventTemplate, secretKeyBytes);

      // Publish
      tasks[taskIndex].status = 'publishing';
      tasks = tasks;

      const result = await publishToRelays(signed, NOSTR_RELAYS);
      if (result.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      await importSingleToPrimalCache(signed);
      publishedEvents.push(signed);

      // Checkpoint
      await fetch(`/api/migrations/${$wizard.migrationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markArticlePublished', articleId: article.id })
      });

      tasks[taskIndex].status = 'complete';
      tasks = tasks;
    } catch (err) {
      console.error('Error processing article:', err);
      tasks[taskIndex].status = 'error';
      tasks[taskIndex].error = err instanceof Error ? err.message : 'Unknown error';
      tasks = tasks;
    }
  }

  async function uploadImage(imageUrl: string, secretKeyBytes: Uint8Array, publicKeyHex: string): Promise<string> {
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

    const authEvent = createBlossomAuthEvent(publicKeyHex, sha256, size);
    const signedAuth = finalizeEvent(authEvent as EventTemplate, secretKeyBytes);
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

  function extractSha256FromBlossomUrl(url: string): string {
    // Blossom URLs are typically: https://blossom.primal.net/{sha256}.ext
    const match = url.match(/\/([a-f0-9]{64})/i);
    return match ? match[1] : '';
  }

  async function markMigrationComplete() {
    try {
      await fetch(`/api/migrations/${$wizard.migrationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      });
    } catch (err) {
      console.warn('Failed to mark migration complete:', err);
    }
  }

  // ============================================
  // Legacy Job Flow (backward compatibility)
  // ============================================

  async function pollLegacyStatus() {
    if (!$wizard.jobId) return;

    try {
      const response = await fetch(`/api/jobs/${$wizard.jobId}/status`);
      if (!response.ok) throw new Error('Failed to fetch status');

      legacyJobStatus = await response.json();

      if (legacyJobStatus?.status === 'complete' || legacyJobStatus?.status === 'error') {
        clearInterval(pollInterval);
        wizard.setStep('complete');
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'waiting': return 'Waiting';
      case 'pending': return 'Waiting';
      case 'uploading': return 'Uploading';
      case 'signing': return 'Signing';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Done';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }

  function copyNsec() {
    if (!$wizard.keyPair) return;
    navigator.clipboard.writeText($wizard.keyPair.nsec);
    nsecCopied = true;
    setTimeout(() => nsecCopied = false, 2000);
  }

  function downloadKey() {
    if (!$wizard.keyPair) return;
    const content = `Your Primal Key
================

This is your login key for Primal. Keep it safe!

PRIMAL KEY:
${$wizard.keyPair.nsec}

----------------
Generated by Own Your Posts
https://ownyourposts.com

HOW TO USE:
1. Download the Primal app (iOS or Android)
2. Tap "Login" then "Use login key"
3. Paste your Primal Key above

IMPORTANT: This key is like a password.
Anyone with it can access your account.
Store it somewhere safe!
`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'primal-key.txt';
    a.click();
    URL.revokeObjectURL(url);
    keyDownloaded = true;
  }

  function getPrimalDownloadUrl(): string {
    if (typeof navigator === 'undefined') return 'https://primal.net/downloads';
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) {
      return 'https://apps.apple.com/us/app/primal/id1673134518';
    } else if (/Android/.test(ua)) {
      return 'https://play.google.com/store/apps/details?id=net.primal.android';
    }
    return 'https://primal.net/downloads';
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
    <h2>{phase === 'waiting' ? 'Preparing your content' : 'Publishing to Nostr'}</h2>
    <p class="subtitle">{statusMessage}</p>
  </div>

  <div class="progress-card">
    <div class="progress-header">
      <div class="progress-stats">
        <span class="current">{completedCount}</span>
        <span class="divider">/</span>
        <span class="total">{totalCount}</span>
        <span class="label">items</span>
      </div>
      <span class="progress-percent">{Math.round(progressPercent)}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progressPercent}%"></div>
    </div>
  </div>

  {#if isMigrationMode}
    <!-- Migration tasks -->
    {#if tasks.length > 0}
      <div class="tasks-list">
        {#each tasks as task}
          <div class="task-item" class:error={task.status === 'error'} class:complete={task.status === 'complete'} class:active={['uploading', 'signing', 'publishing'].includes(task.status)}>
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
              {:else if ['uploading', 'signing', 'publishing'].includes(task.status)}
                <div class="task-spinner"></div>
              {:else}
                <div class="task-pending"></div>
              {/if}
            </div>
            <div class="task-info">
              <span class="task-caption">{task.title}{task.title.length > 40 ? '...' : ''}</span>
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
        <span>Preparing content...</span>
      </div>
    {/if}
  {:else if isLegacyMode}
    <!-- Legacy job tasks -->
    {#if legacyJobStatus}
      <div class="tasks-list">
        {#each legacyJobStatus.tasks as task}
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
  {:else}
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span>Starting migration...</span>
    </div>
  {/if}

  {#if errorCount > 0}
    <div class="error-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>{errorCount} item{errorCount !== 1 ? 's' : ''} failed. They will be skipped.</span>
    </div>
  {/if}

  <!-- What's Next section - shown immediately for migration flow -->
  {#if isMigrationMode && $wizard.keyPair}
    <div class="whats-next-section">
      <h3>What's Next?</h3>

      <div class="step-card" class:highlight={!keySaved}>
        <div class="step-number">1</div>
        <div class="step-content">
          <h4>Save Your Key</h4>
          <p>This is your Primal identity - keep it safe!</p>
          <div class="key-actions">
            <button class="action-btn" on:click={copyNsec}>
              {#if nsecCopied}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                Copied!
              {:else}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                Copy Key
              {/if}
            </button>
            <button class="action-btn" on:click={downloadKey}>
              {#if keyDownloaded}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                Downloaded!
              {:else}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download Key
              {/if}
            </button>
          </div>
        </div>
      </div>

      <div class="step-card" class:disabled={!keySaved}>
        <img src="/primal-logo.png" alt="Primal" class="primal-logo" />
        <div class="step-content">
          <h4>Get Primal App</h4>
          <p>Access your content anywhere</p>
          <a
            href={getPrimalDownloadUrl()}
            target="_blank"
            rel="noopener"
            class="get-primal-btn"
            class:disabled={!keySaved}
            aria-disabled={!keySaved}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Get Primal
          </a>
          {#if !keySaved}
            <p class="save-key-hint">Save your key first to continue</p>
          {/if}
        </div>
      </div>

      <div class="step-card" class:disabled={!keySaved}>
        <div class="step-number">3</div>
        <div class="step-content">
          <h4>Log in with your key</h4>
          <p>Open Primal, tap "Login", then "Use login key" and paste your key</p>
        </div>
      </div>
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

  /* What's Next section */
  .whats-next-section {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
    text-align: left;
  }

  .whats-next-section h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-primary);
  }

  .step-card {
    display: flex;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
    transition: all 0.2s ease;
  }

  .step-card.highlight {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
  }

  .step-card.disabled {
    opacity: 0.5;
  }

  .step-number {
    width: 2rem;
    height: 2rem;
    background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.875rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .primal-logo {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: 50%;
  }

  .step-content {
    flex: 1;
  }

  .step-content h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }

  .step-content p {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .key-actions {
    display: flex;
    gap: 0.5rem;
  }

  .key-actions .action-btn {
    flex: 1;
    justify-content: center;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  .get-primal-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .get-primal-btn:hover:not(.disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 15px rgba(var(--accent-rgb), 0.4);
  }

  .get-primal-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  .save-key-hint {
    font-size: 0.75rem;
    color: #f59e0b;
    margin-top: 0.5rem;
    margin-bottom: 0;
  }
</style>
