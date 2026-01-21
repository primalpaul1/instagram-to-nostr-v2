<script lang="ts">
  import { finalizeEvent, type EventTemplate } from 'nostr-tools';
  import { hexToBytes } from '@noble/hashes/utils';
  import {
    createContactListEvent,
    publishToRelays,
    importSingleToPrimalCache,
    NOSTR_RELAYS
  } from '$lib/signing';
  import { CACHED_FOLLOW_PACKS, type CachedFollowPack, type CachedPackMember } from '$lib/data/followPacks';

  // Props
  export let publicKeyHex: string;
  export let privateKeyHex: string;
  export let keySaved: boolean;

  interface FollowPackMember extends CachedPackMember {
    followingStatus: 'idle' | 'following' | 'done';
  }

  interface FollowPack {
    dTag: string;
    name: string;
    members: FollowPackMember[];
    followingStatus: 'idle' | 'following' | 'done' | 'error';
    expanded: boolean;
  }

  // Initialize packs from cached data (instant - no relay fetch)
  let followPacks: FollowPack[] = CACHED_FOLLOW_PACKS.map(pack => ({
    dTag: pack.dTag,
    name: pack.name,
    members: pack.members.map(m => ({
      ...m,
      followingStatus: 'idle' as const
    })),
    followingStatus: 'idle',
    expanded: false
  }));

  // Toggle pack expanded state
  function togglePack(packIndex: number): void {
    followPacks[packIndex] = { ...followPacks[packIndex], expanded: !followPacks[packIndex].expanded };
    followPacks = [...followPacks];
  }

  // Follow all members of a pack
  async function followAll(packIndex: number): Promise<void> {
    if (!publicKeyHex || !privateKeyHex || packIndex >= followPacks.length) return;

    const pack = followPacks[packIndex];
    followPacks[packIndex] = { ...pack, followingStatus: 'following' };
    followPacks = [...followPacks];

    try {
      // Get all member pubkeys from the pack (only those not already followed)
      const contactPubkeys = pack.members
        .filter(m => m.followingStatus !== 'done')
        .map(m => m.pubkey);

      // Create kind 3 contact list event
      const contactListEvent = createContactListEvent(publicKeyHex, contactPubkeys);

      // Sign the event
      const signedEvent = finalizeEvent(contactListEvent as EventTemplate, hexToBytes(privateKeyHex));

      // Publish to relays
      await importSingleToPrimalCache(signedEvent);
      await publishToRelays(signedEvent, NOSTR_RELAYS);

      // Mark all members as followed
      followPacks[packIndex] = {
        ...pack,
        followingStatus: 'done',
        members: pack.members.map(m => ({ ...m, followingStatus: 'done' as const }))
      };
      followPacks = [...followPacks];
    } catch (err) {
      console.error('Error following pack:', err);
      followPacks[packIndex] = { ...pack, followingStatus: 'error' };
      followPacks = [...followPacks];
    }
  }

  // Follow a single member
  async function followMember(packIndex: number, memberIndex: number): Promise<void> {
    if (!publicKeyHex || !privateKeyHex || packIndex >= followPacks.length) return;

    const pack = followPacks[packIndex];
    if (memberIndex >= pack.members.length) return;

    const member = pack.members[memberIndex];
    if (member.followingStatus === 'done') return;

    // Update member status to following
    pack.members[memberIndex] = { ...member, followingStatus: 'following' };
    followPacks[packIndex] = { ...pack };
    followPacks = [...followPacks];

    try {
      // Create kind 3 contact list event for single member
      const contactListEvent = createContactListEvent(publicKeyHex, [member.pubkey]);

      // Sign the event
      const signedEvent = finalizeEvent(contactListEvent as EventTemplate, hexToBytes(privateKeyHex));

      // Publish to relays
      await importSingleToPrimalCache(signedEvent);
      await publishToRelays(signedEvent, NOSTR_RELAYS);

      // Mark member as followed
      pack.members[memberIndex] = { ...member, followingStatus: 'done' };
      followPacks[packIndex] = { ...pack };
      followPacks = [...followPacks];
    } catch (err) {
      console.error('Error following member:', err);
      pack.members[memberIndex] = { ...member, followingStatus: 'idle' };
      followPacks[packIndex] = { ...pack };
      followPacks = [...followPacks];
    }
  }
</script>

{#if followPacks.length > 0}
  <div class="follow-packs-section">
    <h3>Find People to Follow</h3>

    {#each followPacks as pack, i}
      <div class="follow-pack-card" class:expanded={pack.expanded}>
        <!-- Collapsed view - clickable header -->
        <button class="pack-header-btn" on:click={() => togglePack(i)}>
          <div class="pack-header-left">
            <span class="pack-name">{pack.name}</span>
            <span class="pack-count">{pack.members.length} people</span>
          </div>
          <div class="pack-header-right">
            <div class="pack-avatars-preview">
              {#each pack.members.slice(0, 4) as member}
                <div class="mini-avatar">
                  {#if member.picture}
                    <img src={member.picture} alt="" />
                  {:else}
                    <div class="avatar-placeholder-mini"></div>
                  {/if}
                </div>
              {/each}
            </div>
            <svg class="chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </button>

        <!-- Expanded view - all members -->
        {#if pack.expanded}
          <div class="pack-expanded-content">
            <div class="members-list">
              {#each pack.members as member, j}
                <div class="member-row">
                  <div class="member-avatar-large">
                    {#if member.picture}
                      <img src={member.picture} alt="" />
                    {:else}
                      <div class="avatar-placeholder">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      </div>
                    {/if}
                  </div>
                  <span class="member-name">{member.name || member.pubkey.slice(0, 12) + '...'}</span>
                  <button
                    class="follow-member-btn"
                    class:done={member.followingStatus === 'done'}
                    class:following={member.followingStatus === 'following'}
                    disabled={member.followingStatus === 'following' || member.followingStatus === 'done' || !keySaved}
                    on:click={() => followMember(i, j)}
                  >
                    {#if member.followingStatus === 'done'}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    {:else if member.followingStatus === 'following'}
                      <div class="btn-spinner-small"></div>
                    {:else}
                      Follow
                    {/if}
                  </button>
                </div>
              {/each}
            </div>

            <button
              class="follow-all-btn"
              class:done={pack.followingStatus === 'done'}
              class:following={pack.followingStatus === 'following'}
              disabled={pack.followingStatus === 'following' || pack.followingStatus === 'done' || !keySaved}
              on:click={() => followAll(i)}
            >
              {#if pack.followingStatus === 'done'}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                Following All
              {:else if pack.followingStatus === 'following'}
                <div class="btn-spinner"></div>
                Following...
              {:else}
                Follow All ({pack.members.length})
              {/if}
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .follow-packs-section {
    margin-top: 2rem;
    text-align: left;
  }

  .follow-packs-section h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-primary);
  }

  .follow-pack-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .follow-pack-card.expanded {
    border-color: #a855f7;
  }

  .pack-header-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .pack-header-left {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .pack-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .pack-count {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .pack-header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .pack-avatars-preview {
    display: flex;
    align-items: center;
  }

  .mini-avatar {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-secondary);
    border: 2px solid var(--bg-tertiary);
    margin-left: -0.5rem;
  }

  .mini-avatar:first-child {
    margin-left: 0;
  }

  .mini-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-placeholder-mini {
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
  }

  .follow-pack-card.expanded .chevron {
    transform: rotate(180deg);
  }

  .pack-expanded-content {
    padding: 0 1rem 1rem;
    border-top: 1px solid var(--border);
  }

  .members-list {
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 1rem;
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0;
    border-bottom: 1px solid var(--border);
  }

  .member-row:last-child {
    border-bottom: none;
  }

  .member-avatar-large {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .member-avatar-large img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .member-name {
    flex: 1;
    font-size: 0.875rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .follow-member-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 1rem;
    color: var(--text-primary);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 4rem;
  }

  .follow-member-btn:hover:not(:disabled) {
    border-color: #a855f7;
    color: #a855f7;
  }

  .follow-member-btn:disabled {
    cursor: not-allowed;
  }

  .follow-member-btn.done {
    background: #22c55e;
    border-color: #22c55e;
    color: white;
  }

  .follow-member-btn.following {
    border-color: var(--border);
  }

  .btn-spinner-small {
    width: 0.75rem;
    height: 0.75rem;
    border: 2px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .follow-all-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    width: 100%;
    padding: 0.625rem 1rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .follow-all-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
  }

  .follow-all-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .follow-all-btn.done {
    background: #22c55e;
  }

  .follow-all-btn.following {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .btn-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--border);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
