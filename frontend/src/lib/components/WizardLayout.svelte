<script lang="ts">
  import { wizard } from '$lib/stores/wizard';
</script>

<div class="app-container">
  <header>
    <h1>Own Your Posts</h1>
    <p class="tagline">Bring your content to Primal. Keep it forever. <a href="/why" class="why-link">Why Primal?</a></p>
  </header>

  <main>
    <div class="content-card">
      <slot />
    </div>
  </main>

  {#if $wizard.error}
    <div class="error-toast">
      <div class="error-content">
        <span class="error-icon">!</span>
        <span class="error-message">{$wizard.error}</span>
      </div>
      <button class="error-dismiss" on:click={() => wizard.setError(null)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .app-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
  }

  header {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.02em;
    margin-bottom: 0.25rem;
  }

  .tagline {
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }

  .why-link {
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    transition: opacity 0.2s;
    margin-left: 0.25rem;
  }

  .why-link:hover {
    opacity: 0.8;
    text-decoration: underline;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .content-card {
    background: var(--bg-glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border-light);
    border-radius: 1rem;
    padding: 2rem;
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  }

  .error-toast {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: rgba(255, 75, 75, 0.15);
    border: 1px solid var(--error);
    border-radius: 0.75rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    animation: slideUp 0.3s ease-out;
    max-width: 90%;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(1rem);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .error-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: var(--error);
    border-radius: 50%;
    font-size: 0.875rem;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .error-message {
    color: var(--error);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .error-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    background: transparent;
    border: none;
    color: var(--error);
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .error-dismiss:hover {
    opacity: 1;
  }

  @media (max-width: 640px) {
    .app-container {
      padding: 1rem;
    }

    header {
      margin-bottom: 1rem;
    }

    h1 {
      font-size: 1.375rem;
    }

    .tagline {
      font-size: 0.875rem;
    }

    .why-link {
      font-size: 0.8125rem;
    }

    .content-card {
      padding: 1.25rem;
      border-radius: 0.75rem;
    }
  }
</style>
