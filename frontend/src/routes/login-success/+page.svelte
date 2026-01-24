<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { waitForConnectionResponse } from '$lib/nip46';

  let status = 'Connecting to Primal...';
  let error = '';

  onMount(async () => {
    if (!browser) return;

    const returnUrl = sessionStorage.getItem('nip46_return_url') || '/';

    // Mark that callback was received (for debugging)
    sessionStorage.setItem('nip46_callback_received', 'true');

    // Find which pending connection we have
    const pendingKeys = ['nip46_pending_main', 'nip46_pending', 'nip46_pending_rss'];
    let pendingKey = '';
    let pendingData: { localSecretKey: string; localPublicKey: string; secret: string } | null = null;

    for (const key of pendingKeys) {
      const data = sessionStorage.getItem(key);
      if (data) {
        try {
          pendingKey = key;
          pendingData = JSON.parse(data);
          break;
        } catch {
          // Invalid JSON, skip
        }
      }
    }

    if (!pendingData) {
      // No pending connection, just redirect
      window.location.href = returnUrl;
      return;
    }

    const { localSecretKey, localPublicKey, secret } = pendingData;
    const resultKey = pendingKey.replace('pending', 'connected_pubkey');

    try {
      // Wait for connection response using `since` filter
      // This catches historical events that Primal sent while iOS had our WebSocket killed
      status = 'Waiting for Primal...';
      const remotePubkey = await waitForConnectionResponse(
        localSecretKey,
        localPublicKey,
        secret,
        60000 // 1 minute timeout
      );

      // Store the remotePubkey for original page
      sessionStorage.setItem(resultKey, remotePubkey);

      status = 'Connected! Redirecting...';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Connection failed';
      // Still redirect - original page can retry
    }

    // Redirect back
    setTimeout(() => {
      window.location.href = returnUrl;
    }, 500);
  });
</script>

<div class="callback-page">
  {#if error}
    <p class="error">{error}</p>
    <p>Redirecting...</p>
  {:else}
    <div class="spinner"></div>
    <p>{status}</p>
  {/if}
</div>

<style>
  .callback-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: system-ui, -apple-system, sans-serif;
    background: #0a0a0a;
    color: #fafafa;
    gap: 1rem;
  }
  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid #333;
    border-top-color: #8B5CF6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .error {
    color: #ef4444;
  }
</style>
