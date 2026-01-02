<script lang="ts">
  import { wizard } from '$lib/stores/wizard';
  import { hexToNpub } from '$lib/nip46';

  $: isNip46Mode = $wizard.authMode === 'nip46';
  $: displayNpub = isNip46Mode
    ? ($wizard.nip46Pubkey ? hexToNpub($wizard.nip46Pubkey) : '')
    : $wizard.keyPair?.npub || '';

  $: primalUrl = displayNpub
    ? `https://primal.net/p/${displayNpub}`
    : 'https://primal.net';

  function handleStartOver() {
    wizard.reset();
  }
</script>

<div class="complete-step">
  <div class="celebration">
    <div class="success-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
    <h2>Migration Complete!</h2>
    <p class="subtitle">Your videos are now live on Nostr</p>
  </div>

  <div class="profile-card">
    <div class="profile-label">Your Nostr Profile</div>
    <div class="profile-key">
      <span class="key-label">Public Key</span>
      <code class="npub">{displayNpub}</code>
    </div>
  </div>

  <a href={primalUrl} target="_blank" rel="noopener noreferrer" class="primal-cta">
    <div class="cta-content">
      <svg class="primal-logo" width="28" height="28" viewBox="0 0 100 100" fill="none">
        <defs>
          <linearGradient id="primalCtaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FA3C83"/>
            <stop offset="100%" stop-color="#FF8C42"/>
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="22" fill="url(#primalCtaGrad)"/>
        <path d="M30 70V30h25c11 0 18 7 18 16s-7 16-18 16H42v8h-12z" fill="white"/>
        <circle cx="55" cy="46" r="6" fill="url(#primalCtaGrad)"/>
      </svg>
      <span class="cta-text">View on Primal</span>
    </div>
    <svg class="cta-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M7 17L17 7M17 7H7M17 7v10"/>
    </svg>
  </a>

  <div class="next-steps">
    <h3>What's next?</h3>
    <div class="step-cards">
      {#if !isNip46Mode}
        <div class="step-card">
          <div class="step-icon keys">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
          </div>
          <div class="step-info">
            <strong>Secure your keys</strong>
            <span>Store your secret key (nsec) in a password manager</span>
          </div>
        </div>
      {/if}
      <div class="step-card">
        <div class="step-icon explore">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
          </svg>
        </div>
        <div class="step-info">
          <strong>Explore Nostr</strong>
          <span>Try <a href="https://damus.io" target="_blank">Damus</a>, <a href="https://snort.social" target="_blank">Snort</a>, or <a href="https://nostrudel.ninja" target="_blank">noStrudel</a></span>
        </div>
      </div>
      <div class="step-card">
        <div class="step-icon connect">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>
        <div class="step-info">
          <strong>Follow people</strong>
          <span>Find friends and interesting accounts on the decentralized network</span>
        </div>
      </div>
    </div>
  </div>

  <button class="restart-btn" on:click={handleStartOver}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 4v6h6"/>
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
    </svg>
    Migrate Another Account
  </button>
</div>

<style>
  .complete-step {
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
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 1rem;
  }

  .profile-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .profile-label {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .profile-key {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .key-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .npub {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.6875rem;
    word-break: break-all;
    background: var(--bg-primary);
    padding: 0.75rem;
    border-radius: 0.5rem;
    color: var(--text-primary);
  }

  .primal-cta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    background: var(--accent-gradient);
    border-radius: 0.875rem;
    color: white;
    text-decoration: none;
    margin-bottom: 2rem;
    transition: all 0.2s ease;
  }

  .primal-cta:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(var(--accent-rgb), 0.4);
  }

  .cta-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .primal-logo {
    border-radius: 8px;
  }

  .cta-text {
    font-size: 1.0625rem;
    font-weight: 600;
  }

  .cta-arrow {
    opacity: 0.8;
    transition: transform 0.2s ease;
  }

  .primal-cta:hover .cta-arrow {
    transform: translate(2px, -2px);
  }

  .next-steps {
    text-align: left;
    margin-bottom: 2rem;
  }

  .next-steps h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 1rem;
  }

  .step-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .step-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
  }

  .step-icon {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .step-icon.keys {
    background: rgba(255, 176, 32, 0.15);
    color: var(--warning);
  }

  .step-icon.explore {
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
  }

  .step-icon.connect {
    background: rgba(var(--success-rgb), 0.15);
    color: var(--success);
  }

  .step-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .step-info strong {
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .step-info span {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .step-info a {
    color: var(--accent);
    text-decoration: none;
  }

  .step-info a:hover {
    text-decoration: underline;
  }

  .restart-btn {
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

  .restart-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }
</style>
