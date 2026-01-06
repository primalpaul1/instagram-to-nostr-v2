<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { finalizeEvent, type EventTemplate } from 'nostr-tools';
  import { hexToBytes } from '@noble/hashes/utils';
  import {
    deriveKeypair,
    validatePassword,
    type DerivedKeypair
  } from '$lib/keyDerivation';
  import {
    createMultiMediaPostEvent,
    createProfileEvent,
    publishToRelays,
    importToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload
  } from '$lib/signing';

  type PageStep = 'loading' | 'password' | 'show_keys' | 'publishing' | 'complete' | 'error';

  interface GiftPost {
    id: number;
    post_type: 'reel' | 'image' | 'carousel';
    caption: string | null;
    original_date: string | null;
    thumbnail_url: string | null;
    blossom_urls: string[];
    status: string;
  }

  interface Profile {
    username: string;
    display_name?: string;
    bio?: string;
    profile_picture_url?: string;
  }

  interface Gift {
    status: string;
    handle: string;
    salt: string;
    profile: Profile | null;
    posts: GiftPost[];
  }

  let step: PageStep = 'loading';
  let gift: Gift | null = null;
  let error = '';

  // Password state
  let password = '';
  let confirmPassword = '';
  let passwordValidation = { valid: false, message: '', strength: 'weak' as 'weak' | 'medium' | 'strong' };
  let showPassword = false;
  let showConfirmPassword = false;

  // Key state
  let keypair: DerivedKeypair | null = null;
  let keySaved = false;
  let nsecCopied = false;

  // Publishing state
  interface TaskStatus {
    post: GiftPost;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  let tasks: TaskStatus[] = [];

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  $: passwordValidation = validatePassword(password);
  $: passwordsMatch = password === confirmPassword && password.length > 0;
  $: canCreateAccount = passwordValidation.valid && passwordsMatch;

  const token = $page.params.token;

  onMount(async () => {
    await loadGift();
  });

  async function loadGift() {
    try {
      const response = await fetch(`/api/gifts/${token}`);

      if (response.status === 404) {
        error = 'This gift was not found.';
        step = 'error';
        return;
      }

      if (response.status === 410) {
        error = 'This gift has expired.';
        step = 'error';
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load gift');
      }

      const data = await response.json();

      if (data.status === 'claimed') {
        error = 'This gift has already been claimed.';
        step = 'error';
        return;
      }

      if (data.status === 'pending' || data.status === 'processing') {
        error = 'This gift is still being prepared. Please check back in a few minutes.';
        step = 'error';
        return;
      }

      gift = data;
      step = 'password';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load gift';
      step = 'error';
    }
  }

  function createAccount() {
    if (!canCreateAccount || !gift) return;

    // Derive keypair from password + handle + salt
    keypair = deriveKeypair(password, gift.handle, gift.salt);

    // Clear password from memory
    password = '';
    confirmPassword = '';

    step = 'show_keys';
  }

  function copyNsec() {
    if (!keypair) return;
    navigator.clipboard.writeText(keypair.nsec);
    nsecCopied = true;
    setTimeout(() => nsecCopied = false, 2000);
  }

  async function startPublishing() {
    if (!keypair || !gift) return;

    // Set up tasks
    tasks = gift.posts.map(post => ({ post, status: 'pending' }));
    step = 'publishing';

    const signedEvents: any[] = [];
    const publishedPostIds: number[] = [];

    try {
      // First, publish profile if available
      if (gift.profile) {
        const profileEvent = createProfileEvent(
          keypair.publicKeyHex,
          gift.profile.display_name || gift.profile.username,
          gift.profile.bio,
          gift.profile.profile_picture_url
        );

        const signedProfile = finalizeEvent(profileEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
        await publishToRelays(signedProfile, NOSTR_RELAYS);
        signedEvents.push(signedProfile);
      }

      // Process posts sequentially
      for (let i = 0; i < tasks.length; i++) {
        tasks[i] = { ...tasks[i], status: 'signing' };
        tasks = [...tasks];

        const task = tasks[i];

        try {
          // Build media uploads from blossom URLs
          const mediaUploads: MediaUpload[] = task.post.blossom_urls.map(url => ({
            url,
            sha256: url.split('/').pop() || '',
            mimeType: task.post.post_type === 'reel' ? 'video/mp4' : 'image/jpeg',
            size: 0,
            width: undefined,
            height: undefined
          }));

          // Create post event
          const postEvent = createMultiMediaPostEvent(
            keypair.publicKeyHex,
            mediaUploads,
            task.post.caption || undefined,
            task.post.original_date || undefined
          );

          // Sign locally with derived key
          const signedPost = finalizeEvent(postEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));

          tasks[i] = { ...tasks[i], status: 'publishing' };
          tasks = [...tasks];

          // Publish to relays
          const publishResult = await publishToRelays(signedPost, NOSTR_RELAYS);

          if (publishResult.success.length === 0) {
            throw new Error('Failed to publish to any relay');
          }

          signedEvents.push(signedPost);
          publishedPostIds.push(task.post.id);

          tasks[i] = { ...tasks[i], status: 'complete' };
          tasks = [...tasks];

        } catch (err) {
          console.error(`Error publishing post ${i}:`, err);
          tasks[i] = {
            ...tasks[i],
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error'
          };
          tasks = [...tasks];
        }

        // Small delay between posts
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Batch import to Primal cache
      if (signedEvents.length > 0) {
        importToPrimalCache(signedEvents).catch(() => {});
      }

      // Mark posts as published
      if (publishedPostIds.length > 0) {
        await fetch(`/api/gifts/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'markPostsPublished',
            postIds: publishedPostIds
          })
        });
      }

      // Mark gift as claimed
      await fetch(`/api/gifts/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      });

      step = 'complete';
    } catch (err) {
      console.error('Publishing error:', err);
      error = err instanceof Error ? err.message : 'Failed to publish';
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return 'Waiting';
      case 'signing': return 'Signing';
      case 'publishing': return 'Publishing';
      case 'complete': return 'Done';
      case 'error': return 'Failed';
      default: return 'Unknown';
    }
  }

  function getMediaPreviewUrl(post: GiftPost): string | null {
    if (post.thumbnail_url) {
      return post.thumbnail_url;
    }
    if (post.post_type !== 'reel' && post.blossom_urls && post.blossom_urls.length > 0) {
      return post.blossom_urls[0];
    }
    return null;
  }
</script>

<svelte:head>
  <title>Claim Your Gift | Insta to Primal</title>
</svelte:head>

<div class="gift-claim-page">
  <header>
    <a href="/" class="logo">Insta to Primal</a>
  </header>

  <main>
    {#if step === 'loading'}
      <div class="loading-step">
        <div class="spinner-large"></div>
        <p>Loading your gift...</p>
      </div>

    {:else if step === 'error'}
      <div class="error-step">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h2>Unable to Load</h2>
        <p class="error-msg">{error}</p>
        <a href="/" class="secondary-btn">Go to Homepage</a>
      </div>

    {:else if step === 'password' && gift}
      <div class="password-step">
        <div class="gift-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/>
            <path d="M17 3l4 4-8 8H9v-4l8-8z"/>
          </svg>
        </div>
        <h2>Claim Your Nostr Account</h2>
        <p class="subtitle">Your @{gift.handle} content is ready! Create a password to set up your account.</p>

        <div class="posts-preview">
          <span class="count">{gift.posts.length}</span>
          <span class="label">posts ready to publish</span>
        </div>

        <form on:submit|preventDefault={createAccount}>
          <div class="input-group">
            <label for="password">Choose a Password</label>
            <div class="password-input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                placeholder="Enter a strong password"
                autocomplete="new-password"
              />
              <button type="button" class="toggle-password" on:click={() => showPassword = !showPassword}>
                {#if showPassword}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                {/if}
              </button>
            </div>
            <div class="strength-indicator" class:weak={passwordValidation.strength === 'weak'} class:medium={passwordValidation.strength === 'medium'} class:strong={passwordValidation.strength === 'strong'}>
              <div class="bar"></div>
              <span class="message">{passwordValidation.message}</span>
            </div>
          </div>

          <div class="input-group">
            <label for="confirm-password">Confirm Password</label>
            <div class="password-input-wrapper">
              <input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                bind:value={confirmPassword}
                placeholder="Re-enter your password"
                autocomplete="new-password"
              />
              <button type="button" class="toggle-password" on:click={() => showConfirmPassword = !showConfirmPassword}>
                {#if showConfirmPassword}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                {/if}
              </button>
            </div>
            {#if confirmPassword && !passwordsMatch}
              <span class="input-hint error">Passwords do not match</span>
            {:else if passwordsMatch}
              <span class="input-hint success">Passwords match</span>
            {/if}
          </div>

          <div class="info-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <p>This password creates your Nostr private key. Choose something strong - you can't reset it!</p>
          </div>

          <button type="submit" class="primary-btn" disabled={!canCreateAccount}>
            Create My Account
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>
      </div>

    {:else if step === 'show_keys' && keypair}
      <div class="keys-step">
        <div class="key-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
        </div>
        <h2>Save Your Private Key!</h2>
        <p class="subtitle">This is your Nostr identity. Write it down and keep it safe - you'll need it to log in.</p>

        <div class="key-card warning">
          <div class="key-header">
            <span class="key-label">Your Private Key (nsec)</span>
            <button class="copy-btn small" on:click={copyNsec}>
              {#if nsecCopied}
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
          <code class="key-value nsec">{keypair.nsec}</code>
          <div class="warning-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Never share this key. Anyone with it can control your account.
          </div>
        </div>

        <div class="key-card">
          <span class="key-label">Your Public Key (npub)</span>
          <code class="key-value">{keypair.npub}</code>
        </div>

        <label class="checkbox-label">
          <input type="checkbox" bind:checked={keySaved} />
          <span>I've saved my private key somewhere safe</span>
        </label>

        <button class="primary-btn" disabled={!keySaved} on:click={startPublishing}>
          Continue to Publishing
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <h2>Publishing Your Content</h2>
        <p class="subtitle">Signing and publishing to Nostr...</p>

        <div class="progress-bar">
          <div class="progress-fill" style="width: {progressPercent}%"></div>
        </div>
        <p class="progress-text">{completedCount} of {totalCount} posts</p>

        <div class="tasks-list">
          {#each tasks as task, index}
            <div class="task-item" class:active={task.status === 'signing' || task.status === 'publishing'} class:complete={task.status === 'complete'} class:error={task.status === 'error'}>
              <div class="task-preview">
                {#if getMediaPreviewUrl(task.post)}
                  <img src={getMediaPreviewUrl(task.post)} alt="" />
                {:else}
                  <div class="placeholder">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    </svg>
                  </div>
                {/if}
              </div>
              <div class="task-info">
                <span class="task-caption">{task.post.caption?.slice(0, 30) || 'No caption'}{(task.post.caption?.length || 0) > 30 ? '...' : ''}</span>
                <span class="task-status">{getStatusLabel(task.status)}</span>
              </div>
              <div class="task-indicator">
                {#if task.status === 'signing' || task.status === 'publishing'}
                  <div class="spinner-small"></div>
                {:else if task.status === 'complete'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                {:else if task.status === 'error'}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                {:else}
                  <div class="pending-dot"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

    {:else if step === 'complete' && keypair}
      <div class="complete-step">
        <div class="success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2>Welcome to Nostr!</h2>
        <p class="subtitle">Your account has been created and {completedCount} posts published.</p>

        <div class="cta-cards">
          <a href="https://primal.net/p/{keypair.npub}" target="_blank" rel="noopener" class="cta-card primary">
            <div class="cta-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </div>
            <div class="cta-content">
              <span class="cta-title">View Your Profile</span>
              <span class="cta-subtitle">See your posts on Primal</span>
            </div>
          </a>

          <div class="cta-card">
            <div class="cta-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
            </div>
            <div class="cta-content">
              <span class="cta-title">Remember Your Key</span>
              <span class="cta-subtitle">Use your nsec to log in to any Nostr app</span>
            </div>
          </div>
        </div>

        <div class="key-reminder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Your private key: <code>{keypair.nsec.slice(0, 20)}...</code></span>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .gift-claim-page {
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
    max-width: 480px;
    margin: 0 auto;
    padding: 2rem;
  }

  .loading-step {
    text-align: center;
    padding: 4rem 0;
  }

  .spinner-large {
    width: 3rem;
    height: 3rem;
    border: 3px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1.5rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-step {
    text-align: center;
    padding: 3rem 0;
  }

  .error-icon {
    width: 5rem;
    height: 5rem;
    background: rgba(239, 68, 68, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ef4444;
    margin: 0 auto 1.5rem;
  }

  .error-msg {
    color: var(--text-secondary);
    margin-bottom: 2rem;
  }

  .password-step, .keys-step {
    text-align: center;
  }

  .gift-icon, .key-icon {
    width: 4rem;
    height: 4rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: 2rem;
    line-height: 1.5;
  }

  .posts-preview {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
  }

  .posts-preview .count {
    font-size: 2rem;
    font-weight: 700;
    color: #a855f7;
  }

  .posts-preview .label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    text-align: left;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-group label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .password-input-wrapper {
    display: flex;
    align-items: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .password-input-wrapper:focus-within {
    border-color: #a855f7;
  }

  .password-input-wrapper input {
    flex: 1;
    padding: 0.875rem 1rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 1rem;
    outline: none;
  }

  .toggle-password {
    padding: 0.875rem;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
  }

  .toggle-password:hover {
    color: var(--text-secondary);
  }

  .strength-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .strength-indicator .bar {
    height: 4px;
    width: 60px;
    background: var(--border);
    border-radius: 2px;
    transition: background 0.2s;
  }

  .strength-indicator.weak .bar {
    background: linear-gradient(90deg, #ef4444 0%, #ef4444 33%, var(--border) 33%);
  }

  .strength-indicator.medium .bar {
    background: linear-gradient(90deg, #f59e0b 0%, #f59e0b 66%, var(--border) 66%);
  }

  .strength-indicator.strong .bar {
    background: #22c55e;
  }

  .strength-indicator .message {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .input-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .input-hint.error {
    color: #ef4444;
  }

  .input-hint.success {
    color: #22c55e;
  }

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(147, 51, 234, 0.1);
    border: 1px solid rgba(147, 51, 234, 0.2);
    border-radius: 0.75rem;
    text-align: left;
  }

  .info-box svg {
    color: #a855f7;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .info-box p {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .primary-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(168, 85, 247, 0.4);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary-btn {
    padding: 0.75rem 1.25rem;
    background: transparent;
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .secondary-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  /* Keys step */
  .key-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    padding: 1rem;
    margin-bottom: 1rem;
    text-align: left;
  }

  .key-card.warning {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
  }

  .key-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .key-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .key-value {
    display: block;
    font-size: 0.8125rem;
    font-family: 'SF Mono', Monaco, monospace;
    color: var(--text-primary);
    word-break: break-all;
    line-height: 1.5;
  }

  .key-value.nsec {
    color: #f59e0b;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0.625rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .copy-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  .warning-text {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(245, 158, 11, 0.3);
    font-size: 0.75rem;
    color: #f59e0b;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    cursor: pointer;
    margin-bottom: 1rem;
  }

  .checkbox-label input {
    width: 1.25rem;
    height: 1.25rem;
    accent-color: #a855f7;
  }

  .checkbox-label span {
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  /* Publishing step */
  .publishing-step {
    text-align: center;
  }

  .progress-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a855f7 0%, #8b5cf6 100%);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    transition: all 0.2s;
  }

  .task-item.active {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.05);
  }

  .task-item.complete {
    opacity: 0.7;
  }

  .task-item.error {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.05);
  }

  .task-preview {
    width: 3rem;
    height: 3rem;
    border-radius: 0.5rem;
    overflow: hidden;
    flex-shrink: 0;
  }

  .task-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .task-preview .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-muted);
  }

  .task-info {
    flex: 1;
    text-align: left;
    overflow: hidden;
  }

  .task-caption {
    display: block;
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-status {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .task-indicator {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .spinner-small {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .pending-dot {
    width: 0.5rem;
    height: 0.5rem;
    background: var(--border);
    border-radius: 50%;
  }

  .task-indicator svg {
    color: #22c55e;
  }

  .task-item.error .task-indicator svg {
    color: #ef4444;
  }

  /* Complete step */
  .complete-step {
    text-align: center;
  }

  .success-icon {
    width: 5rem;
    height: 5rem;
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto 1.5rem;
  }

  .cta-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .cta-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    text-decoration: none;
    color: inherit;
    transition: all 0.2s;
  }

  .cta-card.primary {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
    border-color: rgba(168, 85, 247, 0.3);
  }

  .cta-card:hover {
    border-color: #a855f7;
  }

  .cta-icon {
    width: 2.5rem;
    height: 2.5rem;
    background: var(--bg-secondary);
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a855f7;
    flex-shrink: 0;
  }

  .cta-content {
    text-align: left;
  }

  .cta-title {
    display: block;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .cta-subtitle {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .key-reminder {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(147, 51, 234, 0.1);
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .key-reminder svg {
    color: #a855f7;
  }

  .key-reminder code {
    font-family: 'SF Mono', Monaco, monospace;
    color: #a855f7;
  }
</style>
