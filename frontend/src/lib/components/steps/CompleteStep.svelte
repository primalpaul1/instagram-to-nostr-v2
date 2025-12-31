<script lang="ts">
  import { wizard } from '$lib/stores/wizard';

  $: primalUrl = $wizard.keyPair
    ? `https://primal.net/p/${$wizard.keyPair.npub}`
    : 'https://primal.net';

  function handleStartOver() {
    wizard.reset();
  }
</script>

<div class="step-content">
  <div class="success-icon">&#10003;</div>

  <h2>Migration complete!</h2>
  <p class="description">
    Your Instagram videos have been successfully migrated to Nostr.
  </p>

  <div class="summary-card">
    <div class="summary-header">Your Nostr Profile</div>
    <div class="npub">
      <span class="label">Public Key</span>
      <code>{$wizard.keyPair?.npub}</code>
    </div>
  </div>

  <div class="cta-section">
    <p class="cta-text">
      View your new posts on Primal, a Nostr client:
    </p>
    <a href={primalUrl} target="_blank" rel="noopener noreferrer" class="primal-btn">
      <span class="primal-logo">&#9670;</span>
      Open in Primal
    </a>
  </div>

  <div class="info-box">
    <h3>What's next?</h3>
    <ul>
      <li>
        <strong>Save your keys:</strong> Make sure you've stored your secret key (nsec) securely.
        You'll need it to log into any Nostr client.
      </li>
      <li>
        <strong>Explore Nostr:</strong> Try other Nostr clients like
        <a href="https://damus.io" target="_blank" rel="noopener">Damus</a>,
        <a href="https://snort.social" target="_blank" rel="noopener">Snort</a>, or
        <a href="https://nostrudel.ninja" target="_blank" rel="noopener">noStrudel</a>.
      </li>
      <li>
        <strong>Follow others:</strong> Search for friends and interesting people to follow
        on the decentralized social network.
      </li>
    </ul>
  </div>

  <div class="actions">
    <button class="secondary" on:click={handleStartOver}>
      Migrate Another Account
    </button>
  </div>
</div>

<style>
  .step-content {
    max-width: 600px;
    margin: 0 auto;
    text-align: center;
  }

  .success-icon {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, var(--success) 0%, #16a34a 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: white;
    margin: 0 auto 1.5rem;
  }

  h2 {
    font-size: 1.75rem;
    margin-bottom: 0.5rem;
  }

  .description {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  .summary-card {
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-bottom: 2rem;
    text-align: left;
  }

  .summary-header {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .npub {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .npub .label {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .npub code {
    font-family: monospace;
    font-size: 0.75rem;
    background: var(--bg-primary);
    padding: 0.75rem;
    border-radius: 0.25rem;
    word-break: break-all;
  }

  .cta-section {
    margin-bottom: 2rem;
  }

  .cta-text {
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }

  .primal-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 2rem;
    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
    color: white;
    text-decoration: none;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 1.125rem;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .primal-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
  }

  .primal-logo {
    font-size: 1.25rem;
  }

  .info-box {
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-bottom: 2rem;
    text-align: left;
  }

  .info-box h3 {
    font-size: 1rem;
    margin-bottom: 1rem;
  }

  .info-box ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .info-box li {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .info-box li:last-child {
    border-bottom: none;
  }

  .info-box strong {
    color: var(--text-primary);
  }

  .info-box a {
    color: var(--accent);
    text-decoration: none;
  }

  .info-box a:hover {
    text-decoration: underline;
  }

  .actions {
    display: flex;
    justify-content: center;
  }

  .actions button {
    padding: 0.875rem 1.5rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .actions button:hover {
    border-color: var(--text-secondary);
  }
</style>
