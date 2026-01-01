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
    // Cleanup connection if not used
    if (pendingConnection && $wizard.authMode !== 'nip46') {
      closeConnection(pendingConnection);
    }
  });

  async function initNIP46Connection() {
    try {
      connectionStatus = 'waiting';
      connectionError = '';

      // Generate local keypair for NIP-46 client
      localKeypair = generateLocalKeypair();
      connectionSecret = generateSecret();

      // Create connection URI
      connectionURI = createConnectionURI(localKeypair.publicKey, connectionSecret);

      // Generate QR code
      qrCodeDataUrl = await generateQRCode(connectionURI);

      // Start listening for connection in background
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

      // Store connection in wizard
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
    wizard.setLoading(true);
    wizard.setError(null);

    try {
      const cleanHandle = handle.replace('@', '').trim();

      // Use SSE to stream video fetch progress
      const response = await fetch(`/api/videos-stream/${encodeURIComponent(cleanHandle)}`);

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

      // If we get here without 'done', something went wrong
      throw new Error('Stream ended unexpectedly');
    } catch (err) {
      wizard.setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      loading = false;
      wizard.setLoading(false);
    }
  }
</script>

<div class="step-content">
  <h2>Enter your Instagram handle</h2>
  <p class="description">
    We'll fetch your public videos from Instagram to migrate them to Nostr.
  </p>

  <form on:submit|preventDefault={handleSubmit}>
    <div class="input-group">
      <span class="prefix">@</span>
      <input
        type="text"
        bind:value={handle}
        placeholder="username"
        disabled={loading}
        autocomplete="off"
        autocapitalize="off"
      />
    </div>

    <button type="submit" disabled={!handle.trim() || loading}>
      {#if loading}
        <span class="spinner"></span>
        {#if videoCount > 0}
          Fetching videos... {videoCount} found
        {:else}
          Fetching videos...
        {/if}
      {:else}
        Continue
      {/if}
    </button>
  </form>

  <div class="divider">
    <span>or login with your existing Nostr identity</span>
  </div>

  <div class="primal-login">
    <h3>Login with Primal</h3>
    <p class="qr-description">Scan this QR code with your Primal app to connect</p>

    <div class="qr-container">
      {#if connectionStatus === 'connected'}
        <div class="connected-state">
          <div class="checkmark">✓</div>
          <p class="connected-text">Connected to Primal</p>
          <code class="pubkey">{hexToNpub($wizard.nip46Pubkey || '').slice(0, 20)}...</code>
        </div>
      {:else if connectionStatus === 'error'}
        <div class="error-state">
          <p class="error-text">{connectionError}</p>
          <button class="retry-btn" on:click={retryConnection}>Try Again</button>
        </div>
      {:else if qrCodeDataUrl}
        <img src={qrCodeDataUrl} alt="Scan with Primal" class="qr-code" />
        <p class="waiting-text">Waiting for connection...</p>
      {:else}
        <div class="loading-qr">
          <span class="spinner"></span>
          <p>Generating QR code...</p>
        </div>
      {/if}
    </div>
  </div>

  <div class="info">
    <h3>How it works</h3>
    <ul>
      <li>We fetch your public Instagram videos</li>
      <li>You select which videos to migrate</li>
      <li>Videos are uploaded to Blossom media server</li>
      <li>Posts are published to Nostr relays</li>
    </ul>
  </div>
</div>

<style>
  .step-content {
    text-align: center;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
  }

  .description {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  form {
    max-width: 400px;
    margin: 0 auto;
  }

  .input-group {
    display: flex;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
    margin-bottom: 1rem;
    transition: border-color 0.2s;
  }

  .input-group:focus-within {
    border-color: var(--accent);
  }

  .prefix {
    padding: 0.75rem 1rem;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 1.125rem;
  }

  input {
    flex: 1;
    padding: 0.75rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 1.125rem;
    outline: none;
  }

  input::placeholder {
    color: var(--text-secondary);
  }

  button {
    width: 100%;
    padding: 0.875rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  button:disabled {
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

  .divider {
    display: flex;
    align-items: center;
    margin: 2rem auto;
    max-width: 400px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid var(--border);
  }

  .divider span {
    padding: 0 1rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .primal-login {
    max-width: 400px;
    margin: 0 auto 2rem;
    padding: 1.5rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
    border: 1px solid var(--border);
  }

  .primal-login h3 {
    font-size: 1.125rem;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
  }

  .qr-description {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }

  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 300px;
    justify-content: center;
  }

  .qr-code {
    border-radius: 0.5rem;
    background: white;
    padding: 0.5rem;
  }

  .waiting-text {
    margin-top: 1rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .loading-qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    color: var(--text-secondary);
  }

  .loading-qr .spinner {
    width: 2rem;
    height: 2rem;
    border-color: var(--border);
    border-top-color: var(--accent);
  }

  .connected-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .checkmark {
    width: 4rem;
    height: 4rem;
    background: #22c55e;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: white;
  }

  .connected-text {
    font-size: 1.125rem;
    font-weight: 600;
    color: #22c55e;
  }

  .pubkey {
    font-size: 0.75rem;
    background: var(--bg-primary);
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    color: var(--text-secondary);
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .error-text {
    color: #ef4444;
    font-size: 0.875rem;
  }

  .retry-btn {
    width: auto;
    padding: 0.5rem 1.5rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .retry-btn:hover {
    border-color: var(--accent);
  }

  .info {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border);
    text-align: left;
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  }

  .info h3 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .info ul {
    list-style: none;
    padding: 0;
  }

  .info li {
    padding: 0.5rem 0;
    padding-left: 1.5rem;
    position: relative;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .info li::before {
    content: '→';
    position: absolute;
    left: 0;
    color: var(--accent);
  }
</style>
