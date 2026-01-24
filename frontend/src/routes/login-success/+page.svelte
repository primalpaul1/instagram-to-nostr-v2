<script lang="ts">
  import { browser } from '$app/environment';

  // Simple redirect to home - the callback now points to the same page that's waiting,
  // so this page should only be hit if something goes wrong with the callback URL
  if (browser) {
    window.location.href = '/';
  }
</script>

<div class="callback-page">
  <div class="spinner"></div>
  <p>Redirecting...</p>
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
</style>
