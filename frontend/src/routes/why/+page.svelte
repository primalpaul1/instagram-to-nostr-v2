<script lang="ts">
</script>

<svelte:head>
  <title>Why Primal? | Own Your Posts</title>
</svelte:head>

<div class="why-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
  </header>

  <main>
    <section class="hero">
      <h1>Why Primal?</h1>
      <p class="subtitle">Your content. Your rules. Forever.</p>
    </section>

    <section class="benefits">
      <div class="benefit-card">
        <div class="benefit-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <h3>Own Your Identity</h3>
        <p>Your keys, your account. No company can ban you, delete your posts, or lock you out. You are in control.</p>
      </div>

      <div class="benefit-card">
        <div class="benefit-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
        </div>
        <h3>No Algorithm Prison</h3>
        <p>See posts from people you follow, in order. No algorithm deciding what you should see or hiding your content from your audience.</p>
      </div>

      <div class="benefit-card">
        <div class="benefit-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
          </svg>
        </div>
        <h3>Censorship Resistant</h3>
        <p>Your posts live on an open protocol, replicated across the world. No single point of failure. Your voice cannot be silenced.</p>
      </div>

      <div class="benefit-card">
        <div class="benefit-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <h3>Portable</h3>
        <p>Take your followers and content to any Nostr app. Primal, Damus, Amethyst - your identity works everywhere.</p>
      </div>

      <div class="benefit-card">
        <div class="benefit-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h3>Get Paid Directly</h3>
        <p>Zaps let your audience pay you instantly in Bitcoin. No middleman. No 30% platform cut. Direct creator support.</p>
      </div>
    </section>

    <section class="cta">
      <h2>Ready to own your posts?</h2>
      <a href="/" class="primary-btn">
        Get Started
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
    </section>
  </main>
</div>

<style>
  .why-page {
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
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  .hero {
    text-align: center;
    padding: 3rem 0;
  }

  h1 {
    font-size: 2.5rem;
    font-weight: 700;
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 0.75rem;
  }

  .subtitle {
    font-size: 1.25rem;
    color: var(--text-secondary);
  }

  .benefits {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-bottom: 4rem;
  }

  .benefit-card {
    display: flex;
    gap: 1.25rem;
    padding: 1.5rem;
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 1rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: all 0.2s ease;
  }

  .benefit-card:hover {
    border-color: var(--accent);
    background: rgba(250, 60, 131, 0.05);
  }

  .benefit-icon {
    width: 3.5rem;
    height: 3.5rem;
    background: var(--accent-gradient);
    border-radius: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }

  .benefit-card h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
  }

  .benefit-card p {
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0;
  }

  .cta {
    text-align: center;
    padding: 3rem 0;
    border-top: 1px solid var(--border);
  }

  .cta h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }

  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 2rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .primary-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(250, 60, 131, 0.4);
  }

  @media (max-width: 640px) {
    main {
      padding: 1.5rem;
    }

    h1 {
      font-size: 2rem;
    }

    .subtitle {
      font-size: 1rem;
    }

    .benefit-card {
      flex-direction: column;
      text-align: center;
    }

    .benefit-icon {
      margin: 0 auto;
    }
  }
</style>
