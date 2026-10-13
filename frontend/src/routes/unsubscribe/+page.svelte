<script lang="ts">
  import { page } from '$app/stores';

  // Link from the welcome email: /unsubscribe?e=<email>&t=<token>
  // Asks for a click instead of unsubscribing on load, so email link scanners can't unsubscribe people.
  $: email = $page.url.searchParams.get('e') || '';
  $: token = $page.url.searchParams.get('t') || '';

  let state: 'idle' | 'submitting' | 'done' | 'error' = 'idle';

  async function unsubscribe() {
    state = 'submitting';
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token })
      });
      state = res.ok ? 'done' : 'error';
    } catch {
      state = 'error';
    }
  }
</script>

<svelte:head>
  <title>Unsubscribe</title>
  <meta name="robots" content="noindex">
</svelte:head>

<div class="unsubscribe-page">
  {#if !email || !token}
    <h1>Unsubscribe</h1>
    <p>This link is incomplete. Use the unsubscribe link from the bottom of the email.</p>
  {:else if state === 'done'}
    <h1>You're unsubscribed</h1>
    <p><strong>{email}</strong> won't get any more emails from us.</p>
  {:else}
    <h1>Unsubscribe</h1>
    <p>Stop sending emails to <strong>{email}</strong>?</p>
    <button on:click={unsubscribe} disabled={state === 'submitting'}>
      {state === 'submitting' ? '...' : 'Unsubscribe'}
    </button>
    {#if state === 'error'}
      <p class="error">That didn't work. The link may be invalid or expired.</p>
    {/if}
  {/if}
</div>

<style>
  .unsubscribe-page {
    max-width: 420px;
    margin: 18vh auto 0;
    padding: 0 1.5rem;
    color: var(--text-primary);
    text-align: center;
  }
  h1 {
    font-size: 1.5rem;
    margin-bottom: 0.75rem;
  }
  p {
    color: var(--text-secondary);
    line-height: 1.5;
    word-break: break-word;
  }
  strong {
    color: var(--text-primary);
  }
  button {
    margin-top: 1.25rem;
    padding: 0.7rem 1.6rem;
    border: none;
    border-radius: 10px;
    background: var(--accent-gradient);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--accent-gradient-hover);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    color: var(--error);
    font-size: 0.9rem;
    margin-top: 1rem;
  }
</style>
