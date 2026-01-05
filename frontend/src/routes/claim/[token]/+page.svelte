<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
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
  import {
    createMultiMediaPostEvent,
    signWithNIP46,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload
  } from '$lib/signing';

  type PageStep = 'loading' | 'preview' | 'connect' | 'verify_error' | 'publishing' | 'complete' | 'error';

  interface ProposalPost {
    id: number;
    post_type: 'reel' | 'image' | 'carousel';
    caption: string | null;
    original_date: string | null;
    thumbnail_url: string | null;
    blossom_urls: string[];
    status: string;
  }

  interface Profile {
    username: string;
    display_name?: string;
    bio?: string;
    profile_picture_url?: string;
  }

  interface Proposal {
    status: string;
    targetNpub: string;
    targetPubkeyHex: string;
    handle: string;
    profile: Profile | null;
    posts: ProposalPost[];
  }

  let step: PageStep = 'loading';
  let proposal: Proposal | null = null;
  let error = '';

  // NIP-46 state
  let qrCodeDataUrl = '';
  let connectionSecret = '';
  let connectionURI = '';
  let localKeypair: { secretKey: string; publicKey: string } | null = null;
  let connectionStatus: 'idle' | 'waiting' | 'connected' | 'error' = 'idle';
  let connectionError = '';
  let nip46Connection: NIP46Connection | null = null;
  let connectedPubkey = '';

  // Publishing state
  interface TaskStatus {
    post: ProposalPost;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  let tasks: TaskStatus[] = [];
  let activeIndices: Set<number> = new Set();

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const token = $page.params.token;

  onMount(async () => {
    await loadProposal();
  });

  onDestroy(() => {
    if (nip46Connection) {
      closeConnection(nip46Connection);
    }
  });

  async function loadProposal() {
    try {
      const response = await fetch(`/api/proposals/${token}`);

      if (response.status === 404) {
        error = 'This proposal was not found.';
        step = 'error';
        return;
      }

      if (response.status === 410) {
        error = 'This proposal has expired.';
        step = 'error';
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load proposal');
      }

      const data = await response.json();

      if (data.status === 'claimed') {
        error = 'This migration has already been completed.';
        step = 'error';
        return;
      }

      if (data.status === 'pending' || data.status === 'processing') {
        error = 'This proposal is still being prepared. Please check back in a few minutes.';
        step = 'error';
        return;
      }

      proposal = data;
      step = 'preview';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load proposal';
      step = 'error';
    }
  }

  async function startConnect() {
    step = 'connect';
    await initNIP46Connection();
  }

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

      nip46Connection = connection;
      connectedPubkey = connection.remotePubkey;
      connectionStatus = 'connected';

      // Verify the connected pubkey matches the target
      await verifyPubkey();
    } catch (err) {
      connectionStatus = 'error';
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }
  }

  async function verifyPubkey() {
    if (!proposal || !connectedPubkey) return;

    try {
      const response = await fetch(`/api/proposals/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          pubkeyHex: connectedPubkey
        })
      });

      const data = await response.json();

      if (!data.valid) {
        step = 'verify_error';
        error = data.error || 'This migration was prepared for a different Nostr account.';
        return;
      }

      // Verified! Set up tasks and start publishing
      tasks = proposal.posts.map(post => ({ post, status: 'pending' }));
      step = 'publishing';
      await startPublishing();
    } catch (err) {
      step = 'error';
      error = err instanceof Error ? err.message : 'Verification failed';
    }
  }

  async function startPublishing() {
    if (!nip46Connection || !proposal) return;

    const CONCURRENCY = 2;

    try {
      const queue: number[] = [...Array(tasks.length).keys()];

      async function processQueue() {
        while (queue.length > 0) {
          const index = queue.shift();
          if (index !== undefined) {
            activeIndices.add(index);
            activeIndices = activeIndices;
            await publishPost(index);
            activeIndices.delete(index);
            activeIndices = activeIndices;
          }
        }
      }

      const workers = Array(CONCURRENCY).fill(null).map(() => processQueue());
      await Promise.all(workers);

      // Mark proposal as claimed
      await fetch(`/api/proposals/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          pubkeyHex: connectedPubkey
        })
      });

      step = 'complete';
    } catch (err) {
      console.error('Publishing error:', err);
    }
  }

  async function publishPost(index: number) {
    const task = tasks[index];
    if (!nip46Connection || !proposal) return;

    try {
      tasks[index] = { ...task, status: 'signing' };
      tasks = [...tasks];

      // Build media uploads from blossom URLs
      const mediaUploads: MediaUpload[] = task.post.blossom_urls.map((url, i) => ({
        url,
        sha256: url.split('/').pop() || '', // Extract hash from URL
        mimeType: task.post.post_type === 'reel' ? 'video/mp4' : 'image/jpeg',
        size: 0, // Not needed for posting
        width: undefined,
        height: undefined
      }));

      // Create post event
      const postEvent = createMultiMediaPostEvent(
        connectedPubkey,
        mediaUploads,
        task.post.caption || undefined,
        task.post.original_date || undefined
      );

      // Sign with NIP-46
      const signedPost = await signWithNIP46(nip46Connection, postEvent);

      tasks[index] = { ...tasks[index], status: 'publishing' };
      tasks = [...tasks];

      // Publish to relays
      const publishResult = await publishToRelays(signedPost, NOSTR_RELAYS);

      if (publishResult.success.length === 0) {
        throw new Error('Failed to publish to any relay');
      }

      // Import to Primal cache
      try {
        await importToPrimalCache([signedPost]);
      } catch {
        // Non-fatal
      }

      // Mark post as published
      await fetch(`/api/proposals/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markPostPublished',
          postId: task.post.id
        })
      });

      tasks[index] = { ...tasks[index], status: 'complete' };
      tasks = [...tasks];

    } catch (err) {
      console.error(`Error publishing post ${index}:`, err);
      tasks[index] = {
        ...tasks[index],
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error'
      };
      tasks = [...tasks];
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Waiting';
      case 'signing': return 'Signing';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Done';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }
</script>

<svelte:head>
  <title>Claim Your Content | Insta to Primal</title>
</svelte:head>

<div class="claim-page">
  <header>
    <a href="/" class="logo">Insta to Primal</a>
  </header>

  <main>
    {#if step === 'loading'}
      <div class="loading-step">
        <div class="spinner-large"></div>
        <p>Loading your migration...</p>
      </div>

    {:else if step === 'error'}
      <div class="error-step">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h2>Unable to Load</h2>
        <p class="error-msg">{error}</p>
        <a href="/" class="secondary-btn">Go to Homepage</a>
      </div>

    {:else if step === 'preview' && proposal}
      <div class="preview-step">
        <div class="gift-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 12 20 22 4 22 4 12"/>
            <rect x="2" y="7" width="20" height="5"/>
            <line x1="12" y1="22" x2="12" y2="7"/>
            <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/>
            <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
          </svg>
        </div>
        <h2>Your Instagram Content is Ready!</h2>
        <p class="subtitle">Someone prepared your @{proposal.handle} content for Nostr</p>

        <div class="summary-card">
          <div class="summary-row">
            <span class="label">From Instagram</span>
            <span class="value">@{proposal.handle}</span>
          </div>
          <div class="summary-row">
            <span class="label">Content</span>
            <span class="value">{proposal.posts.length} posts</span>
          </div>
          <div class="summary-row">
            <span class="label">Publishing to</span>
            <span class="value mono">{proposal.targetNpub.slice(0, 20)}...</span>
          </div>
        </div>

        <div class="posts-preview">
          <div class="preview-header">Preview</div>
          <div class="preview-grid">
            {#each proposal.posts.slice(0, 6) as post}
              <div class="preview-item">
                {#if post.thumbnail_url}
                  <img src={post.thumbnail_url} alt="" />
                {:else}
                  <div class="placeholder">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                    </svg>
                  </div>
                {/if}
              </div>
            {/each}
            {#if proposal.posts.length > 6}
              <div class="preview-more">+{proposal.posts.length - 6}</div>
            {/if}
          </div>
        </div>

        <button class="primary-btn" on:click={startConnect}>
          Connect Primal to Claim
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>

        <p class="disclaimer">
          You'll sign these posts with your Primal wallet. Only the account matching the target npub can claim this content.
        </p>
      </div>

    {:else if step === 'connect'}
      <div class="connect-step">
        <h2>Connect Your Primal Wallet</h2>
        <p class="subtitle">Scan with the Primal app to sign your posts</p>

        <div class="qr-container">
          {#if connectionStatus === 'connected'}
            <div class="connected-state">
              <div class="success-ring">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <span class="connected-label">Connected</span>
              <p class="verifying">Verifying your identity...</p>
            </div>
          {:else if connectionStatus === 'error'}
            <div class="error-state">
              <p class="error-text">{connectionError}</p>
              <button class="retry-btn" on:click={initNIP46Connection}>Try Again</button>
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

    {:else if step === 'verify_error'}
      <div class="verify-error-step">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <h2>Wrong Account</h2>
        <p class="error-msg">{error}</p>
        <p class="expected">Expected: {proposal?.targetNpub.slice(0, 24)}...</p>
        <p class="got">Connected: {hexToNpub(connectedPubkey).slice(0, 24)}...</p>
        <button class="secondary-btn" on:click={startConnect}>Try Different Account</button>
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <div class="migrating-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 2l4 4-4 4"/>
            <path d="M3 11v-1a4 4 0 014-4h14"/>
            <path d="M7 22l-4-4 4-4"/>
            <path d="M21 13v1a4 4 0 01-4 4H3"/>
          </svg>
        </div>
        <h2>Publishing Your Content</h2>
        <p class="subtitle">Primal is signing each post</p>

        <div class="progress-card">
          <div class="progress-header">
            <span>{completedCount} / {totalCount} posts</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progressPercent}%"></div>
          </div>
        </div>

        <div class="tasks-list">
          {#each tasks as task, i}
            <div
              class="task-item"
              class:active={activeIndices.has(i)}
              class:complete={task.status === 'complete'}
              class:error={task.status === 'error'}
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
                {:else if ['signing', 'publishing'].includes(task.status)}
                  <div class="task-spinner"></div>
                {:else}
                  <div class="task-pending"></div>
                {/if}
              </div>
              <span class="task-caption">{task.post.caption?.slice(0, 30) || 'Untitled'}</span>
              <span class="task-label">{getStatusLabel(task.status)}</span>
            </div>
          {/each}
        </div>
      </div>

    {:else if step === 'complete'}
      <div class="complete-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Migration Complete!</h2>
        <p class="subtitle">Your Instagram content is now on Nostr</p>

        <div class="stats-card">
          <div class="stat">
            <span class="stat-value">{completedCount}</span>
            <span class="stat-label">posts published</span>
          </div>
        </div>

        <a
          href="https://primal.net/p/{proposal?.targetNpub}"
          target="_blank"
          rel="noopener noreferrer"
          class="primary-btn"
        >
          View on Primal
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        <div class="success-message">
          <p>You now own your content on the open social web.</p>
          <p>No algorithms. No gatekeepers. Just you.</p>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .claim-page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    font-weight: 700;
    font-size: 1.125rem;
    color: var(--text-primary);
    text-decoration: none;
  }

  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 2rem;
  }

  /* Loading */
  .loading-step {
    text-align: center;
    padding: 4rem 0;
  }

  .spinner-large {
    width: 3rem;
    height: 3rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1.5rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Error */
  .error-step, .verify-error-step {
    text-align: center;
    padding: 2rem 0;
  }

  .error-icon {
    width: 5rem;
    height: 5rem;
    background: rgba(var(--error-rgb, 239, 68, 68), 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--error, #ef4444);
    margin: 0 auto 1.5rem;
  }

  .error-msg {
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }

  .expected, .got {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-family: 'SF Mono', Monaco, monospace;
    margin: 0.25rem 0;
  }

  /* Preview */
  .preview-step {
    text-align: center;
  }

  .gift-icon {
    width: 4rem;
    height: 4rem;
    background: var(--accent-gradient);
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  .summary-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .summary-row:last-child {
    border-bottom: none;
  }

  .summary-row .label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .summary-row .value {
    font-weight: 500;
    font-size: 0.875rem;
  }

  .summary-row .value.mono {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75rem;
  }

  .posts-preview {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .preview-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8125rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 2px;
  }

  .preview-item {
    aspect-ratio: 1;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .preview-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .preview-more {
    aspect-ratio: 1;
    background: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 1rem 1.5rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .primary-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(var(--accent-rgb), 0.4);
  }

  .secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .secondary-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .disclaimer {
    margin-top: 1rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /* Connect */
  .connect-step {
    text-align: center;
  }

  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 300px;
    justify-content: center;
    padding: 2rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
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
  }

  .connected-label {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--success);
  }

  .verifying {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .error-state {
    text-align: center;
  }

  .error-text {
    color: var(--error);
    margin-bottom: 1rem;
  }

  .retry-btn {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    color: var(--text-secondary);
  }

  .qr-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  /* Publishing */
  .publishing-step {
    text-align: center;
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
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
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
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }

  .task-item.active {
    border-color: var(--accent);
  }

  .task-item.complete {
    border-color: var(--success);
  }

  .task-item.error {
    border-color: var(--error);
  }

  .task-status {
    width: 1.25rem;
    height: 1.25rem;
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

  .task-caption {
    flex: 1;
    font-size: 0.8125rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-label {
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .task-item.active .task-label {
    color: var(--accent);
  }

  .task-item.complete .task-label {
    color: var(--success);
  }

  /* Complete */
  .complete-step {
    text-align: center;
    padding: 2rem 0;
  }

  .success-icon {
    width: 5rem;
    height: 5rem;
    background: linear-gradient(135deg, var(--success), #00A855);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  .stats-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stat-value {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--accent);
  }

  .stat-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .success-message {
    margin-top: 1.5rem;
    padding: 1rem;
    background: rgba(var(--success-rgb), 0.1);
    border-radius: 0.75rem;
  }

  .success-message p {
    margin: 0.25rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
</style>
