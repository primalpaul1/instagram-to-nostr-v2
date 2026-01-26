<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { waitForConnectionResponse } from '$lib/nip46';

  let status: 'checking' | 'success' | 'timeout' | 'error' = 'checking';
  let errorMessage = '';

  onMount(async () => {
    if (!browser) return;

    console.log('[Callback] Page loaded');
    console.log('[Callback] All localStorage keys:', Object.keys(localStorage));

    const pending = localStorage.getItem('nip46_pending_main');
    console.log('[Callback] nip46_pending_main:', pending ? 'exists' : 'null');

    if (!pending) {
      console.log('[Callback] ERROR: No pending connection found');
      status = 'error';
      errorMessage = 'No pending connection found';
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
      return;
    }

    try {
      const data = JSON.parse(pending);
      const age = Date.now() - (data.timestamp || 0);
      const FIVE_MINUTES = 5 * 60 * 1000;

      if (age > FIVE_MINUTES) {
        status = 'error';
        errorMessage = 'Connection expired';
        localStorage.removeItem('nip46_pending_main');
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
        return;
      }

      // Try to find the ACK from the signer
      console.log('[Callback] Looking for connection ACK...');
      console.log('[Callback] Using localPublicKey:', data.localPublicKey);
      console.log('[Callback] Using secret:', data.secret);

      const result = await waitForConnectionResponse(
        data.localSecretKey,
        data.localPublicKey,
        data.secret,
        20000 // 20 second timeout
      );

      console.log('[Callback] Found ACK! User pubkey:', result.userPubkey.slice(0, 16) + '...');
      console.log('[Callback] Bunker pubkey:', result.bunkerPubkey.slice(0, 16) + '...');

      // Save the successful connection for the main page to restore
      // IMPORTANT: Save both bunkerPubkey (for signer) and userPubkey (for verification)
      localStorage.setItem('nip46_connected', JSON.stringify({
        localSecretKey: data.localSecretKey,
        bunkerPubkey: result.bunkerPubkey,  // For creating the signer
        userPubkey: result.userPubkey,       // For verification
        timestamp: Date.now()
      }));

      // Clean up pending state
      localStorage.removeItem('nip46_pending_main');

      status = 'success';

      // Redirect back to original page (claim page or home)
      const returnUrl = data.returnUrl || '/';
      console.log('[Callback] Redirecting to:', returnUrl);
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 1000);

    } catch (err) {
      console.error('[Callback] Error:', err);
      status = 'timeout';
      errorMessage = err instanceof Error ? err.message : 'Connection failed';

      // Redirect back to try again
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
    }
  });
</script>

<div class="callback-page">
  {#if status === 'checking'}
    <div class="spinner"></div>
    <p>Connecting to your signer...</p>
  {:else if status === 'success'}
    <div class="success-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
    <p class="success-text">Connected!</p>
    <p class="redirect-text">Redirecting...</p>
  {:else if status === 'timeout'}
    <div class="error-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
    <p class="error-text">Connection timed out</p>
    <p class="redirect-text">Redirecting to try again...</p>
  {:else if status === 'error'}
    <div class="error-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    </div>
    <p class="error-text">{errorMessage}</p>
    <p class="redirect-text">Redirecting...</p>
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
    padding: 2rem;
    text-align: center;
  }

  .spinner {
    width: 3rem;
    height: 3rem;
    border: 3px solid #333;
    border-top-color: #8B5CF6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .success-icon {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, #10B981, #059669);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .error-icon {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, #EF4444, #DC2626);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .error-icon svg,
  .success-icon svg {
    width: 2rem;
    height: 2rem;
  }

  p {
    margin: 0;
    font-size: 1.125rem;
  }

  .success-text {
    color: #10B981;
    font-weight: 600;
    font-size: 1.5rem;
  }

  .error-text {
    color: #EF4444;
    font-weight: 600;
  }

  .redirect-text {
    color: #888;
    font-size: 0.875rem;
  }
</style>
