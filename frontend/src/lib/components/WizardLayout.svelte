<script lang="ts">
  import { wizard } from '$lib/stores/wizard';
</script>

<div class="app-container">
  <header>
    <div class="logo">
      <svg width="32" height="32" viewBox="0 0 100 100" fill="none">
        <defs>
          <linearGradient id="primalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FA3C83"/>
            <stop offset="100%" stop-color="#FF8C42"/>
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="22" fill="url(#primalGradient)"/>
        <path d="M30 70V30h25c11 0 18 7 18 16s-7 16-18 16H42v8h-12z" fill="white"/>
        <circle cx="55" cy="46" r="6" fill="url(#primalGradient)"/>
      </svg>
      <h1>Insta to Primal</h1>
    </div>
    <p class="tagline">Migrate your Instagram videos to Nostr</p>
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
    margin-bottom: 2.5rem;
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .logo svg {
    flex-shrink: 0;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.02em;
  }

  .tagline {
    color: var(--text-secondary);
    font-size: 1rem;
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

    h1 {
      font-size: 1.5rem;
    }

    .content-card {
      padding: 1.5rem;
      border-radius: 0.75rem;
    }
  }
</style>
