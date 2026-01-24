<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  onMount(() => {
    if (!browser) return;

    // Mark that callback was received (for debugging)
    sessionStorage.setItem('nip46_callback_received', 'true');

    // Get the return URL (stored before opening Primal)
    const returnUrl = sessionStorage.getItem('nip46_return_url') || '/';

    // Redirect back immediately
    window.location.href = returnUrl;
  });
</script>

<div class="callback-page">
  <p>Redirecting...</p>
</div>

<style>
  .callback-page {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: system-ui, -apple-system, sans-serif;
    background: #0a0a0a;
    color: #fafafa;
  }
</style>
