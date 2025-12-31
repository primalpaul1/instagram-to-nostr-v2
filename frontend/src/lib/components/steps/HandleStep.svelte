<script lang="ts">
  import { wizard } from '$lib/stores/wizard';

  let handle = '';
  let loading = false;

  async function handleSubmit() {
    if (!handle.trim()) return;

    loading = true;
    wizard.setLoading(true);
    wizard.setError(null);

    try {
      const cleanHandle = handle.replace('@', '').trim();

      // Fetch videos from backend
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: cleanHandle })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch videos');
      }

      const data = await response.json();

      if (data.videos.length === 0) {
        throw new Error('No videos found for this account');
      }

      wizard.setHandle(cleanHandle);
      wizard.setVideos(data.videos.map((v: any) => ({ ...v, selected: false })));
      wizard.setStep('keys');
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
        Fetching videos...
      {:else}
        Continue
      {/if}
    </button>
  </form>

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
