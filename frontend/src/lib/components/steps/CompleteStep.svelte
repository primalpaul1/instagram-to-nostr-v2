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
    <span class="cta-text">View on Primal</span>
    <svg class="cta-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M7 17L17 7M17 7H7M17 7v10"/>
    </svg>
  </a>

  {#if !isNip46Mode}
    <div class="download-primal">
      <div class="qr-section">
        <div class="qr-wrapper">
          <img
            src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=https://primal.net/downloads&bgcolor=ffffff&color=000000"
            alt="QR Code to download Primal"
            width="180"
            height="180"
          />
        </div>
        <div class="qr-info">
          <h3>Get Primal</h3>
          <p>Scan to download Primal and log in with your Primal Key</p>
          <a href="https://primal.net/downloads" target="_blank" rel="noopener noreferrer" class="download-link">
            Or visit primal.net/downloads
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  {/if}

  {#if isNip46Mode}
    <div class="freedom-section">
      <div class="freedom-card own-content">
        <div class="freedom-glow"></div>
        <div class="freedom-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="freedom-content">
          <h4>You own your content</h4>
          <p>Congratulations! Your posts now live on the decentralized web — free from algorithms, censorship, and corporate control. Forever.</p>
        </div>
      </div>

      <div class="freedom-card tell-friends">
        <div class="freedom-icon share">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="freedom-content">
          <h4>Tell your friends</h4>
          <p>Help others break free from Instagram. Share the migration tool and grow the decentralized community.</p>
        </div>
        <a href="https://instatoprimal.com" class="share-link" target="_blank" rel="noopener noreferrer">
          <span>instatoprimal.com</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M7 17L17 7M17 7H7M17 7v10"/>
          </svg>
        </a>
      </div>
    </div>
  {:else}
    <div class="freedom-section">
      <div class="freedom-card own-content">
        <div class="freedom-glow"></div>
        <div class="freedom-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="freedom-content">
          <h4>You own your content</h4>
          <p>Congratulations! Your posts now live on the decentralized web — free from algorithms, censorship, and corporate control. Forever.</p>
        </div>
      </div>

      <div class="freedom-card keys-card">
        <div class="freedom-icon keys">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
        </div>
        <div class="freedom-content">
          <h4>Save your Primal Key</h4>
          <p>Your Primal Key is your login — store it safely in a password manager. If you lose it, you lose access forever.</p>
        </div>
      </div>

      <div class="freedom-card tell-friends">
        <div class="freedom-icon share">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="freedom-content">
          <h4>Tell your friends</h4>
          <p>Help others break free from Instagram. Share the migration tool and grow the decentralized community.</p>
        </div>
        <a href="https://instatoprimal.com" class="share-link" target="_blank" rel="noopener noreferrer">
          <span>instatoprimal.com</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M7 17L17 7M17 7H7M17 7v10"/>
          </svg>
        </a>
      </div>
    </div>
  {/if}

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

  .download-primal {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .qr-section {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .qr-wrapper {
    flex-shrink: 0;
    background: white;
    padding: 0.5rem;
    border-radius: 0.75rem;
  }

  .qr-wrapper img {
    display: block;
    border-radius: 0.5rem;
  }

  .qr-info {
    text-align: left;
  }

  .qr-info h3 {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .qr-info p {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .download-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--accent);
    text-decoration: none;
  }

  .download-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 480px) {
    .qr-section {
      flex-direction: column;
      text-align: center;
    }

    .qr-info {
      text-align: center;
    }
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

  /* Freedom Section - NIP-46 Celebratory Cards */
  .freedom-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .freedom-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 1rem;
    text-align: left;
    overflow: hidden;
    animation: cardSlideIn 0.6s ease-out backwards;
  }

  .freedom-card.own-content {
    animation-delay: 0.1s;
    border-color: rgba(var(--accent-rgb), 0.3);
    background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.08) 0%, var(--bg-tertiary) 60%);
  }

  .freedom-card.tell-friends {
    animation-delay: 0.25s;
  }

  @keyframes cardSlideIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .freedom-glow {
    position: absolute;
    top: -50%;
    right: -30%;
    width: 200px;
    height: 200px;
    background: radial-gradient(circle, rgba(var(--accent-rgb), 0.15) 0%, transparent 70%);
    pointer-events: none;
    animation: glowPulse 4s ease-in-out infinite;
  }

  @keyframes glowPulse {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }

  .freedom-icon {
    width: 3.5rem;
    height: 3.5rem;
    background: var(--accent-gradient);
    border-radius: 0.875rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 4px 20px rgba(var(--accent-rgb), 0.3);
  }

  .freedom-icon.share {
    background: linear-gradient(135deg, var(--success) 0%, #00A855 100%);
    box-shadow: 0 4px 20px rgba(var(--success-rgb), 0.3);
  }

  .freedom-icon.keys {
    background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
    box-shadow: 0 4px 20px rgba(245, 158, 11, 0.3);
  }

  .freedom-card.keys-card {
    animation-delay: 0.2s;
    border-color: rgba(245, 158, 11, 0.3);
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, var(--bg-tertiary) 60%);
  }

  .freedom-content h4 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 0.375rem;
    letter-spacing: -0.01em;
  }

  .freedom-content p {
    font-size: 0.9rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .share-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: rgba(var(--success-rgb), 0.12);
    border: 1px solid rgba(var(--success-rgb), 0.25);
    border-radius: 0.625rem;
    color: var(--success);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    width: fit-content;
    transition: all 0.2s ease;
  }

  .share-link:hover {
    background: rgba(var(--success-rgb), 0.2);
    border-color: var(--success);
    transform: translateY(-1px);
  }

  .share-link svg {
    opacity: 0.7;
    transition: all 0.2s ease;
  }

  .share-link:hover svg {
    opacity: 1;
    transform: translate(2px, -2px);
  }
</style>
