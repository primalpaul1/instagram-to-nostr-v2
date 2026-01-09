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
    <h2>You Own Your Posts!</h2>
    <p class="subtitle">Your content is now yours forever on Primal</p>
  </div>

  <a href={primalUrl} target="_blank" rel="noopener noreferrer" class="primal-cta">
    <span class="cta-text">View on Primal Web</span>
    <svg class="cta-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M7 17L17 7M17 7H7M17 7v10"/>
    </svg>
  </a>

  {#if !isNip46Mode}
    <div class="whats-next-section">
      <h3 class="section-title">What's next?</h3>

      <div class="step-card">
        <div class="step-number">1</div>
        <div class="step-content">
          <h4>Download Primal on your phone</h4>
          <p>Get the app to access your content anywhere</p>

          <div class="download-row">
            <div class="qr-wrapper">
              <img
                src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://primal.net/downloads&bgcolor=ffffff&color=000000"
                alt="QR Code to download Primal"
                width="120"
                height="120"
              />
            </div>
            <div class="store-buttons">
              <a href="https://apps.apple.com/us/app/primal/id1673134518" target="_blank" rel="noopener noreferrer" class="store-btn">
                <svg width="20" height="24" viewBox="0 0 20 24" fill="currentColor">
                  <path d="M16.52 12.46c-.03-2.59 2.11-3.84 2.21-3.9-1.21-1.76-3.08-2-3.75-2.03-1.58-.17-3.11.94-3.91.94-.82 0-2.06-.92-3.39-.9-1.72.03-3.33 1.02-4.22 2.57-1.82 3.14-.46 7.76 1.28 10.3.87 1.24 1.89 2.62 3.23 2.57 1.3-.05 1.79-.83 3.36-.83 1.56 0 2.01.83 3.37.8 1.4-.02 2.28-1.25 3.12-2.5 1-1.43 1.41-2.83 1.43-2.9-.03-.01-2.73-1.05-2.76-4.12h.03zM13.89 4.43c.7-.87 1.18-2.05 1.05-3.25-1.01.04-2.27.69-3 1.54-.64.76-1.22 2-1.07 3.17 1.14.08 2.31-.57 3.02-1.46z"/>
                </svg>
                <div class="store-text">
                  <span class="store-label">Download on the</span>
                  <span class="store-name">App Store</span>
                </div>
              </a>
              <a href="https://play.google.com/store/apps/details?id=net.primal.android" target="_blank" rel="noopener noreferrer" class="store-btn">
                <svg width="20" height="22" viewBox="0 0 20 22" fill="currentColor">
                  <path d="M1 1.16v19.68c0 .67.74 1.07 1.32.71l16.36-9.84c.58-.35.58-1.17 0-1.51L2.32.36C1.74 0 1 .4 1 1.07v.09z"/>
                </svg>
                <div class="store-text">
                  <span class="store-label">Get it on</span>
                  <span class="store-name">Google Play</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>

      <div class="step-card">
        <div class="step-number">2</div>
        <div class="step-content">
          <h4>Log in with your Primal Key</h4>
          <p>Open Primal, tap "Login", then "Use login key" and paste your Primal Key</p>
          <div class="key-location">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            <span>Your key is saved in Downloads as <strong>primal-key.txt</strong></span>
          </div>
        </div>
      </div>

      <div class="step-card">
        <div class="step-number">3</div>
        <div class="step-content">
          <h4>Tell your friends!</h4>
          <p>Help others own their content forever</p>
          <a href="https://ownyourposts.com" class="share-link" target="_blank" rel="noopener noreferrer">
            <span>ownyourposts.com</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M7 17L17 7M17 7H7M17 7v10"/>
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
          <p>Help others own their content and join the decentralized community.</p>
        </div>
        <a href="https://ownyourposts.com" class="share-link" target="_blank" rel="noopener noreferrer">
          <span>ownyourposts.com</span>
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
    Own More Posts
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

  /* What's Next Section - Non-NIP46 */
  .whats-next-section {
    text-align: left;
    margin-bottom: 2rem;
  }

  .section-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 1.25rem;
    letter-spacing: -0.01em;
  }

  .step-card {
    display: flex;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    margin-bottom: 1rem;
    animation: cardSlideIn 0.5s ease-out backwards;
  }

  .step-card:nth-child(2) { animation-delay: 0.1s; }
  .step-card:nth-child(3) { animation-delay: 0.2s; }
  .step-card:nth-child(4) { animation-delay: 0.3s; }

  .step-number {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    background: var(--accent-gradient);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .step-content {
    flex: 1;
  }

  .step-content h4 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }

  .step-content p {
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }

  .download-row {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    margin-top: 1rem;
  }

  .qr-wrapper {
    flex-shrink: 0;
    background: white;
    padding: 0.375rem;
    border-radius: 0.625rem;
  }

  .qr-wrapper img {
    display: block;
    border-radius: 0.375rem;
  }

  .store-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .store-btn {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 0.875rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .store-btn:hover {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .store-text {
    display: flex;
    flex-direction: column;
  }

  .store-label {
    font-size: 0.625rem;
    color: var(--text-muted);
    line-height: 1;
  }

  .store-name {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .key-location {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding: 0.625rem 0.875rem;
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid rgba(var(--accent-rgb), 0.2);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .key-location svg {
    flex-shrink: 0;
    color: var(--accent);
  }

  .key-location strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .share-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding: 0.625rem 1rem;
    background: rgba(var(--success-rgb), 0.12);
    border: 1px solid rgba(var(--success-rgb), 0.25);
    border-radius: 0.625rem;
    color: var(--success);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
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

  @media (max-width: 480px) {
    .download-row {
      flex-direction: column;
      align-items: flex-start;
    }

    .store-buttons {
      width: 100%;
    }

    .store-btn {
      width: 100%;
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
</style>
