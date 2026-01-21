<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools';
  import { nip19 } from 'nostr-tools';
  import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
  import {
    createMultiMediaPostEvent,
    createProfileEvent,
    createLongFormContentEvent,
    createContactListEvent,
    publishToRelays,
    importToPrimalCache,
    importSingleToPrimalCache,
    NOSTR_RELAYS,
    type MediaUpload,
    type ArticleMetadata
  } from '$lib/signing';

  type PageStep = 'loading' | 'preview' | 'publishing' | 'error';

  interface GiftPost {
    id: number;
    post_type: 'reel' | 'image' | 'carousel';
    caption: string | null;
    original_date: string | null;
    thumbnail_url: string | null;
    blossom_urls: string[];
    status: string;
  }

  interface GiftArticle {
    id: number;
    title: string;
    summary: string | null;
    content_markdown: string;
    published_at: string | null;
    link: string | null;
    image_url: string | null;
    blossom_image_url: string | null;
    hashtags: string[];
    status: string;
  }

  interface Profile {
    username: string;
    display_name?: string;
    bio?: string;
    profile_picture_url?: string;
  }

  interface Feed {
    url: string;
    title?: string;
    description?: string;
    image_url?: string;
  }

  interface Gift {
    status: string;
    gift_type: 'posts' | 'articles' | 'combined';
    handle: string;
    profile: Profile | null;
    feed: Feed | null;
    posts: GiftPost[];
    articles: GiftArticle[];
  }

  interface Keypair {
    privateKeyHex: string;
    privateKeyBytes: Uint8Array;
    publicKeyHex: string;
    nsec: string;
    npub: string;
  }

  // Featured follow packs configuration
  const FEATURED_PACKS = [
    { dTag: 'sleihevbfz2c', author: '805b34f708837dfb3e7f05815ac5760564628b58d5a0ce839ccbb6ef3620fac3' },
    { dTag: 'xv7j4mgavera', author: '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9' }
  ];

  interface FollowPackMember {
    pubkey: string;
    picture?: string;
    name?: string;
    followingStatus: 'idle' | 'following' | 'done';
  }

  interface FollowPack {
    dTag: string;
    name: string;
    members: FollowPackMember[];
    followingStatus: 'idle' | 'following' | 'done' | 'error';
    expanded: boolean;
  }

  let step: PageStep = 'loading';
  let gift: Gift | null = null;
  let error = '';

  // Key state
  let keypair: Keypair | null = null;
  let nsecCopied = false;
  let keyDownloaded = false;
  let keyEverSaved = false;  // Persistent - doesn't reset after button feedback

  // Publishing state
  interface PostTaskStatus {
    type: 'post';
    post: GiftPost;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  interface ArticleTaskStatus {
    type: 'article';
    article: GiftArticle;
    status: 'pending' | 'signing' | 'publishing' | 'complete' | 'error';
    error?: string;
  }
  type TaskStatus = PostTaskStatus | ArticleTaskStatus;
  let tasks: TaskStatus[] = [];

  $: completedCount = tasks.filter(t => t.status === 'complete').length;
  $: totalCount = tasks.length;
  $: progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  $: isArticleGift = gift?.gift_type === 'articles';
  $: isCombinedGift = gift?.gift_type === 'combined';
  $: postCount = gift?.posts?.length || 0;
  $: articleCount = gift?.articles?.length || 0;
  $: itemCount = isCombinedGift ? postCount + articleCount : (isArticleGift ? articleCount : postCount);
  $: keySaved = keyEverSaved;
  $: allTasksComplete = totalCount > 0 && completedCount === totalCount;

  // Resume state - track how many were already published
  let alreadyPublishedCount = 0;
  let isResuming = false;

  // Follow packs state
  let followPacks: FollowPack[] = [];
  let followPacksLoading = true;

  // Detect if gift has partially published items (for resume UI on preview)
  $: hasPartiallyPublished = gift ? (
    (gift.posts || []).some(p => p.status === 'published') ||
    (gift.articles || []).some(a => a.status === 'published')
  ) : false;
  $: prePublishedCount = gift ? (
    (gift.posts || []).filter(p => p.status === 'published').length +
    (gift.articles || []).filter(a => a.status === 'published').length
  ) : 0;
  $: remainingCount = gift ? (
    (gift.posts || []).filter(p => p.status !== 'published').length +
    (gift.articles || []).filter(a => a.status !== 'published').length
  ) : 0;

  function getPrimalDownloadUrl(): string {
    if (typeof navigator === 'undefined') return 'https://primal.net/downloads';
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) {
      return 'https://apps.apple.com/us/app/primal/id1673134518';
    } else if (/Android/.test(ua)) {
      return 'https://play.google.com/store/apps/details?id=net.primal.android';
    }
    return 'https://primal.net/downloads';
  }

  // Tab state for combined gifts
  let activePreviewTab: 'posts' | 'articles' = 'posts';

  const token = $page.params.token;

  // Relays to try for fetching packs
  const PACK_RELAYS = ['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol'];

  // Fetch a single follow pack from relay
  async function fetchPackFromRelay(relayUrl: string, packConfig: { dTag: string; author: string }): Promise<FollowPack | null> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(relayUrl);
        const subId = Math.random().toString(36).substring(2, 14);

        const timeout = setTimeout(() => {
          ws.close();
          resolve(null);
        }, 8000);

        ws.onopen = () => {
          const filter = {
            kinds: [39089],
            authors: [packConfig.author],
            '#d': [packConfig.dTag]
          };
          ws.send(JSON.stringify(['REQ', subId, filter]));
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data[0] === 'EVENT' && data[1] === subId) {
              const event = data[2];
              const packName = event.tags.find((t: string[]) => t[0] === 'name')?.[1]
                || event.tags.find((t: string[]) => t[0] === 'title')?.[1]
                || event.content
                || 'Follow Pack';

              const memberPubkeys = event.tags
                .filter((t: string[]) => t[0] === 'p')
                .map((t: string[]) => t[1]);

              clearTimeout(timeout);
              ws.close();
              resolve({
                dTag: packConfig.dTag,
                name: packName,
                members: memberPubkeys.map((pk: string) => ({ pubkey: pk, followingStatus: 'idle' as const })),
                followingStatus: 'idle',
                expanded: false
              });
            } else if (data[0] === 'EOSE') {
              clearTimeout(timeout);
              ws.close();
              resolve(null);
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  // Try multiple relays to fetch a pack
  async function fetchSinglePack(packConfig: { dTag: string; author: string }): Promise<FollowPack | null> {
    for (const relay of PACK_RELAYS) {
      const result = await fetchPackFromRelay(relay, packConfig);
      if (result) return result;
    }
    return null;
  }

  // Fetch follow packs from relays (kind 39089)
  async function fetchFollowPacks(): Promise<void> {
    followPacksLoading = true;

    try {
      // Fetch each pack individually to ensure we get both
      const packPromises = FEATURED_PACKS.map(config => fetchSinglePack(config));
      const results = await Promise.all(packPromises);
      const packs = results.filter((p): p is FollowPack => p !== null);

      // Fetch ALL profile pictures for pack members
      if (packs.length > 0) {
        const allPubkeys = new Set<string>();
        for (const pack of packs) {
          pack.members.forEach(m => allPubkeys.add(m.pubkey));
        }
        const profiles = await fetchPackMemberProfiles(Array.from(allPubkeys));

        // Update members with profile data
        for (const pack of packs) {
          pack.members = pack.members.map(m => ({
            ...m,
            picture: profiles.get(m.pubkey)?.picture,
            name: profiles.get(m.pubkey)?.name
          }));
        }
      }

      followPacks = packs;
    } catch (err) {
      console.error('Error fetching follow packs:', err);
    } finally {
      followPacksLoading = false;
    }
  }

  // Fetch profile metadata using Primal cache for better coverage
  async function fetchPackMemberProfiles(pubkeys: string[]): Promise<Map<string, { picture?: string; name?: string }>> {
    const profiles = new Map<string, { picture?: string; name?: string }>();

    if (pubkeys.length === 0) return profiles;

    // Use Primal cache for profiles - it has better coverage
    try {
      const ws = new WebSocket('wss://cache1.primal.net/v1');
      const subId = Math.random().toString(36).substring(2, 14);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve();
        }, 10000); // Longer timeout for many profiles

        ws.onopen = () => {
          // Use Primal's user_infos cache request for batch profile fetching
          const cacheRequest = JSON.stringify([
            'REQ',
            subId,
            { cache: ['user_infos', { pubkeys }] }
          ]);
          ws.send(cacheRequest);
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data[0] === 'EVENT' && data[1] === subId) {
              const event = data[2];
              // Kind 0 events contain profile metadata
              if (event.kind === 0) {
                try {
                  const content = JSON.parse(event.content);
                  profiles.set(event.pubkey, {
                    picture: content.picture,
                    name: content.name || content.display_name
                  });
                } catch {
                  // Skip invalid JSON content
                }
              }
            } else if (data[0] === 'EOSE') {
              clearTimeout(timeout);
              ws.close();
              resolve();
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
    } catch (err) {
      console.error('Error fetching profiles from Primal cache:', err);
    }

    // Fallback: fetch missing profiles from regular relay
    const missingPubkeys = pubkeys.filter(pk => !profiles.has(pk));
    if (missingPubkeys.length > 0) {
      try {
        const ws = new WebSocket('wss://relay.primal.net');
        const subId = Math.random().toString(36).substring(2, 14);

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            ws.close();
            resolve();
          }, 8000);

          ws.onopen = () => {
            const filter = {
              kinds: [0],
              authors: missingPubkeys
            };
            ws.send(JSON.stringify(['REQ', subId, filter]));
          };

          ws.onmessage = (msg) => {
            try {
              const data = JSON.parse(msg.data);
              if (data[0] === 'EVENT' && data[1] === subId) {
                const event = data[2];
                try {
                  const content = JSON.parse(event.content);
                  profiles.set(event.pubkey, {
                    picture: content.picture,
                    name: content.name || content.display_name
                  });
                } catch {
                  // Skip invalid JSON
                }
              } else if (data[0] === 'EOSE') {
                clearTimeout(timeout);
                ws.close();
                resolve();
              }
            } catch {
              // Ignore parse errors
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
      } catch (err) {
        console.error('Error fetching profiles from relay:', err);
      }
    }

    return profiles;
  }

  // Toggle pack expanded state
  function togglePack(packIndex: number): void {
    followPacks[packIndex] = { ...followPacks[packIndex], expanded: !followPacks[packIndex].expanded };
    followPacks = [...followPacks];
  }

  // Follow all members of a pack
  async function followAll(packIndex: number): Promise<void> {
    if (!keypair || packIndex >= followPacks.length) return;

    const pack = followPacks[packIndex];
    followPacks[packIndex] = { ...pack, followingStatus: 'following' };
    followPacks = [...followPacks];

    try {
      // Get all member pubkeys from the pack (only those not already followed)
      const contactPubkeys = pack.members
        .filter(m => m.followingStatus !== 'done')
        .map(m => m.pubkey);

      // Create kind 3 contact list event
      const contactListEvent = createContactListEvent(keypair.publicKeyHex, contactPubkeys);

      // Sign the event
      const signedEvent = finalizeEvent(contactListEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));

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
    if (!keypair || packIndex >= followPacks.length) return;

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
      const contactListEvent = createContactListEvent(keypair.publicKeyHex, [member.pubkey]);

      // Sign the event
      const signedEvent = finalizeEvent(contactListEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));

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

  // Rotating Nostr sayings
  const NOSTR_SAYINGS = [
    "Not your keys, not your content",
    "One step closer to bloom scrolling",
    "Control what you see",
    "Zap Bitcoin",
    "Sovereign social media is here",
    "Not their content anymore",
    "Bye, bye, big tech",
    "Your feed, your rules",
    "No algorithm deciding for you",
    "Own your audience forever",
    "No more shadow bans"
  ];

  let currentSayingIndex = 0;
  let sayingInterval: ReturnType<typeof setInterval>;

  onMount(async () => {
    // Start rotating sayings
    sayingInterval = setInterval(() => {
      currentSayingIndex = (currentSayingIndex + 1) % NOSTR_SAYINGS.length;
    }, 3000);

    // Fetch follow packs in background
    fetchFollowPacks();

    await loadGift();
  });

  onDestroy(() => {
    if (sayingInterval) clearInterval(sayingInterval);
  });

  function generateKeypair(): Keypair {
    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const privateKeyHex = bytesToHex(privateKeyBytes);
    const publicKeyHex = getPublicKey(privateKeyBytes);

    return {
      privateKeyHex,
      privateKeyBytes,
      publicKeyHex,
      nsec: nip19.nsecEncode(privateKeyBytes),
      npub: nip19.npubEncode(publicKeyHex)
    };
  }

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

      // Ensure arrays exist to prevent undefined errors
      gift = {
        ...data,
        posts: data.posts || [],
        articles: data.articles || []
      };
      step = 'preview';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load gift';
      step = 'error';
    }
  }

  async function claimAccount() {
    if (!gift) return;

    // Generate a random keypair
    keypair = generateKeypair();

    // Go directly to publishing
    step = 'publishing';
    await startPublishing();
  }

  function copyNsec() {
    if (!keypair) return;
    navigator.clipboard.writeText(keypair.nsec);
    nsecCopied = true;
    keyEverSaved = true;
    setTimeout(() => nsecCopied = false, 2000);
  }

  function downloadKey() {
    if (!keypair) return;
    const blob = new Blob([keypair.nsec], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'primal-key.txt';
    a.click();
    URL.revokeObjectURL(url);
    keyDownloaded = true;
    keyEverSaved = true;
  }

  async function startPublishing() {
    if (!keypair || !gift) return;

    // Filter out already-published items for resume capability
    const unpublishedPosts = (gift.posts || []).filter(p => p.status !== 'published');
    const unpublishedArticles = (gift.articles || []).filter(a => a.status !== 'published');

    // Track resume state
    const totalPosts = gift.posts?.length || 0;
    const totalArticles = gift.articles?.length || 0;
    alreadyPublishedCount = (totalPosts - unpublishedPosts.length) + (totalArticles - unpublishedArticles.length);
    isResuming = alreadyPublishedCount > 0;

    // Set up tasks based on gift type (only unpublished items)
    if (gift.gift_type === 'articles') {
      tasks = unpublishedArticles.map(article => ({ type: 'article' as const, article, status: 'pending' as const }));
    } else if (gift.gift_type === 'combined') {
      // Combined gifts: posts first, then articles
      const postTasks = unpublishedPosts.map(post => ({ type: 'post' as const, post, status: 'pending' as const }));
      const articleTasks = unpublishedArticles.map(article => ({ type: 'article' as const, article, status: 'pending' as const }));
      tasks = [...postTasks, ...articleTasks];
    } else {
      tasks = unpublishedPosts.map(post => ({ type: 'post' as const, post, status: 'pending' as const }));
    }
    step = 'publishing';

    // If all items already published, just mark as claimed and show success
    if (tasks.length === 0) {
      await fetch(`/api/gifts/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      });
      return;
    }

    const signedEvents: any[] = [];
    const publishedPostIds: number[] = [];
    const publishedArticleIds: number[] = [];
    const relayPromises: Promise<{ success: string[]; failed: string[] }>[] = [];

    try {
      // First, publish profile if available (for post or article gifts)
      if (gift.profile) {
        const profileEvent = createProfileEvent(
          keypair.publicKeyHex,
          gift.profile.display_name || gift.profile.username,
          gift.profile.bio,
          gift.profile.profile_picture_url
        );

        const signedProfile = finalizeEvent(profileEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
        // Import profile to Primal immediately, fire relay publish in background
        await importSingleToPrimalCache(signedProfile);
        relayPromises.push(publishToRelays(signedProfile, NOSTR_RELAYS));
        signedEvents.push(signedProfile);
      }

      // Process items with Primal-first approach for fast visibility
      for (let i = 0; i < tasks.length; i++) {
        tasks[i] = { ...tasks[i], status: 'signing' };
        tasks = [...tasks];

        const task = tasks[i];

        try {
          let signedEvent: any;

          if (task.type === 'article') {
            // Create long-form content event (kind 30023)
            const article = task.article;

            // Generate identifier from title (URL-safe slug)
            const identifier = article.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 50) + '-' + Date.now().toString(36);

            const articleMetadata: ArticleMetadata = {
              identifier,
              title: article.title,
              summary: article.summary || undefined,
              imageUrl: article.blossom_image_url || article.image_url || undefined,
              publishedAt: article.published_at || undefined,  // Already a Unix timestamp string
              hashtags: article.hashtags || undefined,
              content: article.content_markdown
            };

            const articleEvent = createLongFormContentEvent(
              keypair.publicKeyHex,
              articleMetadata
            );

            signedEvent = finalizeEvent(articleEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
          } else {
            // Create post event (kind 1)
            const post = task.post;
            const mediaUploads: MediaUpload[] = post.blossom_urls.map(url => ({
              url,
              sha256: url.split('/').pop() || '',
              mimeType: post.post_type === 'reel' ? 'video/mp4' : 'image/jpeg',
              size: 0,
              width: undefined,
              height: undefined
            }));

            const postEvent = createMultiMediaPostEvent(
              keypair.publicKeyHex,
              mediaUploads,
              post.caption || undefined,
              post.original_date || undefined
            );

            signedEvent = finalizeEvent(postEvent as EventTemplate, hexToBytes(keypair.privateKeyHex));
          }

          tasks[i] = { ...tasks[i], status: 'publishing' };
          tasks = [...tasks];

          // 1. Import to Primal cache immediately (await) - post visible in Primal right away
          await importSingleToPrimalCache(signedEvent);

          signedEvents.push(signedEvent);

          // 2. Checkpoint to database (await) - iOS resume safety
          if (task.type === 'article') {
            await fetch(`/api/gifts/${token}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'markArticlePublished', articleId: task.article.id })
            });
            publishedArticleIds.push(task.article.id);
          } else {
            await fetch(`/api/gifts/${token}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'markPostPublished', postId: task.post.id })
            });
            publishedPostIds.push(task.post.id);
          }

          // 3. Fire relay publishing in background (no await) - will complete while we process next item
          relayPromises.push(publishToRelays(signedEvent, NOSTR_RELAYS));

          // 4. Mark complete immediately - don't wait for relays
          tasks[i] = { ...tasks[i], status: 'complete' };
          tasks = [...tasks];

        } catch (err) {
          console.error(`Error publishing item ${i}:`, err);
          tasks[i] = {
            ...tasks[i],
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error'
          };
          tasks = [...tasks];
        }
        // No artificial delay - proceed immediately to next item
      }

      // Wait for all relay publishing to complete and log results
      const relayResults = await Promise.allSettled(relayPromises);
      const relaySuccessCount = relayResults.filter(r => r.status === 'fulfilled').length;
      console.log(`Relay sync complete: ${relaySuccessCount}/${relayPromises.length} successful`);

      // Note: Individual posts/articles are already marked as published
      // immediately after each successful relay publish (per-item checkpointing)

      // Mark gift as claimed
      await fetch(`/api/gifts/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      });
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
  <title>Claim Your Posts | Own Your Posts</title>
</svelte:head>

<div class="gift-claim-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
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

    {:else if step === 'preview' && gift}
      <div class="preview-step">
        <div class="gift-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/>
            <path d="M17 3l4 4-8 8H9v-4l8-8z"/>
          </svg>
        </div>
        <h2>Claim Your Nostr Account</h2>
        {#if isCombinedGift}
          <p class="subtitle">Your @{gift.handle} content and blog articles are ready to publish on Nostr!</p>
        {:else if isArticleGift}
          <p class="subtitle">Your articles from {gift.feed?.title || 'RSS Feed'} are ready to publish on Nostr!</p>
        {:else}
          <p class="subtitle">Your @{gift.handle} content is ready to publish on Nostr!</p>
        {/if}

        {#if gift.profile}
          <div class="profile-preview">
            {#if gift.profile.profile_picture_url}
              <img src={gift.profile.profile_picture_url} alt={gift.profile.username} class="profile-pic" />
            {:else}
              <div class="profile-pic placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            {/if}
            <div class="profile-info">
              <span class="profile-name">{gift.profile.display_name || gift.profile.username}</span>
              <span class="profile-handle">@{gift.handle}</span>
            </div>
          </div>
        {/if}

        {#if isCombinedGift}
          <!-- Combined gift: show counts for both -->
          <div class="combined-counts">
            <div class="count-item">
              <span class="count">{postCount}</span>
              <span class="label">posts</span>
            </div>
            <span class="count-separator">+</span>
            <div class="count-item">
              <span class="count">{articleCount}</span>
              <span class="label">articles</span>
            </div>
          </div>

          <!-- Tabbed preview for combined gifts -->
          <div class="preview-tabs">
            <button
              class="preview-tab"
              class:active={activePreviewTab === 'posts'}
              on:click={() => activePreviewTab = 'posts'}
            >
              Posts ({postCount})
            </button>
            <button
              class="preview-tab"
              class:active={activePreviewTab === 'articles'}
              on:click={() => activePreviewTab = 'articles'}
            >
              Articles ({articleCount})
            </button>
          </div>

          {#if activePreviewTab === 'posts'}
            <div class="posts-grid">
              {#each gift.posts.slice(0, 6) as post}
                <div class="post-thumb">
                  {#if post.thumbnail_url}
                    <img src={post.thumbnail_url} alt="" />
                  {:else if post.blossom_urls && post.blossom_urls.length > 0 && post.post_type !== 'reel'}
                    <img src={post.blossom_urls[0]} alt="" />
                  {:else}
                    <div class="placeholder">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      </svg>
                    </div>
                  {/if}
                  {#if post.post_type === 'reel'}
                    <div class="video-badge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if gift.posts.length > 6}
                <div class="post-thumb more">
                  <span>+{gift.posts.length - 6}</span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="articles-list-preview">
              {#each gift.articles.slice(0, 4) as article}
                <div class="article-preview-item">
                  {#if article.blossom_image_url || article.image_url}
                    <img src={article.blossom_image_url || article.image_url} alt="" class="article-thumb" />
                  {/if}
                  <span class="article-title-preview">{article.title}</span>
                </div>
              {/each}
              {#if gift.articles.length > 4}
                <div class="more-articles">+{gift.articles.length - 4} more</div>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="posts-preview">
            <span class="count">{itemCount}</span>
            <span class="label">{isArticleGift ? 'articles' : 'posts'} ready to publish</span>
          </div>

          {#if isArticleGift}
            <div class="articles-list-preview">
              {#each gift.articles.slice(0, 4) as article}
                <div class="article-preview-item">
                  {#if article.blossom_image_url || article.image_url}
                    <img src={article.blossom_image_url || article.image_url} alt="" class="article-thumb" />
                  {/if}
                  <span class="article-title-preview">{article.title}</span>
                </div>
              {/each}
              {#if gift.articles.length > 4}
                <div class="more-articles">+{gift.articles.length - 4} more</div>
              {/if}
            </div>
          {:else}
            <div class="posts-grid">
              {#each gift.posts.slice(0, 6) as post}
                <div class="post-thumb">
                  {#if post.thumbnail_url}
                    <img src={post.thumbnail_url} alt="" />
                  {:else if post.blossom_urls && post.blossom_urls.length > 0 && post.post_type !== 'reel'}
                    <img src={post.blossom_urls[0]} alt="" />
                  {:else}
                    <div class="placeholder">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      </svg>
                    </div>
                  {/if}
                  {#if post.post_type === 'reel'}
                    <div class="video-badge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if gift.posts.length > 6}
                <div class="post-thumb more">
                  <span>+{gift.posts.length - 6}</span>
                </div>
              {/if}
            </div>
          {/if}
        {/if}

        {#if hasPartiallyPublished}
          <div class="resume-notice">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <span>{prePublishedCount} already published, {remainingCount} remaining</span>
          </div>
        {/if}

        <button class="primary-btn" on:click={claimAccount}>
          {#if hasPartiallyPublished}
            Resume Publishing
          {:else}
            Claim My Account
          {/if}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>

    {:else if step === 'publishing'}
      <div class="publishing-step">
        <div class="progress-circle-container">
          <div class="progress-circle" class:complete={allTasksComplete}>
            <svg viewBox="0 0 36 36">
              <path
                class="progress-bg"
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                class="progress-fill-circle"
                stroke-dasharray="{progressPercent}, 100"
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div class="progress-percent">
              {#if allTasksComplete}
                <svg class="checkmark-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path class="checkmark-path" d="M20 6L9 17l-5-5"/>
                </svg>
              {:else}
                {Math.round(progressPercent)}%
              {/if}
            </div>
          </div>
          <div class="progress-label">
            {#if allTasksComplete}
              <span class="progress-title complete">All done!</span>
            {:else}
              <span class="progress-title nostr-saying">{NOSTR_SAYINGS[currentSayingIndex]}</span>
            {/if}
            <span class="progress-detail">
              {#if isResuming && completedCount === 0}
                Resuming... {alreadyPublishedCount} already done, {totalCount} remaining
              {:else}
                {completedCount + alreadyPublishedCount} of {totalCount + alreadyPublishedCount} {isCombinedGift ? 'items' : (isArticleGift ? 'articles' : 'posts')}
              {/if}
            </span>
          </div>
        </div>

        <h2 class="welcome-title" class:visible={allTasksComplete}>Welcome to Primal!</h2>

        <div class="whats-next-section">
            <h3>What's Next?</h3>

            <div class="step-card" class:highlight={!keySaved}>
              <div class="step-number">1</div>
              <div class="step-content">
                <h4>Save Your Key</h4>
                <p>This is your Primal identity - keep it safe!</p>
                <div class="key-actions">
                  <button class="action-btn" on:click={copyNsec}>
                    {#if nsecCopied}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                      Copied!
                    {:else}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                      </svg>
                      Copy Key
                    {/if}
                  </button>
                  <button class="action-btn" on:click={downloadKey}>
                    {#if keyDownloaded}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                      Downloaded!
                    {:else}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Download Key
                    {/if}
                  </button>
                </div>
              </div>
            </div>

            <div class="step-card" class:disabled={!keySaved}>
              <img src="/primal-logo.png" alt="Primal" class="primal-logo" />
              <div class="step-content">
                <h4>Get Primal App</h4>
                <p>Access your content anywhere</p>
                <a
                  href={getPrimalDownloadUrl()}
                  target="_blank"
                  rel="noopener"
                  class="get-primal-btn"
                  class:disabled={!keySaved}
                  aria-disabled={!keySaved}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Get Primal
                </a>
                {#if !keySaved}
                  <p class="save-key-hint">Save your key first to continue</p>
                {/if}
              </div>
            </div>

            <div class="step-card" class:disabled={!keySaved}>
              <div class="step-number">3</div>
              <div class="step-content">
                <h4>Log in with your key</h4>
                <p>Open Primal, tap "Login", then "Use login key" and paste your key</p>
              </div>
            </div>
        </div>

        <!-- Follow Packs Section -->
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

  .preview-step {
    text-align: center;
  }

  .gift-icon {
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

  .profile-preview {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .profile-pic {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .profile-pic.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-muted);
  }

  .profile-info {
    text-align: left;
  }

  .profile-name {
    display: block;
    font-weight: 600;
    color: var(--text-primary);
  }

  .profile-handle {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .posts-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .post-thumb {
    aspect-ratio: 1;
    border-radius: 0.5rem;
    overflow: hidden;
    position: relative;
    background: var(--bg-tertiary);
  }

  .post-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .post-thumb .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .post-thumb .video-badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 1.25rem;
    height: 1.25rem;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .post-thumb.more {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 0.875rem;
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

  .resume-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 0.75rem;
    color: #22c55e;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .resume-notice svg {
    animation: spin 2s linear infinite;
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

  /* Publishing step */
  .publishing-step {
    text-align: center;
  }

  .progress-circle-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 1rem;
    border: 1px solid var(--border);
  }

  .progress-circle {
    position: relative;
    width: 60px;
    height: 60px;
    flex-shrink: 0;
  }

  .progress-circle svg {
    transform: rotate(-90deg);
    width: 100%;
    height: 100%;
  }

  .progress-bg {
    fill: none;
    stroke: var(--bg-primary);
    stroke-width: 3;
  }

  .progress-fill-circle {
    fill: none;
    stroke: url(#progressGradient);
    stroke: #a855f7;
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.5s ease;
  }

  .progress-circle.complete .progress-fill-circle {
    stroke: #22c55e;
  }

  .progress-circle.complete {
    animation: circle-complete 0.5s ease-out;
  }

  @keyframes circle-complete {
    0% {
      transform: scale(1);
    }
    30% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
    }
  }

  .progress-percent {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .progress-circle.complete .progress-percent {
    color: #22c55e;
  }

  .checkmark-icon {
    animation: checkmark-pop 0.4s ease-out;
  }

  .checkmark-path {
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: checkmark-draw 0.4s ease-out 0.1s forwards;
  }

  @keyframes checkmark-pop {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    50% {
      transform: scale(1.2);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  @keyframes checkmark-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .progress-label {
    display: flex;
    flex-direction: column;
    text-align: left;
    min-width: 200px;
    flex: 1;
  }

  .progress-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .progress-title.nostr-saying {
    font-weight: 500;
    transition: opacity 0.3s ease;
  }

  .progress-title.complete {
    color: #22c55e;
  }

  .progress-detail {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .welcome-title {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.5s ease;
    height: 0;
    overflow: hidden;
  }

  .welcome-title.visible {
    opacity: 1;
    transform: translateY(0);
    height: auto;
    margin-bottom: 1.5rem;
  }

  .whats-next-section {
    text-align: left;
  }

  .whats-next-section h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-primary);
  }

  .get-primal-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .get-primal-btn:hover:not(.disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
  }

  .get-primal-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  .save-key-hint {
    font-size: 0.75rem;
    color: #f59e0b;
    margin-top: 0.5rem;
    margin-bottom: 0;
  }

  /* Legacy styles kept for other pages */
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

  /* Step cards (used in publishing step) */
  .step-card {
    display: flex;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
    transition: all 0.2s ease;
  }

  .step-card.highlight {
    border-color: #a855f7;
    background: rgba(168, 85, 247, 0.08);
  }

  .step-card.disabled {
    opacity: 0.5;
  }

  .step-number {
    width: 2rem;
    height: 2rem;
    background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.875rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .primal-logo {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: 50%;
  }

  .step-content {
    flex: 1;
  }

  .step-content h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }

  .step-content p {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .key-actions {
    display: flex;
    gap: 0.5rem;
  }

  .key-actions .action-btn {
    flex: 1;
    justify-content: center;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    border-color: #a855f7;
    color: #a855f7;
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  /* Article preview styles */
  .articles-list-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .article-preview-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
  }

  .article-thumb {
    width: 3rem;
    height: 2.25rem;
    object-fit: cover;
    border-radius: 0.375rem;
    flex-shrink: 0;
  }

  .article-title-preview {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more-articles {
    text-align: center;
    padding: 0.5rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .article-placeholder {
    background: rgba(168, 85, 247, 0.1);
    color: #a855f7;
  }

  /* Combined gift styles */
  .combined-counts {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .count-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .count-item .count {
    font-size: 1.75rem;
    font-weight: 700;
    color: #a855f7;
  }

  .count-item .label {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .count-separator {
    font-size: 1.5rem;
    font-weight: 300;
    color: var(--text-muted);
  }

  .preview-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.25rem;
    background: var(--bg-tertiary);
    border-radius: 0.75rem;
  }

  .preview-tab {
    flex: 1;
    padding: 0.625rem 1rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .preview-tab:hover {
    color: var(--text-primary);
  }

  .preview-tab.active {
    background: var(--bg-secondary);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  /* Follow Packs Section */
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
</style>
