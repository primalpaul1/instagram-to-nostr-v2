<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { waitForConnectionResponse } from '$lib/nip46';

  let status = 'Connecting to Primal...';
  let error = '';
  let debugInfo = '';

  onMount(async () => {
    if (!browser) return;

    // Log URL and query params - Primal might include response data
    debugInfo = `URL: ${window.location.href}\n`;
    const urlParams = new URLSearchParams(window.location.search);
    const allParams: Record<string, string> = {};
    for (const [key, value] of urlParams.entries()) {
      allParams[key] = value;
      debugInfo += `Param ${key}: ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}\n`;
    }

    const returnUrl = localStorage.getItem('nip46_return_url') || '/';
    debugInfo += `Return URL: ${returnUrl}\n`;

    // Mark that callback was received (for debugging)
    localStorage.setItem('nip46_callback_received', 'true');

    // Check if Primal passed pubkey directly in URL params
    const pubkeyFromUrl = allParams['pubkey'] || allParams['remote_pubkey'] || allParams['npub'];
    if (pubkeyFromUrl) {
      debugInfo += `Got pubkey from URL: ${pubkeyFromUrl.slice(0, 20)}...\n`;
    }

    // Find which pending connection we have
    const pendingKeys = ['nip46_pending_main', 'nip46_pending', 'nip46_pending_rss'];
    let pendingKey = '';
    let pendingData: { localSecretKey: string; localPublicKey: string; secret: string } | null = null;

    for (const key of pendingKeys) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          pendingKey = key;
          pendingData = JSON.parse(data);
          debugInfo += `Found pending: ${key}\n`;
          break;
        } catch {
          debugInfo += `Invalid JSON for ${key}\n`;
        }
      }
    }

    if (!pendingData) {
      debugInfo += 'No pending connection found\n';
      status = 'No pending connection';
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 2000);
      return;
    }

    const { localSecretKey, localPublicKey, secret } = pendingData;
    const resultKey = pendingKey.replace('pending', 'connected_pubkey');
    debugInfo += `Local pubkey: ${localPublicKey.slice(0, 16)}...\n`;
    debugInfo += `Secret: ${secret.slice(0, 20)}...\n`;

    // If Primal passed pubkey in URL, use that directly
    if (pubkeyFromUrl) {
      debugInfo += 'Using pubkey from URL params\n';
      localStorage.setItem(resultKey, pubkeyFromUrl);
      status = 'Connected! Redirecting...';
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 500);
      return;
    }

    // Otherwise try to get response from relay (with shorter timeout)
    try {
      status = 'Waiting for Primal response...';
      debugInfo += 'Connecting to relay...\n';

      const remotePubkey = await waitForConnectionResponse(
        localSecretKey,
        localPublicKey,
        secret,
        15000  // 15 second timeout - if Primal approved, response should be there
      );

      debugInfo += `Got remotePubkey: ${remotePubkey.slice(0, 16)}...\n`;
      localStorage.setItem(resultKey, remotePubkey);

      status = 'Connected! Redirecting...';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      error = errMsg;
      debugInfo += `Error: ${errMsg}\n`;
      debugInfo += 'Redirecting anyway - original page will retry\n';
      console.error('Connection error:', err);
    }

    setTimeout(() => {
      window.location.href = returnUrl;
    }, error ? 1500 : 500);
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
  <pre class="debug">{debugInfo}</pre>
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
  .debug {
    font-size: 0.7rem;
    color: #666;
    text-align: left;
    max-width: 90%;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
