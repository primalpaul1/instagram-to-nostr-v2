<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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

  let handle = '';
  let loading = false;
  let videoCount = 0;
  let fetchedVideos: any[] = [];
  let fetchedProfile: any = null;
  let abortController: AbortController | null = null;

  // NIP-46 state
  let qrCodeDataUrl = '';
  let connectionSecret = '';
  let connectionURI = '';
  let localKeypair: { secretKey: string; publicKey: string } | null = null;
  let connectionStatus: 'idle' | 'waiting' | 'connected' | 'error' = 'idle';
  let connectionError = '';
  let pendingConnection: NIP46Connection | null = null;

  onMount(async () => {
    await initNIP46Connection();
  });

  onDestroy(() => {
    if (pendingConnection && $wizard.authMode !== 'nip46') {
      closeConnection(pendingConnection);
    }
  });

  async function initNIP46Connection() {
    try {
      connectionStatus = 'waiting';
      connectionError = '';
      localKeypair = generateLocalKeypair();
      connectionSecret = generateSecret();
      connectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret);
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

  async function handleSubmit() {
    if (!handle.trim()) return;

    loading = true;
    videoCount = 0;
    fetchedVideos = [];
    fetchedProfile = null;
    abortController = new AbortController();
    wizard.setLoading(true);
    wizard.setError(null);

    try {
      const cleanHandle = handle.replace('@', '').trim();
      const response = await fetch(`/api/videos-stream/${encodeURIComponent(cleanHandle)}`, {
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error('Failed to fetch videos');
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
                videoCount = data.count;
                if (data.videos) {
                  fetchedVideos = data.videos;
                }
                if (data.profile) {
                  fetchedProfile = data.profile;
                }
              }

              if (data.done) {
                if (data.videos.length === 0) {
                  throw new Error('No videos found for this account');
                }

                wizard.setHandle(cleanHandle);
                wizard.setVideos(data.videos.map((v: any) => ({ ...v, selected: false })));
                if (data.profile) {
                  wizard.setProfile(data.profile);
                }
                wizard.setStep('keys');
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
    if (!abortController || fetchedVideos.length === 0) return;

    const cleanHandle = handle.replace('@', '').trim();
    abortController.abort();

    wizard.setHandle(cleanHandle);
    wizard.setVideos(fetchedVideos.map((v: any) => ({ ...v, selected: false })));
    if (fetchedProfile) {
      wizard.setProfile(fetchedProfile);
    }
    wizard.setStep('keys');
  }
</script>

<div class="handle-step">
  <div class="hero-section">
    <h2>Enter your Instagram handle</h2>
    <p class="subtitle">We'll fetch your public videos and help you migrate them to Nostr</p>
  </div>

  <form on:submit|preventDefault={handleSubmit}>
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

    <button type="submit" class="primary-btn" disabled={!handle.trim() || loading}>
      {#if loading}
        <span class="btn-spinner"></span>
        <span class="btn-text">
          {#if videoCount > 0}
            Fetching... {videoCount} videos found
          {:else}
            Searching for videos...
          {/if}
        </span>
      {:else}
        <span class="btn-text">Fetch Videos</span>
        <svg class="btn-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      {/if}
    </button>

    {#if loading && videoCount > 0}
      <button type="button" class="secondary-btn" on:click={handlePause}>
        Continue with {videoCount} videos
      </button>
    {/if}
  </form>

  <div class="divider">
    <span>or connect your Nostr identity</span>
  </div>

  <div class="primal-section">
    <div class="primal-header">
      <svg class="primal-icon" width="24" height="24" viewBox="0 0 100 100" fill="none">
        <defs>
          <linearGradient id="primalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FA3C83"/>
            <stop offset="100%" stop-color="#FF8C42"/>
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="22" fill="url(#primalGrad)"/>
        <path d="M30 70V30h25c11 0 18 7 18 16s-7 16-18 16H42v8h-12z" fill="white"/>
        <circle cx="55" cy="46" r="6" fill="url(#primalGrad)"/>
      </svg>
      <span>Login with Primal</span>
    </div>
    <p class="primal-description">Scan with your Primal app to connect your existing Nostr identity</p>

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
        <span>We fetch your public Instagram videos</span>
      </div>
      <div class="step-item">
        <div class="step-icon">2</div>
        <span>You choose which videos to migrate</span>
      </div>
      <div class="step-item">
        <div class="step-icon">3</div>
        <span>Videos are uploaded to Blossom</span>
      </div>
      <div class="step-item">
        <div class="step-icon">4</div>
        <span>Posts are published to Nostr</span>
      </div>
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

  .primal-icon {
    border-radius: 6px;
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
</style>
