<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { wizard } from '$lib/stores/wizard';
  import {
    createConnectionURI,
    generateQRCode,
    generateSecret,
    generateLocalKeypair,
    waitForConnection,
    hexToNpub,
    closeConnection,
    type NIP46Connection
  } from '$lib/nip46';

  export let defaultPlatform: 'instagram' | 'tiktok' | 'twitter' | 'rss' = 'instagram';

  let handle = '';
  let feedUrl = '';
  let platform: 'instagram' | 'tiktok' | 'twitter' | 'rss' = defaultPlatform;

  // Twitter-specific state
  let cookieFiles: FileList | null = null;
  let twitterSessionId: string | null = null;
  let cookiesUploaded = false;
  let cookieUploadError = '';
  let loading = false;
  let videoCount = 0;
  let articleCount = 0;
  let fetchedVideos: any[] = [];
  let fetchedPosts: any[] = [];
  let fetchedArticles: any[] = [];
  let fetchedFeedInfo: any = null;
  let fetchedProfile: any = null;
  let abortController: AbortController | null = null;

  // NIP-46 state
  let qrCodeDataUrl = '';
  let connectionSecret = '';
  let connectionURI = '';  // For QR code (no callback)
  let mobileConnectionURI = '';  // For mobile button (with callback)
  let localKeypair: { secretKey: string; publicKey: string } | null = null;
  let connectionStatus: 'idle' | 'waiting' | 'connected' | 'error' = 'idle';
  let connectionError = '';
  let pendingConnection: NIP46Connection | null = null;

  onMount(async () => {
    // Generate a session ID for Twitter cookies
    twitterSessionId = crypto.randomUUID();

    // Check for pending NIP-46 connection from redirect
    const pendingConnection = sessionStorage.getItem('nip46_pending_main');
    if (pendingConnection) {
      try {
        const { localSecretKey, localPublicKey, secret } = JSON.parse(pendingConnection);
        // Restore connection state and resume waiting
        localKeypair = { secretKey: localSecretKey, publicKey: localPublicKey };
        connectionSecret = secret;
        connectionURI = createConnectionURI(localPublicKey, secret, false);
        mobileConnectionURI = createConnectionURI(localPublicKey, secret, true, window.location.href);
        qrCodeDataUrl = await generateQRCode(connectionURI);
        connectionStatus = 'waiting';
        waitForPrimalConnection();
        return;
      } catch (err) {
        console.error('Failed to restore NIP-46 connection:', err);
        sessionStorage.removeItem('nip46_pending_main');
      }
    }
    await initNIP46Connection();
  });

  onDestroy(() => {
    if (pendingConnection && $wizard.authMode !== 'nip46') {
      closeConnection(pendingConnection);
    }
    // Clean up Twitter cookies on component destroy
    if (twitterSessionId && cookiesUploaded) {
      fetch(`/api/twitter-cookies?session_id=${twitterSessionId}`, { method: 'DELETE' }).catch(() => {});
    }
  });

  async function initNIP46Connection() {
    try {
      connectionStatus = 'waiting';
      connectionError = '';
      localKeypair = generateLocalKeypair();
      connectionSecret = generateSecret();

      // QR code URI (no callback - for desktop scanning)
      connectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret, false);

      // Mobile button URI (with callback - redirects back after approval)
      const callbackUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      mobileConnectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret, true, callbackUrl);

      // Save connection state for redirect recovery
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('nip46_pending_main', JSON.stringify({
          localSecretKey: localKeypair.secretKey,
          localPublicKey: localKeypair.publicKey,
          secret: connectionSecret
        }));
      }

      qrCodeDataUrl = await generateQRCode(connectionURI);
      waitForPrimalConnection();
    } catch (err) {
      connectionStatus = 'error';
      connectionError = err instanceof Error ? err.message : 'Failed to initialize';
    }
  }

  async function waitForPrimalConnection() {
    if (!localKeypair || !connectionURI) return;

    try {
      const connection = await waitForConnection(
        localKeypair.secretKey,
        connectionSecret,
        connectionURI,
        () => { connectionStatus = 'waiting'; }
      );

      pendingConnection = connection;
      connectionStatus = 'connected';

      // Clear pending connection state
      sessionStorage.removeItem('nip46_pending_main');

      wizard.setAuthMode('nip46');
      wizard.setNIP46Connection(connection, connection.remotePubkey);
    } catch (err) {
      connectionStatus = 'error';
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }
  }

  async function retryConnection() {
    if (pendingConnection) {
      closeConnection(pendingConnection);
      pendingConnection = null;
    }
    wizard.clearNIP46();
    await initNIP46Connection();
  }

  async function uploadTwitterCookies(): Promise<boolean> {
    if (!cookieFiles || cookieFiles.length === 0 || !twitterSessionId) {
      cookieUploadError = 'Please select a cookies.txt file';
      return false;
    }

    cookieUploadError = '';

    try {
      const formData = new FormData();
      formData.append('cookies', cookieFiles[0]);

      const response = await fetch(`/api/twitter-cookies?session_id=${twitterSessionId}`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const data = await response.json();
        cookieUploadError = data.error || 'Failed to upload cookies';
        return false;
      }

      cookiesUploaded = true;
      return true;
    } catch (err) {
      cookieUploadError = err instanceof Error ? err.message : 'Failed to upload cookies';
      return false;
    }
  }

  async function handleSubmit() {
    // Validate input based on platform
    if (platform === 'rss') {
      if (!feedUrl.trim()) return;
    } else {
      if (!handle.trim()) return;
    }

    // For Twitter, upload cookies first
    if (platform === 'twitter') {
      if (!cookieFiles || cookieFiles.length === 0) {
        cookieUploadError = 'Please upload your Twitter cookies.txt file';
        return;
      }
      const uploaded = await uploadTwitterCookies();
      if (!uploaded) return;
    }

    loading = true;
    videoCount = 0;
    articleCount = 0;
    fetchedVideos = [];
    fetchedArticles = [];
    fetchedFeedInfo = null;
    fetchedProfile = null;
    abortController = new AbortController();
    wizard.setLoading(true);
    wizard.setError(null);

    try {
      let endpoint: string;

      if (platform === 'rss') {
        endpoint = `/api/rss-stream?feed_url=${encodeURIComponent(feedUrl.trim())}`;
      } else if (platform === 'tiktok') {
        const cleanHandle = handle.replace('@', '').trim();
        endpoint = `/api/tiktok-stream/${encodeURIComponent(cleanHandle)}`;
      } else if (platform === 'twitter') {
        const cleanHandle = handle.replace('@', '').trim();
        endpoint = `/api/twitter-stream/${encodeURIComponent(cleanHandle)}?session_id=${twitterSessionId}`;
      } else {
        const cleanHandle = handle.replace('@', '').trim();
        endpoint = `/api/videos-stream/${encodeURIComponent(cleanHandle)}`;
      }

      const response = await fetch(endpoint, {
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch content');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Streaming not supported');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.progress) {
                if (platform === 'rss') {
                  articleCount = data.count || 0;
                  if (data.articles) {
                    fetchedArticles = data.articles;
                  }
                  if (data.feed) {
                    fetchedFeedInfo = data.feed;
                  }
                } else {
                  videoCount = data.count;
                  if (data.videos) {
                    fetchedVideos = data.videos;
                  }
                  if (data.posts) {
                    fetchedPosts = data.posts;
                  }
                  if (data.profile) {
                    fetchedProfile = data.profile;
                  }
                }
              }

              if (data.done) {
                if (platform === 'rss') {
                  if (!data.articles || data.articles.length === 0) {
                    throw new Error('No articles found in this feed');
                  }

                  wizard.setContentType('articles');
                  wizard.setSourceType('rss');
                  wizard.setHandle(feedUrl.trim());
                  const mappedArticles = (data.articles || []).map((a: any) => ({ ...a, selected: true }));
                  wizard.setArticles(mappedArticles);
                  if (data.feed) {
                    wizard.setFeedInfo(data.feed);
                    // Set profile from feed author info
                    if (data.feed.author_name || data.feed.title) {
                      wizard.setProfile({
                        username: data.feed.author_name || data.feed.title,
                        display_name: data.feed.author_name || data.feed.title,
                        bio: data.feed.author_bio || data.feed.description,
                        profile_picture_url: data.feed.author_image || data.feed.image_url
                      });
                    }
                  }
                  // Skip KeysStep for generate mode, go directly to videos
                  wizard.setStep($wizard.authMode === 'nip46' ? 'keys' : 'videos');
                  await tick();
                  return;
                } else {
                  if ((!data.videos || data.videos.length === 0) && (!data.posts || data.posts.length === 0)) {
                    throw new Error('No content found for this account');
                  }

                  const cleanHandle = handle.replace('@', '').trim();
                  wizard.setContentType('posts');
                  wizard.setSourceType(platform === 'tiktok' ? 'tiktok' : platform === 'twitter' ? 'twitter' : 'instagram');
                  wizard.setHandle(cleanHandle);
                  wizard.setVideos((data.videos || []).map((v: any) => ({ ...v, selected: false })));
                  wizard.setPosts((data.posts || []).map((p: any) => ({ ...p, selected: false })));
                  if (data.profile) {
                    wizard.setProfile(data.profile);
                  }
                }
                // Skip KeysStep for generate mode, go directly to videos
                wizard.setStep($wizard.authMode === 'nip46' ? 'keys' : 'videos');
                return;
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
                throw parseErr;
              }
            }
          }
        }
      }

      throw new Error('Stream ended unexpectedly');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      wizard.setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      loading = false;
      abortController = null;
      wizard.setLoading(false);
    }
  }

  function handlePause() {
    if (!abortController) return;

    if (platform === 'rss') {
      if (articleCount === 0 && fetchedArticles.length === 0) return;

      abortController.abort();
      wizard.setContentType('articles');
      wizard.setSourceType('rss');
      wizard.setHandle(feedUrl.trim());
      const articles = fetchedArticles.length > 0 ? fetchedArticles : [];
      wizard.setArticles(articles.map((a: any) => ({ ...a, selected: true })));
      if (fetchedFeedInfo) {
        wizard.setFeedInfo(fetchedFeedInfo);
        // Set profile from feed author info
        if (fetchedFeedInfo.author_name || fetchedFeedInfo.title) {
          wizard.setProfile({
            username: fetchedFeedInfo.author_name || fetchedFeedInfo.title,
            display_name: fetchedFeedInfo.author_name || fetchedFeedInfo.title,
            bio: fetchedFeedInfo.author_bio || fetchedFeedInfo.description,
            profile_picture_url: fetchedFeedInfo.author_image || fetchedFeedInfo.image_url
          });
        }
      }
    } else {
      if (fetchedVideos.length === 0 && fetchedPosts.length === 0) return;

      const cleanHandle = handle.replace('@', '').trim();
      abortController.abort();

      wizard.setContentType('posts');
      wizard.setSourceType(platform === 'tiktok' ? 'tiktok' : platform === 'twitter' ? 'twitter' : 'instagram');
      wizard.setHandle(cleanHandle);
      wizard.setVideos(fetchedVideos.map((v: any) => ({ ...v, selected: false })));
      wizard.setPosts(fetchedPosts.map((p: any) => ({ ...p, selected: false })));
      if (fetchedProfile) {
        wizard.setProfile(fetchedProfile);
      }
    }
    // Skip KeysStep for generate mode, go directly to videos
    wizard.setStep($wizard.authMode === 'nip46' ? 'keys' : 'videos');
  }
</script>

<div class="handle-step">
  <div class="hero-section">
    {#if platform === 'rss'}
      <h2>Enter your RSS feed URL</h2>
      <p class="subtitle">We'll import your articles so you can own them forever on Primal</p>
    {:else}
      <h2>Enter your {platform === 'tiktok' ? 'TikTok' : platform === 'twitter' ? 'Twitter/X' : 'Instagram'} handle</h2>
      <p class="subtitle">We'll find your posts so you can own them forever on Primal</p>
    {/if}
  </div>

  <div class="platform-selector">
    <button
      type="button"
      class="platform-btn"
      class:active={platform === 'instagram'}
      on:click={() => platform = 'instagram'}
      disabled={loading}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
      Instagram
    </button>
    <button
      type="button"
      class="platform-btn"
      class:active={platform === 'tiktok'}
      on:click={() => platform = 'tiktok'}
      disabled={loading}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
      </svg>
      TikTok
    </button>
    <button
      type="button"
      class="platform-btn"
      class:active={platform === 'twitter'}
      on:click={() => platform = 'twitter'}
      disabled={loading}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
      Twitter/X
    </button>
    <button
      type="button"
      class="platform-btn"
      class:active={platform === 'rss'}
      on:click={() => platform = 'rss'}
      disabled={loading}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z"/>
      </svg>
      RSS
    </button>
  </div>

  <form on:submit|preventDefault={handleSubmit}>
    {#if platform === 'rss'}
      <div class="input-wrapper url-input" class:focused={feedUrl.length > 0} class:loading>
        <svg class="url-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <input
          type="url"
          bind:value={feedUrl}
          placeholder="https://yourblog.substack.com/feed"
          disabled={loading}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        {#if loading}
          <div class="input-spinner"></div>
        {/if}
      </div>
    {:else}
      <div class="input-wrapper" class:focused={handle.length > 0} class:loading>
        <span class="at-symbol">@</span>
        <input
          type="text"
          bind:value={handle}
          placeholder="username"
          disabled={loading}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        {#if loading}
          <div class="input-spinner"></div>
        {/if}
      </div>
    {/if}

    {#if platform === 'twitter'}
      <div class="cookie-upload">
        <div class="cookie-instructions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          <span>Export cookies.txt from your browser while logged into Twitter/X</span>
        </div>
        <label class="cookie-input" class:has-file={cookieFiles && cookieFiles.length > 0}>
          <input
            type="file"
            accept=".txt"
            bind:files={cookieFiles}
            disabled={loading}
          />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          {#if cookieFiles && cookieFiles.length > 0}
            <span class="file-name">{cookieFiles[0].name}</span>
          {:else}
            <span>Choose cookies.txt file</span>
          {/if}
        </label>
        {#if cookieUploadError}
          <p class="cookie-error">{cookieUploadError}</p>
        {/if}
      </div>
    {/if}

    <button type="submit" class="primary-btn" disabled={(platform === 'rss' ? !feedUrl.trim() : !handle.trim()) || loading}>
      {#if loading}
        <span class="btn-spinner"></span>
        <span class="btn-text">
          {#if platform === 'rss'}
            {#if articleCount > 0}
              Fetching... {articleCount} articles found
            {:else}
              Fetching articles...
            {/if}
          {:else}
            {#if videoCount > 0}
              Fetching... {videoCount} posts found
            {:else}
              Searching for content...
            {/if}
          {/if}
        </span>
      {:else}
        <span class="btn-text">{platform === 'rss' ? 'Fetch Articles' : 'Fetch Content'}</span>
        <svg class="btn-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      {/if}
    </button>

    {#if loading && platform === 'rss' && fetchedArticles.length > 0}
      <button type="button" class="secondary-btn" on:click={handlePause} on:touchend|preventDefault={handlePause}>
        Continue with {fetchedArticles.length} articles
      </button>
    {:else if loading && platform !== 'rss' && videoCount > 0}
      <button type="button" class="secondary-btn" on:click={handlePause}>
        Continue with {videoCount} posts
      </button>
    {/if}
  </form>

  <div class="divider">
    <span>or connect your Nostr identity</span>
  </div>

  <div class="primal-section">
    <div class="qr-container">
      {#if connectionStatus === 'connected'}
        <div class="connected-state">
          <div class="success-ring">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <span class="connected-label">Connected</span>
          <code class="pubkey">{hexToNpub($wizard.nip46Pubkey || '').slice(0, 24)}...</code>
        </div>
      {:else if connectionStatus === 'error'}
        <div class="error-state">
          <p class="error-text">{connectionError}</p>
          <button class="retry-btn" on:click={retryConnection}>Try Again</button>
        </div>
      {:else if qrCodeDataUrl}
        <!-- Login with Primal button for mobile (includes callback for redirect) -->
        <a
          href={mobileConnectionURI}
          class="primal-login-btn"
          aria-label="Login with Primal"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
          Log in with Primal
        </a>

        <div class="qr-divider">
          <span>or scan QR code</span>
        </div>

        <div class="qr-wrapper">
          <img src={qrCodeDataUrl} alt="Scan with Primal" class="qr-code" />
        </div>
        <div class="waiting-indicator">
          <div class="pulse-dot"></div>
          <span>Waiting for connection...</span>
        </div>
      {:else}
        <div class="loading-state">
          <div class="qr-spinner"></div>
          <span>Generating QR code...</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="how-it-works">
    <h3>How it works</h3>
    <div class="steps-list">
      <div class="step-item">
        <div class="step-icon">1</div>
        <span>We find your public posts</span>
      </div>
      <div class="step-item">
        <div class="step-icon">2</div>
        <span>You choose which ones to keep</span>
      </div>
      <div class="step-item">
        <div class="step-icon">3</div>
        <span>Your media is stored permanently</span>
      </div>
      <div class="step-item">
        <div class="step-icon">4</div>
        <span>You own your posts on Primal</span>
      </div>
    </div>
  </div>

  <div class="other-options">
    <h3>Other options</h3>
    <div class="option-buttons">
      <a href="/propose" class="option-btn propose-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <div class="option-text">
          <span class="option-title">Propose Content</span>
          <span class="option-desc">Propose content for existing nostr user</span>
        </div>
      </a>
      <a href="/gift" class="option-btn gift-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
        </svg>
        <div class="option-text">
          <span class="option-title">Gift Freedom</span>
          <span class="option-desc">Create a nostr profile for someone else</span>
        </div>
      </a>
    </div>
  </div>
</div>

<style>
  .handle-step {
    max-width: 480px;
    margin: 0 auto;
  }

  .hero-section {
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

  .platform-selector {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-bottom: 1rem;
  }

  .platform-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .platform-btn:hover:not(:disabled) {
    border-color: var(--text-secondary);
  }

  .platform-btn.active {
    border-color: var(--accent);
    background: rgba(147, 51, 234, 0.1);
    color: var(--accent);
  }

  .platform-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Mobile responsive styles for platform selector */
  @media (max-width: 400px) {
    .platform-selector {
      flex-wrap: wrap;
    }

    .platform-btn {
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
    }
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    padding: 0 1rem;
    transition: all 0.2s ease;
  }

  .input-wrapper:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15);
  }

  .input-wrapper.loading {
    opacity: 0.7;
  }

  .at-symbol {
    color: var(--text-muted);
    font-size: 1.125rem;
    font-weight: 500;
    margin-right: 0.25rem;
  }

  .url-icon {
    color: var(--text-muted);
    flex-shrink: 0;
    margin-right: 0.5rem;
  }

  .url-input input {
    font-size: 0.9375rem;
  }

  input {
    flex: 1;
    padding: 0.875rem 0;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 1.125rem;
    font-weight: 500;
    outline: none;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .input-spinner {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
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

  .btn-spinner {
    width: 1.125rem;
    height: 1.125rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .btn-arrow {
    transition: transform 0.2s ease;
  }

  .primary-btn:hover:not(:disabled) .btn-arrow {
    transform: translateX(3px);
  }

  .secondary-btn {
    padding: 0.75rem 1.25rem;
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
    border-color: var(--accent);
    color: var(--accent);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 2rem 0;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .divider span {
    color: var(--text-muted);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  .primal-section {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.5rem;
  }

  .primal-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
  }

  .primal-description {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }

  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 280px;
    justify-content: center;
  }

  .qr-wrapper {
    padding: 1rem;
    background: white;
    border-radius: 1rem;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  }

  .qr-code {
    display: block;
    width: 200px;
    height: 200px;
    border-radius: 0.5rem;
  }

  .waiting-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .qr-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .connected-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .success-ring {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, var(--success), #00A855);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    animation: scaleIn 0.3s ease-out;
  }

  @keyframes scaleIn {
    from { transform: scale(0.5); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .connected-label {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--success);
  }

  .pubkey {
    font-size: 0.75rem;
    background: var(--bg-primary);
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    color: var(--text-secondary);
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
  }

  .error-text {
    color: var(--error);
    font-size: 0.875rem;
  }

  .retry-btn {
    padding: 0.5rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .retry-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .how-it-works {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .how-it-works h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 1rem;
  }

  .steps-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .step-icon {
    width: 1.5rem;
    height: 1.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    flex-shrink: 0;
  }

  /* Login with Primal button */
  .primal-login-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1.25rem;
    background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 50%, #D946EF 100%);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
    box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
  }

  .primal-login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
  }

  .primal-login-btn:active {
    transform: translateY(0);
  }

  .primal-login-btn svg {
    flex-shrink: 0;
  }

  .qr-divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
    color: var(--text-muted);
    font-size: 0.75rem;
    width: 100%;
  }

  .qr-divider::before,
  .qr-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .other-options {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .other-options h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 1rem;
  }

  .option-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .option-btn {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    text-decoration: none;
    color: var(--text-primary);
    transition: all 0.2s ease;
  }

  .option-btn:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .option-btn svg {
    flex-shrink: 0;
    color: var(--accent);
  }

  .option-text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .option-title {
    font-weight: 600;
    font-size: 0.9375rem;
  }

  .option-desc {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .propose-btn:hover svg {
    color: #10B981;
  }

  .gift-btn:hover svg {
    color: #F59E0B;
  }

  .rss-gift-btn:hover svg {
    color: #8B5CF6;
  }

  /* Cookie upload styles */
  .cookie-upload {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
  }

  .cookie-instructions {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .cookie-instructions svg {
    flex-shrink: 0;
    margin-top: 0.125rem;
    color: var(--accent);
  }

  .cookie-input {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-primary);
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .cookie-input:hover {
    border-color: var(--accent);
    border-style: solid;
  }

  .cookie-input.has-file {
    border-color: var(--success);
    border-style: solid;
    background: rgba(16, 185, 129, 0.05);
  }

  .cookie-input input[type="file"] {
    display: none;
  }

  .cookie-input svg {
    flex-shrink: 0;
    color: var(--accent);
  }

  .cookie-input.has-file svg {
    color: var(--success);
  }

  .cookie-input .file-name {
    color: var(--text-primary);
    font-weight: 500;
  }

  .cookie-error {
    color: var(--error);
    font-size: 0.8125rem;
    margin: 0;
  }
</style>
