<script lang="ts">
  import { onMount } from 'svelte';
  import { wizard } from '$lib/stores/wizard';
  import { generateKeyPair } from '$lib/nostr';

  let keyPair = $wizard.keyPair;
  let copied = { npub: false, nsec: false };
  let acknowledged = false;

  onMount(() => {
    if (!keyPair) {
      keyPair = generateKeyPair();
      wizard.setKeyPair(keyPair);
    }
  });

  async function copyToClipboard(text: string, type: 'npub' | 'nsec') {
    await navigator.clipboard.writeText(text);
    copied[type] = true;
    setTimeout(() => {
      copied[type] = false;
    }, 2000);
  }

  function handleContinue() {
    if (!acknowledged) return;
    wizard.setStep('videos');
  }

  function handleBack() {
    wizard.setStep('handle');
  }
</script>

<div class="step-content">
  <h2>Save your Nostr keys</h2>
  <p class="description">
    These keys are your identity on Nostr. Save them securely - you'll need them to access your account.
  </p>

  {#if keyPair}
    <div class="keys-container">
      <div class="key-card">
        <div class="key-header">
          <span class="key-type public">Public Key (npub)</span>
          <span class="key-info">Share this with others</span>
        </div>
        <div class="key-value">
          <code>{keyPair.npub}</code>
          <button
            class="copy-btn"
            on:click={() => copyToClipboard(keyPair.npub, 'npub')}
          >
            {copied.npub ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div class="key-card secret">
        <div class="key-header">
          <span class="key-type secret">Secret Key (nsec)</span>
          <span class="key-info warning">Never share this!</span>
        </div>
        <div class="key-value">
          <code>{keyPair.nsec}</code>
          <button
            class="copy-btn"
            on:click={() => copyToClipboard(keyPair.nsec, 'nsec')}
          >
            {copied.nsec ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>

    <div class="warning-box">
      <div class="warning-icon">&#9888;</div>
      <div class="warning-text">
        <strong>Important:</strong> Your secret key (nsec) is like a password.
        Anyone with it can post as you. Store it in a password manager or secure location.
        We do not store your keys after the migration completes.
      </div>
    </div>

    <label class="acknowledge">
      <input type="checkbox" bind:checked={acknowledged} />
      <span>I have saved my keys in a secure location</span>
    </label>

    <div class="actions">
      <button class="secondary" on:click={handleBack}>Back</button>
      <button class="primary" disabled={!acknowledged} on:click={handleContinue}>
        Continue to Video Selection
      </button>
    </div>
  {/if}
</div>

<style>
  .step-content {
    max-width: 600px;
    margin: 0 auto;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
    text-align: center;
  }

  .description {
    color: var(--text-secondary);
    margin-bottom: 2rem;
    text-align: center;
  }

  .keys-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .key-card {
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    padding: 1rem;
    border: 1px solid var(--border);
  }

  .key-card.secret {
    border-color: var(--warning);
  }

  .key-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .key-type {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .key-type.public {
    background: rgba(34, 197, 94, 0.2);
    color: var(--success);
  }

  .key-type.secret {
    background: rgba(245, 158, 11, 0.2);
    color: var(--warning);
  }

  .key-info {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .key-info.warning {
    color: var(--warning);
  }

  .key-value {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }

  code {
    flex: 1;
    background: var(--bg-primary);
    padding: 0.75rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    word-break: break-all;
    font-family: monospace;
  }

  .copy-btn {
    padding: 0.75rem 1rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 0.25rem;
    cursor: pointer;
    font-size: 0.75rem;
    white-space: nowrap;
    transition: all 0.2s;
  }

  .copy-btn:hover {
    background: var(--accent);
    border-color: var(--accent);
  }

  .warning-box {
    display: flex;
    gap: 1rem;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid var(--warning);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .warning-icon {
    font-size: 1.5rem;
    color: var(--warning);
  }

  .warning-text {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .warning-text strong {
    color: var(--warning);
  }

  .acknowledge {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    cursor: pointer;
    margin-bottom: 1.5rem;
  }

  .acknowledge input[type="checkbox"] {
    width: 1.25rem;
    height: 1.25rem;
    accent-color: var(--accent);
  }

  .acknowledge span {
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .actions button {
    padding: 0.875rem 1.5rem;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .actions .secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .actions .secondary:hover {
    border-color: var(--text-secondary);
  }

  .actions .primary {
    flex: 1;
    background: var(--accent);
    border: none;
    color: white;
  }

  .actions .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .actions .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
