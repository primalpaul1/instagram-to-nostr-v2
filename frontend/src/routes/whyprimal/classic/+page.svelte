<script lang="ts">
  import { onMount } from 'svelte';

  let isMobile = false;
  let activeMeme = 0;
  let activeQuote = 0;
  let activeVideo = 0;
  let memeGrid: HTMLElement;
  let quoteGrid: HTMLElement;
  let videoGrid: HTMLElement;
  let playingVideo: number | null = null;

  const videos = [
    { id: '0YDj1QdL2Zs', title: 'What is Nostr?' },
    { id: 'heJ5Iw_UpD8', title: 'Nostr Crash Course' },
    { id: 'lp-BlTbTmqA', title: 'Nostr: An Antidote to Censorship?' },
    { id: 'ButstuTuea8', title: "Jack Dorsey's Biggest Problem with Elon Musk" },
  ];

  function handleVideoScroll() {
    if (!videoGrid) return;
    const cards = videoGrid.querySelectorAll('.video-card');
    const scrollLeft = videoGrid.scrollLeft;
    const cardWidth = (cards[0] as HTMLElement)?.offsetWidth ?? 1;
    const gap = 12;
    activeVideo = Math.round(scrollLeft / (cardWidth + gap));
  }
  let email = '';
  let subscribeState: 'idle' | 'submitting' | 'success' | 'error' = 'idle';

  async function handleSubscribe() {
    if (!email.trim()) return;
    subscribeState = 'submitting';
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      if (res.ok) {
        subscribeState = 'success';
      } else {
        subscribeState = 'error';
      }
    } catch {
      subscribeState = 'error';
    }
  }

  function handleMemeScroll() {
    if (!memeGrid) return;
    const cards = memeGrid.querySelectorAll('.meme-card');
    const scrollLeft = memeGrid.scrollLeft;
    const cardWidth = (cards[0] as HTMLElement)?.offsetWidth ?? 1;
    const gap = 12;
    activeMeme = Math.round(scrollLeft / (cardWidth + gap));
  }

  function handleQuoteScroll() {
    if (!quoteGrid) return;
    const cards = quoteGrid.querySelectorAll('.quote-card');
    const scrollLeft = quoteGrid.scrollLeft;
    const cardWidth = (cards[0] as HTMLElement)?.offsetWidth ?? 1;
    const gap = 12;
    activeQuote = Math.round(scrollLeft / (cardWidth + gap));
  }

  onMount(() => {
    isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  });
</script>

<svelte:head>
  <title>Get Started | Own Your Posts</title>
  <meta name="description" content="Your quick start guide to owning your social media. No ads, no algorithms, and a built-in bitcoin wallet." />
  <meta property="og:title" content="Own Your Posts — Quick Start Guide" />
  <meta property="og:description" content="Social media you actually own. No ads, no algorithms, & a built-in bitcoin wallet." />
  <meta property="og:image" content="https://img.youtube.com/vi/heJ5Iw_UpD8/maxresdefault.jpg" />
</svelte:head>

<div class="start-page">
  <header>
    <a href="/" class="logo">Own Your Posts</a>
    <nav class="style-switcher">
      <a href="/whyprimal">v1</a>
      <a href="/whyprimal/classic" class="ss-active">classic</a>
      <a href="/whyprimal/minimal">minimal</a>
    </nav>
  </header>

  <main>
    <!-- PLATFORM COMPARISON -->
    <section class="section">
      <h2>How Primal compares</h2>

      <div class="chart">
        <div class="chart-header">
          <div class="chart-platform-col"></div>
          <span>No Ads</span>
          <span>Own Your Content</span>
          <span>Can't Be Banned</span>
          <span>Earn Direct</span>
          <span>Portable</span>
        </div>

        <div class="chart-row chart-primal">
          <div class="chart-platform">
            <img src="/primal-logo.png" alt="Primal" class="chart-logo" />
            <span>Primal</span>
          </div>
          <div class="chart-cell"><span class="mark mark-yes" data-tip="Zero ads. No promoted posts. Ever."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-yes" data-tip="Your keys = your content. No company can take it."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-yes" data-tip="No company controls the network. You can't be silenced."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-yes" data-tip="Built-in Bitcoin wallet. Tips go 100% to you."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-yes" data-tip="One login works across dozens of Nostr apps."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span></div>
        </div>

        <div class="chart-row">
          <div class="chart-platform">
            <img src="/icon-instagram.png" alt="Instagram" class="chart-logo" />
            <span>Instagram</span>
          </div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Ads every 3-4 posts in your feed and stories."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Meta's ToS give them a license to all your content."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Shadowbans, content removal, account disabled with no appeal."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-meh" data-tip="Brand deals and creator fund, but Instagram controls who qualifies."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="6" y1="12" x2="18" y2="12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Your followers, content, and identity are locked to Instagram."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
        </div>

        <div class="chart-row">
          <div class="chart-platform">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="chart-icon chart-icon-x"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            <span>X / Twitter</span>
          </div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Promoted posts and ads throughout your timeline."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="X Corp's ToS grant them a worldwide license to your content."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Accounts suspended without warning. One person controls the platform."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-meh" data-tip="Revenue sharing exists but requires paying for Premium first."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="6" y1="12" x2="18" y2="12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Your followers and identity are locked to X."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
        </div>

        <div class="chart-row">
          <div class="chart-platform">
            <img src="/icon-tiktok.png" alt="TikTok" class="chart-logo" />
            <span>TikTok</span>
          </div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Ads between videos. Sponsored content mixed into your For You page."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="TikTok's ToS grant them an unrestricted license to your videos."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Banned in multiple countries. Your content disappears if removed."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Creator fund pays pennies. Platform takes ~70% of virtual gifts."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Everything is locked to TikTok. No way to take followers with you."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
        </div>

        <div class="chart-row">
          <div class="chart-platform">
            <img src="/icon-substack.png" alt="Substack" class="chart-logo" />
            <span>Substack</span>
          </div>
          <div class="chart-cell"><span class="mark mark-yes" data-tip="No ads in your newsletter or posts."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-meh" data-tip="You can export posts, but your audience is tied to their platform."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="6" y1="12" x2="18" y2="12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-meh" data-tip="They can remove publications that violate their content guidelines."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="6" y1="12" x2="18" y2="12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-meh" data-tip="Paid subscriptions work well, but Substack takes 10% + Stripe fees."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="6" y1="12" x2="18" y2="12"/></svg></span></div>
          <div class="chart-cell"><span class="mark mark-no" data-tip="Subscribers are locked to Substack. Can't take your list elsewhere."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span></div>
        </div>
      </div>
    </section>

    <!-- VIDEOS -->
    <section class="section">
      <h2>Not a platform. A protocol.</h2>
      <p class="section-sub">Primal is built on Nostr.</p>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="video-carousel" bind:this={videoGrid} on:scroll={handleVideoScroll}>
        {#each videos as video, i}
          <div class="video-card">
            {#if playingVideo === i}
              <div class="video-embed">
                <iframe
                  src="https://www.youtube.com/embed/{video.id}?autoplay=1&rel=0"
                  title={video.title}
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen
                ></iframe>
              </div>
            {:else}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="video-thumbnail" on:click={() => playingVideo = i}>
                <img src="https://img.youtube.com/vi/{video.id}/hqdefault.jpg" alt={video.title} loading="lazy" />
                <div class="play-button">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
            {/if}
            <p class="video-title">{video.title}</p>
          </div>
        {/each}
      </div>

      <div class="swipe-hint video-swipe-hint">
        {#each videos as _, i}
          <span class:active={activeVideo === i}></span>
        {/each}
      </div>
    </section>

    <!-- WHAT PROMINENT PEOPLE SAY -->
    <section class="section">
      <h2>People are paying attention</h2>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="quotes" bind:this={quoteGrid} on:scroll={handleQuoteScroll}>
        <div class="quote-card">
          <a href="https://primal.net/jack" target="_blank" rel="noopener noreferrer" class="quote-author quote-author-link">
            <img src="https://r2.primal.net/cache/d/07/1e/d071efe93be39d551e7d7d0e8437c5fb9d465ad91086c831fa3161591638019e.jpg" alt="Jack Dorsey" class="quote-avatar-img quote-avatar-legend" />
            <div class="quote-info">
              <strong>Jack Dorsey</strong>
              <span>Founder of Twitter</span>
            </div>
          </a>
          <p class="quote-text">"To be able to create content and build your identity and move it around under your agency, I think is the most powerful idea."</p>
          <a href="https://www.youtube.com/watch?v=MaZyXEU5XAg" target="_blank" rel="noopener noreferrer" class="quote-source">Oslo Freedom Forum, 2024</a>
        </div>

        <div class="quote-card">
          <a href="https://primal.net/p/npub14am887cf6kvwkce89nt7dsw3v9qrrn0uppxyvr6a2jd7xdwuwccqwnudp2" target="_blank" rel="noopener noreferrer" class="quote-author quote-author-link">
            <img src="https://primaldata.s3.us-east-005.backblazeb2.com/cache/0/ed/0d/0ed0de32c81fd9a151c196782d9cc8a927cf73164f1362df910624f216cc2273.jpg" alt="Paul Saladino MD" class="quote-avatar-img quote-avatar-premium" />
            <div class="quote-info">
              <strong>Paul Saladino MD</strong>
              <span>4M+ followers across platforms</span>
            </div>
          </a>
          <p class="quote-text">"They can cancel my Instagram. They can cancel my TikTok. They can cancel my YT. They'll never cancel my Nostr. Happy to be here."</p>
          <a href="https://primal.net/e/nevent1qqs2mctxa090gp9t38x4r4zs9fx6mdv8xqwfamssy2kyedd95p9zdcqm0s7p4" target="_blank" rel="noopener noreferrer" class="quote-source">Post on Nostr, Dec 2024</a>
        </div>
      </div>
      <div class="swipe-hint quote-swipe-hint">
        {#each Array(2) as _, i}
          <span class:active={activeQuote === i}></span>
        {/each}
      </div>
    </section>

    <!-- BRING YOUR CONTENT -->
    <section class="section migrate-section">
      <div class="migrate-badge">Free · Takes 2 minutes</div>
      <h2>Bring your content to Primal</h2>
      <p class="section-sub">Your posts don't have to stay trapped. We'll move them to your new Primal profile so you don't start from zero — completely free, no signup required.</p>

      <div class="migrate-steps">
        <div class="migrate-step">
          <div class="migrate-step-num">1</div>
          <div class="migrate-step-text">
            <strong>Enter your handle</strong>
            <span>We find your public Instagram posts</span>
          </div>
        </div>

        <!-- Visual mockup of the input UI -->
        <div class="mockup-input">
          <div class="mockup-tabs">
            <div class="mockup-tab mockup-tab-active">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="18" cy="6" r="1.5" fill="currentColor" stroke="none"/></svg>
              Insta
            </div>
            <div class="mockup-tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A5.32 5.32 0 0 0 4.05 15a5.32 5.32 0 0 0 5.32 4.67A5.32 5.32 0 0 0 14.7 14V8.28a8.33 8.33 0 0 0 4.89 1.58V6.69z"/></svg>
              TikTok
            </div>
            <div class="mockup-tab">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              Twitter
            </div>
          </div>
          <div class="mockup-field">
            <span class="mockup-at">@</span>
            <span class="mockup-handle">paulinthejungle</span>
            <span class="mockup-cursor"></span>
          </div>
        </div>
        <div class="migrate-step">
          <div class="migrate-step-num">2</div>
          <div class="migrate-step-text">
            <strong>Pick your favorites</strong>
            <span>Choose which posts to bring over</span>
          </div>
        </div>

        <!-- Animated post selection mockup -->
        <div class="mockup-grid" aria-hidden="true">
          {#each [1,2,3,4,5,6,7,8] as n, i}
            <div class="mockup-post" style="animation-delay: {0.8 + i * 0.6}s">
              <img src="/thumb-{n}.jpg" alt="" class="mockup-thumb-img" loading="lazy" />
              <div class="mockup-check" style="animation-delay: {0.8 + i * 0.6}s">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
            </div>
          {/each}
        </div>

        <div class="migrate-step">
          <div class="migrate-step-num">3</div>
          <div class="migrate-step-text">
            <strong>They appear on Primal</strong>
            <span>Your content, permanently yours</span>
          </div>
        </div>

        <!-- Primal profile mockup -->
        <div class="mockup-profile" aria-hidden="true">
          <div class="mockup-profile-banner">
            <img src="/primal-banner.jpg" alt="" class="mockup-banner-img" loading="lazy" />
            <div class="mockup-profile-banner-fade"></div>
          </div>
          <div class="mockup-profile-body">
            <div class="mockup-profile-header">
              <img src="/primal-avatar.jpg" alt="" class="mockup-profile-avatar" loading="lazy" />
              <div class="mockup-profile-info">
                <div class="mockup-profile-name">
                  paul keating
                  <svg class="mockup-verified" width="14" height="14" viewBox="0 0 24 24" fill="#8B5CF6"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="#8B5CF6" stroke-width="1.5" fill="rgba(139,92,246,0.15)"/><path d="M9 12l2 2 4-4" stroke="#8B5CF6" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="mockup-profile-handle">paul@primal.net</div>
              </div>
            </div>
            <div class="mockup-profile-stats">
              <div class="mockup-stat"><strong>2,794</strong><span>notes</span></div>
              <div class="mockup-stat"><strong>3,793</strong><span>replies</span></div>
              <div class="mockup-stat"><strong>6</strong><span>reads</span></div>
              <div class="mockup-stat mockup-stat-active"><strong>1,076</strong><span>media</span></div>
            </div>
            <div class="mockup-profile-media">
              {#each [1,2,3,4] as n}
                <div class="mockup-media-item">
                  <img src="/thumb-{n}.jpg" alt="" loading="lazy" />
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <a href="/" class="primary-btn migrate-btn">
        Migrate My Instagram
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
    </section>

    <!-- FAQ -->
    <section class="section faq-section">
      <h2>Common questions</h2>

      <div class="faq-list">
        <details class="faq-item">
          <summary>Is this a crypto thing?</summary>
          <p>Primal has a built-in Bitcoin wallet, but you don't need to understand crypto to use it. Think of it like built-in Venmo — you can send small tips to creators you like, or ignore it entirely. The social experience works the same either way.</p>
        </details>

        <details class="faq-item">
          <summary>How does Primal make money?</summary>
          <p>Primal makes money when users choose to pay for optional services. There are no ads, and we don't sell data. We think it's important that our incentives stay aligned with the people who use the app.</p>
        </details>

        <details class="faq-item">
          <summary>Will anyone see my posts?</summary>
          <p>Yes! Primal has a growing community of active users. Your posts appear in feeds, search, and can be found by anyone on any Nostr app. The more people who join, the bigger the network gets.</p>
        </details>

        <details class="faq-item">
          <summary>What should my first post be?</summary>
          <p>Introduce yourself. Say what you do and/or what you're interested in. Why you're starting on Nostr. Add a photo if you wish. Definitely add the hashtag <strong>#introductions</strong> at the end. See this <a href="https://primal.net/e/nevent1qqswnssfrlyh97cys6sxzukdfgaf7kttuxtq4r3r69xnay2l5sk2f3cg759j9" target="_blank" rel="noopener noreferrer">example</a>. Also, send <a href="https://primal.net/paulinthejungle" target="_blank" rel="noopener noreferrer">paulinthejungle</a> a DM so he can repost.</p>
        </details>

        <details class="faq-item">
          <summary>What are "keys"?</summary>
          <p>Instead of email/password, Nostr uses cryptographic keys. Think of it as a universal login — one key works across every Nostr app. Find your key in the settings and keep it somewhere safe! It starts with "nsec".</p>
        </details>

        <details class="faq-item">
          <summary>Can I use both Instagram and Primal?</summary>
          <p>Absolutely. Many people post on both while they transition. There's no pressure to delete Instagram — just start building on something you actually own.</p>
        </details>
      </div>
    </section>

    <!-- READS -->
    <section class="section reads-section">
      <h2>Want to read more?</h2>
      <div class="reads-grid">
        <a href="https://primal.net/e/naddr1qvzqqqr4gupzpqzmxnms3qmalvl87pvpttzhvptyv29434dqe6peejakaumzp7krqy88wumn8ghj7mn0wvhxcmmv9uq3xamnwvaz7tmsw4e8qmr9wpskwtn9wvhsq82wv4mj6ar0948x7um5wgk4yetpvskhg6rfwvkk66rexphny0g5639" target="_blank" rel="noopener noreferrer" class="read-card">
          <div class="read-img">
            <img src="/read-nostr.jpg" alt="New to Nostr?" loading="lazy" />
          </div>
          <div class="read-body">
            <strong>New to Nostr? Read this</strong>
            <span>Your beginner's guide to Nostr. Welcome to freedom.</span>
            <div class="read-author">
              <img src="/primal-avatar.jpg" alt="" class="read-author-avatar" />
              <span>paul keating</span>
            </div>
          </div>
        </a>
        <a href="https://primal.net/e/naddr1qvzqqqr4gupzpqzmxnms3qmalvl87pvpttzhvptyv29434dqe6peejakaumzp7krqyvhwumn8ghj7urjv4kkjatd9ec8y6tdv9kzumn9wshszrnhwden5te0dehhxtnvdakz7qqsda6hyttnda3kjctv94kk2erfvy4g6k72" target="_blank" rel="noopener noreferrer" class="read-card">
          <div class="read-img">
            <img src="/read-social.png" alt="Our Social Media" loading="lazy" />
          </div>
          <div class="read-body">
            <strong>Our Social Media</strong>
            <span>Learning from our past to create a better future</span>
            <div class="read-author">
              <img src="/primal-avatar.jpg" alt="" class="read-author-avatar" />
              <span>paul keating</span>
            </div>
          </div>
        </a>
        <a href="https://primal.net/e/naddr1qvzqqqr4gupzpq35r7yzkm4te5460u00jz4djcw0qa90zku7739qn7wj4ralhe4zqqxnzd3cxyerxd3h8qerwwfcvcwa0f" target="_blank" rel="noopener noreferrer" class="read-card">
          <div class="read-img">
            <img src="/read-protocol.jpg" alt="A native internet protocol for social media" loading="lazy" />
          </div>
          <div class="read-body">
            <strong>A native internet protocol for social media</strong>
            <div class="read-author">
              <img src="/avatar-jack.jpg" alt="" class="read-author-avatar" />
              <span>jack</span>
            </div>
          </div>
        </a>
        <a href="https://primal.net/e/naddr1qvzqqqr4gupzqak8r2hr5jglrk0wc37t59lz98x6gyf6pwaku6hpwakhvslznjh6qy08wumn8ghj7mn0wd68yttsw43zuam9d3kx7unyv4ezumn9wshszymhwden5te0wp6hyurvv4cxzeewv4ej7qpnwajj6er9wdjhyan9943x2ar5v4ez6cfddejhwttnda3kjctv94kk2erfvykky6tvdskk7e3dwf5kw6r5wvhwkmd5" target="_blank" rel="noopener noreferrer" class="read-card">
          <div class="read-img">
            <img src="/read-rights.jpg" alt="We Deserve Better" loading="lazy" />
          </div>
          <div class="read-body">
            <strong>We Deserve Better: A New Social Media Bill of Rights</strong>
            <div class="read-author">
              <img src="/avatar-rabble.jpg" alt="" class="read-author-avatar" />
              <span>rabble</span>
            </div>
          </div>
        </a>
      </div>
    </section>

    <!-- DOWNLOAD PRIMAL -->
    <section class="section download-section">
      <h2>Want to start fresh?</h2>
      <p class="section-sub">Download Primal and start posting. You can import your content later.</p>
      <div class="app-links app-links-center">
        <a href="https://apps.apple.com/us/app/primal/id1673134518" target="_blank" rel="noopener noreferrer" class="app-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
          App Store
        </a>
        <a href="https://play.google.com/store/apps/details?id=net.primal.android" target="_blank" rel="noopener noreferrer" class="app-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.302 2.302-2.302 2.302-2.698-2.302 2.698-2.302zM5.864 2.658L16.8 9.99l-2.302 2.302-8.634-8.634z"/>
          </svg>
          Google Play
        </a>
        <a href="https://primal.net" target="_blank" rel="noopener noreferrer" class="app-badge web-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          primal.net
        </a>
      </div>
    </section>

    <!-- UNDERSTAND PRIMAL IN MEMES -->
    <section class="section section-tight">
      <h2>Understand Primal in memes</h2>
      <p class="section-sub">Sometimes a meme explains it better than a whitepaper.</p>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="meme-grid" bind:this={memeGrid} on:scroll={handleMemeScroll}>
        <div class="meme-card">
          <img src="/meme-morpheus.jpg" alt="What if I told you... you never needed permission to post online" class="meme-img-real" loading="lazy" />
        </div>

        <div class="meme-card">
          <img src="/meme-puppet.jpg" alt="Social Network: CEO controls you. Nostr: You control your relays." class="meme-img-real" loading="lazy" />
        </div>

        <div class="meme-card">
          <img src="/meme-alligator.jpg" alt="Nostr kicking minimum eligibility requirements for monetizing content" class="meme-img-real" loading="lazy" />
        </div>

        <div class="meme-card">
          <img src="/meme-cage.jpg" alt="When Twitter became X - I'm Free! (still in cage)" class="meme-img-real" loading="lazy" />
        </div>

        <div class="meme-card">
          <img src="/meme-audience.jpg" alt="Mainstream audience size vs value compared to Nostr audience" class="meme-img-real" loading="lazy" />
        </div>

        <div class="meme-card">
          <img src="/meme-freedom.jpg" alt="Nostr and Bitcoin fueling freedom" class="meme-img-real" loading="lazy" />
        </div>
      </div>
      <div class="swipe-hint">
        {#each Array(6) as _, i}
          <span class:active={activeMeme === i}></span>
        {/each}
      </div>
    </section>

    <!-- FINAL CTA -->
    <section class="final-cta">
      <h2>Ready to own your posts?</h2>
      <p>Start by bringing your Instagram content over. It takes about 2 minutes.</p>
      <a href="/" class="primary-btn">
        Migrate My Instagram
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
    </section>
  </main>

  <div class="signup-section">
    {#if subscribeState === 'success'}
      <p class="signup-success">You're on the list</p>
    {:else}
      <p class="signup-heading">Stay updated with Primal</p>
      <form class="signup-form" on:submit|preventDefault={handleSubscribe}>
        <input
          type="email"
          bind:value={email}
          placeholder="you@email.com"
          class="signup-input"
          required
        />
        <button type="submit" class="signup-button" disabled={subscribeState === 'submitting'}>
          {subscribeState === 'submitting' ? '...' : 'Subscribe'}
        </button>
      </form>
      {#if subscribeState === 'error'}
        <p class="signup-error">Something went wrong. Try again.</p>
      {/if}
    {/if}
  </div>

  <footer>
    <p>Built on <a href="https://nostr.com" target="_blank" rel="noopener noreferrer">Nostr</a> — the open protocol for social media</p>
    <p><a href="https://nostrapps.com" target="_blank" rel="noopener noreferrer">Explore the Nostr ecosystem</a></p>
  </footer>
</div>
<style>
  /* ============================================================
     CLASSIC / OLD-INTERNET STYLE
     Inspired by mid-90s to early-2000s personal homepages.
     White background, serif type, blue underlined links.
     ============================================================ */

  :global(body) {
    background: #fefefe;
    color: #000;
    font-family: "Times New Roman", Times, Georgia, serif;
    font-size: 16px;
    line-height: 1.5;
  }

  .start-page {
    min-height: 100vh;
    background: #fefefe;
    color: #000;
    font-family: "Times New Roman", Times, Georgia, serif;
  }

  /* ---- HEADER ---- */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    background: #fefefe;
    border-bottom: 1px solid #000;
    position: static;
  }

  .style-switcher {
    display: flex;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-family: "Times New Roman", serif;
  }
  .style-switcher a {
    color: #0000EE;
    text-decoration: underline;
  }
  .style-switcher a.ss-active {
    color: #000;
    font-weight: bold;
    text-decoration: none;
  }

  .logo {
    font-family: "Times New Roman", Times, serif;
    font-weight: bold;
    font-size: 1.25rem;
    color: #000;
    text-decoration: none;
    font-style: italic;
  }

  /* ---- LAYOUT ---- */
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem 1.5rem 2rem;
  }

  .section {
    padding: 1.25rem 0;
    border-bottom: 1px dashed #999;
  }

  .section:last-of-type {
    border-bottom: none;
  }

  /* ---- TYPOGRAPHY ---- */
  h1 {
    font-family: "Times New Roman", Times, serif;
    font-size: 2.25rem;
    font-weight: bold;
    line-height: 1.2;
    text-align: center;
    margin: 1.5rem 0 0.75rem;
    color: #000;
    letter-spacing: 0;
  }

  .gradient-text {
    background: none;
    -webkit-background-clip: initial;
    -webkit-text-fill-color: initial;
    background-clip: initial;
    color: #00008B;
    font-style: italic;
  }

  h2 {
    font-family: "Times New Roman", Times, serif;
    font-size: 1.5rem;
    font-weight: bold;
    margin: 0.5rem 0 0.75rem;
    color: #000;
    border-bottom: 2px solid #000;
    padding-bottom: 0.25rem;
  }

  p, .section-sub, .hero-sub {
    font-size: 1rem;
    color: #222;
    margin: 0.5rem 0;
  }

  .hero {
    text-align: center;
    padding: 1.5rem 0;
  }

  .hero-sub {
    font-size: 1.0625rem;
    max-width: 540px;
    margin: 0.75rem auto;
  }

  a {
    color: #0000EE;
    text-decoration: underline;
  }
  a:visited { color: #551A8B; }
  a:hover { color: #EE0000; }

  /* ---- CHART (as a real table) ---- */
  .chart {
    display: table;
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #000;
    background: #fff;
    margin: 0.75rem 0;
    font-size: 0.875rem;
  }
  .chart-header {
    display: table-row;
    background: #ddd;
    font-weight: bold;
  }
  .chart-header > * {
    display: table-cell;
    padding: 0.4rem 0.5rem;
    border: 1px solid #000;
    text-align: center;
    vertical-align: middle;
  }
  .chart-platform-col { width: 25%; }

  .chart-row {
    display: table-row;
  }
  .chart-row > * {
    display: table-cell;
    padding: 0.4rem 0.5rem;
    border: 1px solid #000;
    vertical-align: middle;
    text-align: center;
    background: #fff;
  }
  .chart-row:nth-of-type(odd) > * { background: #f5f5f5; }
  .chart-primal > * { background: #fffbe6 !important; font-weight: bold; }

  .chart-platform {
    display: flex !important;
    align-items: center;
    gap: 0.4rem;
    text-align: left !important;
  }
  .chart-logo, .chart-icon { width: 18px; height: 18px; }
  .chart-icon-x { color: #000; }

  .mark { display: inline-flex; }
  .mark-yes  { color: #006400; }
  .mark-no   { color: #8B0000; }
  .mark-meh  { color: #555; }

  /* Chart tooltips */
  .mark[data-tip] {
    position: relative;
    cursor: help;
  }
  .mark[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 0.4rem 0.6rem;
    background: #111;
    color: #fff;
    border: 1px solid #000;
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1.35;
    white-space: normal;
    width: max-content;
    max-width: 200px;
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    z-index: 20;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }
  .mark[data-tip]:hover::after,
  .mark[data-tip]:focus::after {
    opacity: 1;
  }

  /* ---- VIDEOS ---- */
  .video-carousel {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    scroll-snap-type: x mandatory;
  }
  .video-card {
    flex: 0 0 260px;
    scroll-snap-align: start;
    background: #fff;
    border: 1px solid #000;
    padding: 0.4rem;
  }
  .video-thumbnail {
    position: relative;
    cursor: pointer;
    border: 1px solid #444;
  }
  .video-thumbnail img { width: 100%; display: block; }
  .video-embed {
    position: relative;
    padding-bottom: 56.25%;
    height: 0;
  }
  .video-embed iframe {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    border: 0;
  }
  .play-button {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.25);
  }
  .video-title {
    font-size: 0.9375rem;
    font-weight: bold;
    margin: 0.4rem 0 0.2rem;
    text-align: center;
  }

  /* ---- QUOTES ---- */
  .quotes {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-x: visible;
  }
  .quote-card {
    background: #fffbe6;
    border: 1px solid #aaa;
    border-left: 4px solid #00008B;
    padding: 0.75rem 1rem;
    flex: none;
  }
  .quote-author, .quote-author-link {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.4rem;
    text-decoration: none;
    color: #000;
  }
  .quote-avatar-img {
    width: 40px; height: 40px;
    border-radius: 50%;
    border: 1px solid #444;
  }
  .quote-info strong { display: block; font-weight: bold; }
  .quote-info span   { font-size: 0.85rem; color: #555; }
  .quote-text {
    font-style: italic;
    font-size: 1.0625rem;
    margin: 0.4rem 0;
  }
  .quote-source { font-size: 0.85rem; }

  /* ---- MIGRATE / STEPS ---- */
  .migrate-badge {
    display: inline-block;
    background: #ffff66;
    border: 1px solid #000;
    padding: 0.15rem 0.5rem;
    font-size: 0.85rem;
    font-weight: bold;
    margin-bottom: 0.5rem;
  }
  .migrate-steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0.75rem 0;
  }
  .migrate-step {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
  }
  .migrate-step-num {
    flex: none;
    width: 1.75rem; height: 1.75rem;
    background: #00008B;
    color: #fff;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-weight: bold;
    font-family: "Times New Roman", serif;
  }
  .migrate-step-text strong {
    display: block;
    font-weight: bold;
  }
  .migrate-step-text span {
    font-size: 0.9375rem;
    color: #444;
  }

  /* Mockups: render as simple framed boxes */
  .mockup-input,
  .mockup-grid,
  .mockup-profile {
    background: #fff;
    border: 1px solid #000;
    padding: 0.5rem;
    margin: 0.5rem 0;
  }
  .mockup-tabs { display: flex; gap: 0.25rem; margin-bottom: 0.4rem; }
  .mockup-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid #777;
    background: #eee;
    font-size: 0.85rem;
  }
  .mockup-tab-active { background: #ffff66; font-weight: bold; }
  .mockup-field {
    display: flex; align-items: center;
    background: #fff;
    border: 1px inset #999;
    padding: 0.25rem 0.5rem;
    font-family: "Courier New", monospace;
  }
  .mockup-at { color: #888; }
  .mockup-cursor {
    display: inline-block; width: 1px; height: 1em;
    background: #000; margin-left: 2px;
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink { to { visibility: hidden; } }

  .mockup-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
  }
  .mockup-post {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 1px solid #777;
  }
  .mockup-thumb-img { width: 100%; height: 100%; object-fit: cover; }
  .mockup-check {
    position: absolute; top: 4px; right: 4px;
    width: 16px; height: 16px;
    background: #006400;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }

  .mockup-profile-banner {
    position: relative;
    aspect-ratio: 3 / 1;
    overflow: hidden;
    border: 1px solid #999;
  }
  .mockup-banner-img { width: 100%; height: 100%; object-fit: cover; }
  .mockup-profile-banner-fade { display: none; }
  .mockup-profile-body { padding-top: 0.5rem; }
  .mockup-profile-header { display: flex; align-items: center; gap: 0.5rem; }
  .mockup-profile-avatar {
    width: 48px; height: 48px;
    border-radius: 50%;
    border: 1px solid #444;
  }
  .mockup-profile-name {
    display: flex; align-items: center; gap: 0.3rem;
    font-weight: bold;
  }
  .mockup-profile-handle { font-size: 0.85rem; color: #555; }
  .mockup-profile-stats {
    display: flex; gap: 1rem;
    margin: 0.5rem 0;
    border-top: 1px dashed #999;
    border-bottom: 1px dashed #999;
    padding: 0.4rem 0;
    font-size: 0.85rem;
  }
  .mockup-stat strong { display: block; }
  .mockup-stat-active strong { color: #00008B; }
  .mockup-profile-media {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
  }
  .mockup-media-item { aspect-ratio: 1; overflow: hidden; border: 1px solid #777; }
  .mockup-media-item img { width: 100%; height: 100%; object-fit: cover; }

  /* ---- BUTTONS ---- */
  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: #00008B;
    color: #fff;
    padding: 0.5rem 1rem;
    border: 1px solid #000;
    font-family: "Times New Roman", Times, serif;
    font-size: 1rem;
    font-weight: bold;
    text-decoration: none;
    margin: 0.75rem 0;
  }
  .primary-btn:hover { background: #000060; color: #fff; }
  .primary-btn:visited { color: #fff; }

  /* ---- APP BADGES ---- */
  .app-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.75rem 0;
  }
  .app-links-center { justify-content: flex-start; }
  .app-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.75rem;
    background: #eee;
    border: 1px outset #aaa;
    color: #000;
    text-decoration: none;
    font-weight: bold;
  }
  .app-badge:visited { color: #000; }
  .app-badge:hover { background: #ddd; }

  /* ---- FAQ ---- */
  .faq-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .faq-item {
    background: #fff;
    border: 1px solid #999;
    padding: 0.5rem 0.75rem;
  }
  .faq-item summary {
    cursor: pointer;
    font-weight: bold;
    list-style: disc inside;
  }
  .faq-item[open] summary { margin-bottom: 0.4rem; }
  .faq-item p { font-size: 0.9375rem; }

  /* ---- READS ---- */
  .reads-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .read-card {
    display: flex;
    gap: 0.625rem;
    background: #fff;
    border: 1px solid #999;
    padding: 0.5rem;
    text-decoration: none;
    color: #000;
  }
  .read-card:visited { color: #000; }
  .read-img { flex: 0 0 96px; }
  .read-img img { width: 96px; height: 72px; object-fit: cover; border: 1px solid #777; }
  .read-body strong { display: block; font-weight: bold; }
  .read-body span { font-size: 0.875rem; color: #444; }
  .read-author {
    display: flex; align-items: center; gap: 0.3rem;
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    color: #555;
  }
  .read-author-avatar {
    width: 20px; height: 20px; border-radius: 50%; border: 1px solid #777;
  }

  /* ---- MEMES ---- */
  .meme-grid {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: 0.5rem;
  }
  .meme-card {
    flex: 0 0 240px;
    scroll-snap-align: start;
    border: 1px solid #000;
    background: #fff;
    padding: 0.25rem;
  }
  .meme-img-real { width: 100%; display: block; }

  .swipe-hint {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }
  .swipe-hint span {
    width: 8px; height: 8px;
    background: #ccc;
    border: 1px solid #777;
    border-radius: 50%;
  }
  .swipe-hint span.active { background: #00008B; }

  /* ---- FINAL CTA ---- */
  .final-cta {
    text-align: center;
    padding: 1.5rem 0 1rem;
    border-top: 2px solid #000;
    margin-top: 1.5rem;
  }
  .final-cta h2 { border-bottom: none; }

  /* ---- SIGNUP ---- */
  .signup-section {
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem 1.5rem 2rem;
    text-align: center;
    border-top: 1px dashed #999;
  }
  .signup-heading {
    font-weight: bold;
    margin-bottom: 0.5rem;
  }
  .signup-form {
    display: inline-flex;
    gap: 0.4rem;
  }
  .signup-input {
    padding: 0.4rem 0.5rem;
    border: 1px inset #aaa;
    font-family: "Times New Roman", serif;
    font-size: 1rem;
    min-width: 200px;
  }
  .signup-button {
    padding: 0.4rem 0.75rem;
    border: 1px outset #aaa;
    background: #eee;
    cursor: pointer;
    font-weight: bold;
    font-family: "Times New Roman", serif;
  }
  .signup-button:hover { background: #ddd; }
  .signup-success { color: #006400; font-weight: bold; }
  .signup-error { color: #8B0000; }

  /* ---- FOOTER ---- */
  footer {
    text-align: center;
    padding: 1rem 1.5rem 2rem;
    color: #555;
    font-size: 0.9375rem;
    border-top: 1px solid #000;
    margin-top: 1rem;
  }
  footer p { margin: 0.25rem 0; }

  /* Hide things we don't need in this style */
  .hero-badge { display: none; }
  .section-tight { padding-top: 1rem; }

  /* ---- MOBILE ---- */
  @media (max-width: 640px) {
    h1 { font-size: 1.75rem; }
    .chart { font-size: 0.75rem; }
    .chart-header > *, .chart-row > * { padding: 0.3rem; }
    main { padding: 0.75rem 1rem 2rem; }
  }
</style>
