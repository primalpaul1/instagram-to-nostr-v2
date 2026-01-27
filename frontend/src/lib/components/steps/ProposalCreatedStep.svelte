<script lang="ts">
  import { wizard, selectedPosts, selectedArticles } from '$lib/stores/wizard';

  let copied = false;

  $: claimUrl = $wizard.proposalClaimUrl || '';
  $: isArticlesMode = $wizard.contentType === 'articles';

  // Estimate upload time based on content
  function estimateUploadTime(): string {
    const reels = $selectedPosts.filter(p => p.post_type === 'reel').length;
    const images = $selectedPosts.filter(p => p.post_type !== 'reel').length;
    const articleCount = $selectedArticles.length;
    const CONCURRENCY = 3;

    const totalSeconds = Math.ceil(
      (reels * 20 + images * 5 + articleCount * 3) / CONCURRENCY
    );

    const minutes = Math.max(1, Math.ceil(totalSeconds / 60));
    return minutes <= 2 ? "1-2 minutes" : `about ${minutes} minutes`;
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(claimUrl);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 3000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function goToClaimPage() {
    window.location.href = claimUrl;
  }

  function handleStartOver() {
    // Store claim URL in localStorage as backup before resetting
    if (claimUrl) {
      localStorage.setItem('pending_claim_url', JSON.stringify({
        url: claimUrl,
        handle: $wizard.handle,
        timestamp: Date.now()
      }));
    }
    wizard.reset();
  }
</script>

<div class="proposal-created-step">
  <div class="celebration">
    <div class="success-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
    <h2>Your Content is Being Prepared!</h2>
    <p class="subtitle">
      We're uploading your {isArticlesMode ? 'articles' : 'posts'} to the decentralized web.
      This usually takes {estimateUploadTime()}.
    </p>
  </div>

  <div class="info-card">
    <div class="info-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4M12 8h.01"/>
      </svg>
      <span>What happens next</span>
    </div>
    <ul class="info-list">
      <li>Your content is uploading in the background</li>
      <li>You can close this tab - you'll get a DM with the link</li>
      <li>When ready, visit your claim link to sign and publish</li>
    </ul>
  </div>

  <div class="claim-url-card">
    <div class="claim-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
      </svg>
      <span>Your Claim Link</span>
    </div>
    <div class="url-container">
      <code class="url-text">{claimUrl}</code>
      <button class="copy-btn" class:copied on:click={copyToClipboard}>
        {#if copied}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied!
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy
        {/if}
      </button>
    </div>
    <p class="url-hint">Save this link - you'll need it to complete your migration</p>
  </div>

  <button class="primary-btn" on:click={goToClaimPage}>
    Go to Claim Page
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  </button>

  <div class="dm-notice">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
    <span>We'll send you a Nostr DM with this link as a backup</span>
  </div>

  <button class="secondary-btn" on:click={handleStartOver}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 4v6h6"/>
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
    </svg>
    Own More Posts
  </button>
</div>

<style>
  .proposal-created-step {
    max-width: 520px;
    margin: 0 auto;
    text-align: center;
  }

  .celebration {
    margin-bottom: 2rem;
  }

  .success-icon {
    width: 5rem;
    height: 5rem;
    background: var(--accent-gradient);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
    animation: scaleIn 0.5s ease-out;
    box-shadow: 0 8px 32px rgba(var(--accent-rgb), 0.4);
  }

  @keyframes scaleIn {
    0% { transform: scale(0); opacity: 0; }
    60% { transform: scale(1.1); }
    100% { transform: scale(1); opacity: 1; }
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .info-card {
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.2);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .info-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .info-list {
    margin: 0;
    padding-left: 1.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .info-list li {
    padding: 0.25rem 0;
  }

  .claim-url-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .claim-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    margin-bottom: 0.75rem;
  }

  .url-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border-light);
    border-radius: 0.625rem;
    padding: 0.75rem;
  }

  .url-text {
    flex: 1;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75rem;
    color: var(--text-primary);
    word-break: break-all;
    line-height: 1.4;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .copy-btn:hover {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.1);
  }

  .copy-btn.copied {
    background: rgba(var(--success-rgb), 0.15);
    border-color: var(--success);
    color: var(--success);
  }

  .url-hint {
    margin: 0.75rem 0 0 0;
    font-size: 0.75rem;
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
    transition: all 0.2s ease;
    margin-bottom: 1rem;
  }

  .primary-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(var(--accent-rgb), 0.4);
  }

  .dm-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(var(--success-rgb), 0.08);
    border: 1px solid rgba(var(--success-rgb), 0.2);
    border-radius: 0.75rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    margin-bottom: 1.5rem;
  }

  .dm-notice svg {
    color: var(--success);
    flex-shrink: 0;
  }

  .secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .secondary-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }
</style>
