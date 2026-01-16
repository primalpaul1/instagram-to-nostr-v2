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
  let phase: 'publishing' | 'complete' = 'publishing';
  let migrationData: MigrationData | null = null;
  let tasks: TaskStatus[] = [];
  let pollInterval: ReturnType<typeof setInterval>;
  let publishedEvents: Event[] = [];

  // Track which posts/articles we've already started publishing (to avoid duplicates)
  let publishingPostIds = new Set<number>();
  let publishingArticleIds = new Set<number>();
  let publishedPostIds = new Set<number>();
  let publishedArticleIds = new Set<number>();

  // For concurrent publishing
  let activePublishCount = 0;
  const MAX_CONCURRENT_PUBLISH = 3;

  // Key state (for immediate display)
  let nsecCopied = false;
  let keyDownloaded = false;
  let keyEverSaved = false;  // Persistent - doesn't reset after button feedback
  $: keySaved = keyEverSaved;

  // Legacy state
  let legacyJobStatus: LegacyJobStatus | null = null;

  const BLOSSOM_SERVER = 'https://blossom.primal.net';
  const CONCURRENCY = 2;

  // Rotating Nostr sayings
  const NOSTR_SAYINGS = [
    "Not your keys, not your content",
    "One step closer to bloom scrolling",
    "Control what you see",
    "Zap Bitcoin",
    "Sovereign social media is here",
    "Not their content anymore",
    "Bye, bye, big tech",
    "Your feed, your rules",
    "No algorithm deciding for you",
    "Own your audience forever",
    "No more shadow bans"
  ];

  let currentSayingIndex = 0;
  let sayingInterval: ReturnType<typeof setInterval>;

  // Computed values
  $: isMigrationMode = !!$wizard.migrationId;
  $: isLegacyMode = !isMigrationMode && !!$wizard.jobId;

  // Progress is based on published count vs total
  $: totalCount = isMigrationMode
    ? (migrationData ? migrationData.posts.length + migrationData.articles.length : 0)
    : (legacyJobStatus?.tasks.length ?? 0);

  $: completedCount = isMigrationMode
    ? publishedPostIds.size + publishedArticleIds.size
    : (legacyJobStatus?.tasks.filter(t => t.status === 'complete').length ?? 0);

  $: errorCount = isMigrationMode
    ? tasks.filter(t => t.status === 'error').length
    : (legacyJobStatus?.tasks.filter(t => t.status === 'error').length ?? 0);

  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

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

    // Start rotating sayings
    sayingInterval = setInterval(() => {
      currentSayingIndex = (currentSayingIndex + 1) % NOSTR_SAYINGS.length;
    }, 3000);

    if (isMigrationMode) {
      startMigrationFlow();
    } else if (isLegacyMode) {
      pollLegacyStatus();
      pollInterval = setInterval(pollLegacyStatus, 2000);
    }
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    if (sayingInterval) clearInterval(sayingInterval);
  });

  // ============================================
  // Migration Flow (new client-side signing)
  // Publishes posts as they become ready, not waiting for all
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

    // Publish profile first (if available) - do this once at the start
    let profilePublished = false;

    // Main loop: poll and publish as posts become ready
    await pollAndPublish(secretKeyBytes, publicKeyHex, () => {
      if (!profilePublished && migrationData?.migration.profile_data) {
        profilePublished = true;
        publishProfile(secretKeyBytes, publicKeyHex);
      }
    });

    // Mark migration complete
    await markMigrationComplete();

    // Clear sessionStorage on success
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('migration_in_progress');
    }

    // Done - stay on this page, just update phase
    phase = 'complete';

    // Silent relay verification in background
    verifyRelaysInBackground();
  }

  async function pollAndPublish(
    secretKeyBytes: Uint8Array,
    publicKeyHex: string,
    onFirstData: () => void
  ) {
    const migrationId = $wizard.migrationId;
    if (!migrationId) return;

    let firstDataReceived = false;

    while (true) {
      try {
        const response = await fetch(`/api/migrations/${migrationId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch migration status');
        }

        migrationData = await response.json();

        // Call onFirstData callback once we have data
        if (!firstDataReceived && migrationData) {
          firstDataReceived = true;
          onFirstData();
        }

        // Check for already-published posts (resume support)
        for (const post of migrationData.posts) {
          if (post.status === 'published' && !publishedPostIds.has(post.id)) {
            publishedPostIds.add(post.id);
          }
        }
        for (const article of migrationData.articles) {
          if (article.status === 'published' && !publishedArticleIds.has(article.id)) {
            publishedArticleIds.add(article.id);
          }
        }

        // Find posts that are ready but not yet being published
        const readyPosts = migrationData.posts.filter(
          p => p.status === 'ready' && !publishingPostIds.has(p.id) && !publishedPostIds.has(p.id)
        );

        // Publish ready posts (respecting concurrency limit)
        for (const post of readyPosts) {
          if (activePublishCount < MAX_CONCURRENT_PUBLISH) {
            publishingPostIds.add(post.id);
            processPost(post, secretKeyBytes, publicKeyHex);
          }
        }

        // Find articles that are ready but not yet being published
        const readyArticles = migrationData.articles.filter(
          a => a.status === 'ready' && !publishingArticleIds.has(a.id) && !publishedArticleIds.has(a.id)
        );

        // Publish ready articles (respecting concurrency limit)
        for (const article of readyArticles) {
          if (activePublishCount < MAX_CONCURRENT_PUBLISH) {
            publishingArticleIds.add(article.id);
            processArticle(article, secretKeyBytes, publicKeyHex);
          }
        }

        // Check if all done
        const totalPosts = migrationData.posts.length;
        const totalArticles = migrationData.articles.length;
        const allPublished =
          publishedPostIds.size >= totalPosts &&
          publishedArticleIds.size >= totalArticles;

        if (allPublished) {
          break;
        }

        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error('Error polling migration:', err);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  async function verifyRelaysInBackground() {
    // Wait a moment for initial relay publishes to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    for (const event of publishedEvents) {
      try {
        const result = await publishToRelays(event, NOSTR_RELAYS);
        if (result.success.length === 0) {
          console.warn('Relay retry failed for event:', event.id);
        }
      } catch (err) {
        console.warn('Relay verification error:', err);
      }
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

        // Primal cache first for immediate visibility
        await importSingleToPrimalCache(signed);
        publishedEvents.push(signed);

        // Fire relay publishing in background
        publishToRelays(signed, NOSTR_RELAYS).catch(err => {
          console.warn('Profile relay publish failed:', err);
        });
      }
    } catch (err) {
      console.warn('Failed to publish profile:', err);
    }
  }

  async function processPost(post: MigrationPost, secretKeyBytes: Uint8Array, publicKeyHex: string) {
    activePublishCount++;

    try {
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

      // Create and sign event
      const eventTemplate = createMultiMediaPostEvent(
        publicKeyHex,
        mediaUploads,
        post.caption || undefined,
        post.original_date || undefined
      );
      const signed = finalizeEvent(eventTemplate as EventTemplate, secretKeyBytes);

      // 1. Import to Primal cache first - immediate visibility
      await importSingleToPrimalCache(signed);
      publishedEvents.push(signed);

      // 2. Fire relay publishing in background (best effort)
      publishToRelays(signed, NOSTR_RELAYS).catch(err => {
        console.warn('Post relay publish failed:', err);
      });

      // 3. Checkpoint to database
      await fetch(`/api/migrations/${$wizard.migrationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markPostPublished', postId: post.id })
      });

      // 4. Mark as published
      publishedPostIds.add(post.id);
      publishedPostIds = publishedPostIds; // Trigger reactivity
    } catch (err) {
      console.error('Error processing post:', err);
      // Don't block on errors, just log
    } finally {
      activePublishCount--;
    }
  }

  async function processArticle(article: MigrationArticle, secretKeyBytes: Uint8Array, publicKeyHex: string) {
    activePublishCount++;

    try {
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

      // 1. Import to Primal cache first - immediate visibility
      await importSingleToPrimalCache(signed);
      publishedEvents.push(signed);

      // 2. Fire relay publishing in background (best effort)
      publishToRelays(signed, NOSTR_RELAYS).catch(err => {
        console.warn('Article relay publish failed:', err);
      });

      // 3. Checkpoint to database
      await fetch(`/api/migrations/${$wizard.migrationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markArticlePublished', articleId: article.id })
      });

      // 4. Mark as published
      publishedArticleIds.add(article.id);
      publishedArticleIds = publishedArticleIds; // Trigger reactivity
    } catch (err) {
      console.error('Error processing article:', err);
      // Don't block on errors, just log
    } finally {
      activePublishCount--;
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
    keyEverSaved = true;
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
    keyEverSaved = true;
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
  <!-- Circular progress with rotating sayings -->
  <div class="progress-card" class:complete={phase === 'complete'}>
    <div class="progress-circle" class:complete={phase === 'complete'}>
      <svg viewBox="0 0 36 36">
        <path
          class="progress-bg"
          d="M18 2.0845
            a 15.9155 15.9155 0 0 1 0 31.831
            a 15.9155 15.9155 0 0 1 0 -31.831"
        />
        <path
          class="progress-fill-circle"
          stroke-dasharray="{progressPercent}, 100"
          d="M18 2.0845
            a 15.9155 15.9155 0 0 1 0 31.831
            a 15.9155 15.9155 0 0 1 0 -31.831"
        />
      </svg>
      <div class="progress-percent">
        {#if phase === 'complete'}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        {:else}
          {Math.round(progressPercent)}%
        {/if}
      </div>
    </div>

    {#if phase === 'complete'}
      <p class="nostr-saying complete">All done!</p>
    {:else}
      <p class="nostr-saying">{NOSTR_SAYINGS[currentSayingIndex]}</p>
    {/if}

    <p class="progress-count">{completedCount}/{totalCount} published</p>
  </div>

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
    border-radius: 1rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .progress-card.complete {
    border-color: var(--success);
    background: rgba(var(--success-rgb), 0.08);
  }

  .progress-circle {
    position: relative;
    width: 80px;
    height: 80px;
    margin-bottom: 1rem;
  }

  .progress-circle svg {
    transform: rotate(-90deg);
    width: 100%;
    height: 100%;
  }

  .progress-bg {
    fill: none;
    stroke: var(--bg-primary);
    stroke-width: 3;
  }

  .progress-fill-circle {
    fill: none;
    stroke: #a855f7;
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.5s ease;
  }

  .progress-circle.complete .progress-fill-circle {
    stroke: #22c55e;
  }

  .progress-percent {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .progress-circle.complete .progress-percent {
    color: #22c55e;
  }

  .nostr-saying {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 0.5rem 0;
    min-height: 1.5rem;
    transition: opacity 0.3s ease;
  }

  .nostr-saying.complete {
    color: #22c55e;
    font-weight: 600;
  }

  .progress-count {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .loading-spinner-small {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
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
