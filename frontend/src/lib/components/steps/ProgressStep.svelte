<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wizard } from '$lib/stores/wizard';

  interface TaskStatus {
    id: string;
    status: 'pending' | 'uploading' | 'publishing' | 'complete' | 'error';
    caption?: string;
    blossom_url?: string;
    nostr_event_id?: string;
    error?: string;
  }

  interface JobStatus {
    status: 'pending' | 'processing' | 'complete' | 'error';
    tasks: TaskStatus[];
  }

  let jobStatus: JobStatus | null = null;
  let pollInterval: ReturnType<typeof setInterval>;

  $: completedCount = jobStatus?.tasks.filter(t => t.status === 'complete').length ?? 0;
  $: totalCount = jobStatus?.tasks.length ?? 0;
  $: errorCount = jobStatus?.tasks.filter(t => t.status === 'error').length ?? 0;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  onMount(() => {
    pollStatus();
    pollInterval = setInterval(pollStatus, 2000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  async function pollStatus() {
    if (!$wizard.jobId) return;

    try {
      const response = await fetch(`/api/jobs/${$wizard.jobId}/status`);
      if (!response.ok) throw new Error('Failed to fetch status');

      jobStatus = await response.json();

      if (jobStatus?.status === 'complete' || jobStatus?.status === 'error') {
        clearInterval(pollInterval);
        wizard.setStep('complete');
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  }

  function getStatusIcon(status: TaskStatus['status']): string {
    switch (status) {
      case 'pending': return '&#9711;';
      case 'uploading': return '&#8635;';
      case 'publishing': return '&#8635;';
      case 'complete': return '&#10003;';
      case 'error': return '&#10007;';
      default: return '&#9711;';
    }
  }

  function getStatusLabel(status: TaskStatus['status']): string {
    switch (status) {
      case 'pending': return 'Waiting';
      case 'uploading': return 'Uploading';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Complete';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }
</script>

<div class="step-content">
  <h2>Migration in progress</h2>
  <p class="description">
    Please keep this page open. Your videos are being migrated to Nostr.
  </p>

  <div class="progress-container">
    <div class="progress-header">
      <span class="progress-label">
        {completedCount} of {totalCount} videos complete
      </span>
      <span class="progress-percent">{Math.round(progressPercent)}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progressPercent}%"></div>
    </div>
  </div>

  {#if jobStatus}
    <div class="tasks-list">
      {#each jobStatus.tasks as task}
        <div class="task-item" class:error={task.status === 'error'} class:complete={task.status === 'complete'}>
          <div class="task-status" class:spinning={task.status === 'uploading' || task.status === 'publishing'}>
            {@html getStatusIcon(task.status)}
          </div>
          <div class="task-info">
            <span class="task-caption">
              {task.caption?.slice(0, 40) || 'Untitled'}{(task.caption?.length ?? 0) > 40 ? '...' : ''}
            </span>
            <span class="task-label">{getStatusLabel(task.status)}</span>
          </div>
          {#if task.status === 'error' && task.error}
            <div class="task-error">{task.error}</div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading status...</p>
    </div>
  {/if}

  {#if errorCount > 0}
    <div class="error-summary">
      {errorCount} video{errorCount !== 1 ? 's' : ''} failed to migrate.
      These will be skipped.
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

  .progress-container {
    margin-bottom: 2rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .progress-label {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .progress-percent {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--accent);
  }

  .progress-bar {
    height: 0.5rem;
    background: var(--bg-tertiary);
    border-radius: 9999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #ec4899);
    border-radius: 9999px;
    transition: width 0.3s ease;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 300px;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    border: 1px solid var(--border);
  }

  .task-item.complete {
    border-color: var(--success);
    background: rgba(34, 197, 94, 0.1);
  }

  .task-item.error {
    border-color: var(--error);
    background: rgba(239, 68, 68, 0.1);
  }

  .task-status {
    font-size: 1.25rem;
    min-width: 1.5rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .task-item.complete .task-status {
    color: var(--success);
  }

  .task-item.error .task-status {
    color: var(--error);
  }

  .task-status.spinning {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }

  .task-info {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .task-caption {
    font-size: 0.875rem;
  }

  .task-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .task-error {
    font-size: 0.75rem;
    color: var(--error);
    margin-left: 2.5rem;
    margin-top: -0.5rem;
    padding-bottom: 0.5rem;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading p {
    color: var(--text-secondary);
  }

  .error-summary {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--error);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: var(--error);
    text-align: center;
  }
</style>
