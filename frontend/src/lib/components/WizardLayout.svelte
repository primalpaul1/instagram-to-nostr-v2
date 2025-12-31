<script lang="ts">
  import { wizard } from '$lib/stores/wizard';

  const steps = [
    { id: 'handle', label: 'Handle' },
    { id: 'keys', label: 'Keys' },
    { id: 'videos', label: 'Videos' },
    { id: 'confirm', label: 'Confirm' },
    { id: 'progress', label: 'Progress' },
    { id: 'complete', label: 'Complete' }
  ];

  $: currentIndex = steps.findIndex(s => s.id === $wizard.step);
</script>

<div class="wizard-container">
  <header>
    <h1>Instagram to Nostr</h1>
    <p class="subtitle">Migrate your videos to the decentralized web</p>
  </header>

  <nav class="steps">
    {#each steps as step, i}
      <div
        class="step"
        class:active={i === currentIndex}
        class:completed={i < currentIndex}
        class:disabled={i > currentIndex}
      >
        <span class="step-number">{i + 1}</span>
        <span class="step-label">{step.label}</span>
      </div>
      {#if i < steps.length - 1}
        <div class="step-line" class:active={i < currentIndex}></div>
      {/if}
    {/each}
  </nav>

  <main>
    <slot />
  </main>

  {#if $wizard.error}
    <div class="error-banner">
      <span>{$wizard.error}</span>
      <button on:click={() => wizard.setError(null)}>Dismiss</button>
    </div>
  {/if}
</div>

<style>
  .wizard-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    text-align: center;
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    background: linear-gradient(135deg, var(--accent) 0%, #ec4899 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 1rem;
  }

  .steps {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 2rem;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    background: var(--bg-secondary);
    transition: all 0.2s;
  }

  .step.active {
    background: var(--accent);
    color: white;
  }

  .step.completed {
    background: var(--success);
    color: white;
  }

  .step.disabled {
    opacity: 0.5;
  }

  .step-number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .step-label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .step-line {
    width: 1.5rem;
    height: 2px;
    background: var(--border);
    transition: background 0.2s;
  }

  .step-line.active {
    background: var(--success);
  }

  main {
    background: var(--bg-secondary);
    border-radius: 1rem;
    padding: 2rem;
    border: 1px solid var(--border);
  }

  .error-banner {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--error);
    border-radius: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--error);
  }

  .error-banner button {
    background: transparent;
    border: 1px solid var(--error);
    color: var(--error);
    padding: 0.25rem 0.75rem;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  .error-banner button:hover {
    background: var(--error);
    color: white;
  }

  @media (max-width: 600px) {
    .wizard-container {
      padding: 1rem;
    }

    .step-label {
      display: none;
    }

    main {
      padding: 1rem;
    }
  }
</style>
