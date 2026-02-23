<script lang="ts">
  import { onMount } from 'svelte';

  let isMobile = false;
  let activeMeme = 0;
  let activeQuote = 0;
  let memeGrid: HTMLElement;
  let quoteGrid: HTMLElement;
  let videoPlaying = false;
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
  </header>

  <main>
    <!-- HERO -->
    <section class="hero">
      <h1>Social media<br/><span class="gradient-text">you actually own.</span></h1>
      <p class="hero-sub">No ads. Choose your algorithms. No one can delete your account. This is what social media should have been.</p>
    </section>

    <!-- VIDEO -->
    <section class="video-section">
      {#if videoPlaying}
        <div class="video-embed">
          <iframe
            src="https://www.youtube.com/embed/heJ5Iw_UpD8?autoplay=1&rel=0"
            title="What is Primal?"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="video-thumbnail" on:click={() => videoPlaying = true}>
          <img src="https://img.youtube.com/vi/heJ5Iw_UpD8/maxresdefault.jpg" alt="Watch: What is Primal?" loading="eager" />
          <div class="play-button">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div class="video-label">Watch the overview</div>
        </div>
      {/if}
    </section>

    <!-- PLATFORM COMPARISON -->
    <section class="section">
      <h2>How Primal compares</h2>
      <p class="section-sub">See how the platforms you use stack up on what actually matters.</p>

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

    <!-- WHAT PROMINENT PEOPLE SAY -->
    <section class="section">
      <h2>People are paying attention</h2>
      <p class="section-sub">Some notable people have a lot to say about why this matters.</p>

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
          <a href="https://primal.net/snowden" target="_blank" rel="noopener noreferrer" class="quote-author quote-author-link">
            <img src="https://primaldata.s3.us-east-005.backblazeb2.com/cache/9/cd/c5/9cdc5dba1672dc15baca235eee6d16b51e27c527fe09373e2881a5866ba127d6.jpg" alt="Edward Snowden" class="quote-avatar-img" />
            <div class="quote-info">
              <strong>Edward Snowden</strong>
              <span>Privacy advocate</span>
            </div>
          </a>
          <p class="quote-text">"If a platform is a silo, a protocol is a river: no one owns it, and everyone is free to swim."</p>
          <a href="https://x.com/Snowden/status/1620789340199882752" target="_blank" rel="noopener noreferrer" class="quote-source">Post on X, Feb 2023</a>
        </div>

        <div class="quote-card">
          <a href="https://primal.net/p/npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk" target="_blank" rel="noopener noreferrer" class="quote-author quote-author-link">
            <img src="https://r2.primal.net/cache/9/7f/d7/97fd7c410ed985aad25f81b1bdc0ce7a53bf5240362713e30ce5e7b014022b7f.jpg" alt="Martti Malmi" class="quote-avatar-img" />
            <div class="quote-info">
              <strong>Martti Malmi</strong>
              <span>Bitcoin's first developer with Satoshi</span>
            </div>
          </a>
          <p class="quote-text">"Bitcoin is freedom of money, and Nostr is freedom of everything else."</p>
          <a href="https://reason.com/video/2024/09/17/is-nostr-an-antidote-to-social-media-censorship/" target="_blank" rel="noopener noreferrer" class="quote-source">BTC Prague, 2024</a>
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
        {#each Array(4) as _, i}
          <span class:active={activeQuote === i}></span>
        {/each}
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

    <!-- BRING YOUR CONTENT -->
    <section class="section migrate-section">
      <div class="migrate-badge">It takes 2 minutes</div>
      <h2>Bring your content to Primal</h2>
      <p class="section-sub">Your posts don't have to stay trapped. We'll move them to your new Primal profile so you don't start from zero.</p>

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

    <!-- FAQ -->
    <section class="section faq-section">
      <h2>Common questions</h2>

      <div class="faq-list">
        <details class="faq-item">
          <summary>Is this a crypto thing?</summary>
          <p>Primal has a built-in Bitcoin wallet, but you don't need to understand crypto to use it. Think of it like built-in Venmo — you can send small tips to creators you like, or ignore it entirely. The social experience works the same either way.</p>
        </details>

        <details class="faq-item">
          <summary>Will anyone see my posts?</summary>
          <p>Yes! Primal has a growing community of active users. Your posts appear in feeds, search, and can be found by anyone on any Nostr app. The more people who join, the bigger the network gets.</p>
        </details>

        <details class="faq-item">
          <summary>What about my followers?</summary>
          <p>Your Instagram followers won't automatically follow you on Primal — but you can share your new profile with them. The people who care about your content will come. And they'll find a much better experience waiting for them.</p>
        </details>

        <details class="faq-item">
          <summary>Is it really free?</summary>
          <p>Completely free. No premium tiers, no hidden costs. Primal makes money through optional premium features, not by selling your data or shoving ads in your face.</p>
        </details>

        <details class="faq-item">
          <summary>What are "keys"?</summary>
          <p>Instead of email/password, Nostr uses cryptographic keys. Think of it as a universal login — one key works across every Nostr app. Primal handles all of this for you when you sign up, so you don't have to think about it.</p>
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
  .start-page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.625rem 2rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: rgba(13, 13, 13, 0.9);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    z-index: 100;
  }

  .logo {
    font-weight: 700;
    font-size: 1.125rem;
    color: var(--text-primary);
    text-decoration: none;
  }

  main {
    max-width: 680px;
    margin: 0 auto;
    padding: 0 1.5rem;
  }

  /* ---- HERO ---- */
  .hero {
    text-align: center;
    padding: 0.75rem 0 0.75rem;
  }

  .hero-badge {
    display: inline-block;
    padding: 0.375rem 1rem;
    background: rgba(250, 60, 131, 0.1);
    border: 1px solid rgba(250, 60, 131, 0.25);
    border-radius: 2rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 1.25rem;
  }

  h1 {
    font-size: 2.75rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 0.5rem;
  }

  .gradient-text {
    background: var(--accent-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero-sub {
    font-size: 1.0625rem;
    color: var(--text-secondary);
    line-height: 1.5;
    max-width: 520px;
    margin: 0 auto;
  }

  /* ---- VIDEO ---- */
  .video-section {
    margin-bottom: 0.75rem;
  }

  .video-embed {
    position: relative;
    padding-bottom: 56.25%; /* 16:9 */
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid var(--border-light);
  }

  .video-embed iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
  }

  .video-thumbnail {
    display: block;
    position: relative;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid var(--border-light);
    transition: all 0.3s ease;
    text-decoration: none;
    cursor: pointer;
  }

  .video-thumbnail:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 12px 40px rgba(250, 60, 131, 0.2);
  }

  .video-thumbnail img {
    width: 100%;
    display: block;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }

  .play-button {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 64px;
    height: 64px;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-left: 3px;
    transition: all 0.2s ease;
  }

  .video-thumbnail:hover .play-button {
    background: var(--accent);
    transform: translate(-50%, -50%) scale(1.1);
  }

  .video-label {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1.5rem 1rem 1rem;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
    color: white;
    font-size: 0.875rem;
    font-weight: 600;
  }

  /* ---- SECTIONS ---- */
  .section {
    padding: 1.75rem 0;
    border-top: 1px solid var(--border);
  }

  .section-tight {
    padding-top: 1rem;
  }

  h2 {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 0.5rem;
  }

  .section-sub {
    color: var(--text-secondary);
    font-size: 1rem;
    margin-bottom: 1.25rem;
    line-height: 1.6;
  }

  /* ---- CHART ---- */
  .chart {
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 1rem;
    overflow: hidden;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .chart-header {
    display: grid;
    grid-template-columns: 140px repeat(5, 1fr);
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .chart-header span {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: center;
    line-height: 1.3;
  }

  .chart-row {
    display: grid;
    grid-template-columns: 140px repeat(5, 1fr);
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    transition: background 0.15s ease;
  }

  .chart-row:last-child {
    border-bottom: none;
  }

  .chart-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .chart-primal {
    background: rgba(250, 60, 131, 0.05);
  }

  .chart-primal:hover {
    background: rgba(250, 60, 131, 0.08);
  }

  .chart-primal .chart-platform span {
    font-weight: 700;
    color: var(--text-primary);
  }

  .chart-platform {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .chart-platform span {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .chart-logo {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .chart-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0.4;
  }

  .chart-cell {
    display: flex;
    justify-content: center;
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }

  .mark-yes {
    background: rgba(0, 210, 106, 0.12);
    color: var(--success);
  }

  .mark-no {
    background: rgba(255, 75, 75, 0.08);
    color: rgba(255, 75, 75, 0.5);
  }

  .mark-meh {
    background: rgba(255, 176, 32, 0.1);
    color: rgba(255, 176, 32, 0.6);
  }

  /* Chart tooltips */
  .mark[data-tip] {
    position: relative;
    cursor: default;
  }

  .mark[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.4;
    white-space: normal;
    width: max-content;
    max-width: 200px;
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    z-index: 10;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .mark[data-tip]:hover::after {
    opacity: 1;
  }

  /* Colored platform labels */
  .chart-icon-x {
    color: var(--text-primary);
    opacity: 0.7 !important;
  }

  /* ---- QUOTES ---- */
  .quotes {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .quote-card {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 0.875rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: inherit;
  }

  .quote-author {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .quote-author-link {
    text-decoration: none;
    color: inherit;
    transition: opacity 0.15s ease;
  }

  .quote-author-link:hover {
    opacity: 0.8;
  }

  .quote-avatar-img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
    border: 2px solid var(--border-light);
  }

  .quote-avatar-legend {
    border-color: rgba(201, 160, 48, 0.6);
    box-shadow: 0 0 6px rgba(201, 160, 48, 0.25);
  }

  .quote-avatar-premium {
    border: 2px solid transparent;
    background-image: linear-gradient(var(--bg-primary), var(--bg-primary)), linear-gradient(135deg, #F77737, #E1306C, #C13584);
    background-origin: border-box;
    background-clip: content-box, border-box;
    box-shadow: 0 0 6px rgba(225, 48, 108, 0.25);
  }

  .quote-info {
    display: flex;
    flex-direction: column;
  }

  .quote-info strong {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .quote-info span {
    font-size: 0.6875rem;
    color: var(--text-muted);
    line-height: 1.2;
  }

  .quote-text {
    font-size: 0.875rem;
    font-weight: 400;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
  }

  .quote-source {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--text-muted);
    text-decoration: none;
    opacity: 0.6;
    transition: opacity 0.2s ease;
  }

  .quote-source:hover {
    opacity: 1;
    color: var(--accent);
  }

  /* ---- MEMES ---- */
  .meme-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.875rem;
  }

  .meme-card {
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 1rem;
    overflow: hidden;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: all 0.2s ease;
  }

  .meme-card:hover {
    border-color: rgba(250, 60, 131, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .meme-img-real {
    width: 100%;
    display: block;
    border-radius: 0.75rem;
  }

  /* ---- MOCKUP INPUT ---- */
  .mockup-input {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    pointer-events: none;
    user-select: none;
    margin-top: -0.25rem;
    margin-bottom: 0.25rem;
  }

  .mockup-tabs {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .mockup-tab {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 2rem;
    border: 1px solid var(--border-light);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
  }

  .mockup-tab-active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(250, 60, 131, 0.08);
  }

  .mockup-field {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(250, 60, 131, 0.4);
    background: var(--bg-tertiary);
  }

  .mockup-at {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin-right: 0.25rem;
  }

  .mockup-handle {
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .mockup-cursor {
    width: 2px;
    height: 1.125rem;
    background: var(--accent);
    margin-left: 1px;
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  /* ---- MOCKUP GRID (animated post selection) ---- */
  .mockup-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    border-radius: 0.5rem;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    margin-top: -0.25rem;
    margin-bottom: 0.25rem;
  }

  .mockup-post {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
  }

  .mockup-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .mockup-check {
    position: absolute;
    top: 0.2rem;
    right: 0.2rem;
    width: 1rem;
    height: 1rem;
    background: var(--accent);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.5);
  }

  .mockup-post {
    animation: mockup-select 4.8s ease infinite;
  }

  @keyframes mockup-select {
    0%, 10% {
      outline: none;
    }
    15% {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    85% {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    90%, 100% {
      outline: none;
    }
  }

  .mockup-post .mockup-check {
    animation: mockup-check-pop 4.8s ease infinite;
  }

  @keyframes mockup-check-pop {
    0%, 10% {
      opacity: 0;
      transform: scale(0.5);
    }
    18% {
      opacity: 1;
      transform: scale(1);
    }
    82% {
      opacity: 1;
      transform: scale(1);
    }
    90%, 100% {
      opacity: 0;
      transform: scale(0.5);
    }
  }

  /* ---- MOCKUP PROFILE (Primal card) ---- */
  .mockup-profile {
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid var(--border-light);
    background: var(--bg-glass);
    pointer-events: none;
    user-select: none;
    margin-top: -0.25rem;
    margin-bottom: 0.25rem;
  }

  .mockup-profile-banner {
    height: 72px;
    position: relative;
    overflow: hidden;
  }

  .mockup-banner-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .mockup-profile-banner-fade {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, transparent 40%, rgba(13, 13, 13, 0.85));
  }

  .mockup-profile-body {
    padding: 0 0.875rem 0.75rem;
    margin-top: -1.25rem;
    position: relative;
  }

  .mockup-profile-header {
    display: flex;
    align-items: flex-end;
    gap: 0.625rem;
    margin-bottom: 0.625rem;
  }

  .mockup-profile-avatar {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    border: 2px solid var(--bg-primary);
    flex-shrink: 0;
    object-fit: cover;
  }

  .mockup-profile-info {
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
    padding-bottom: 0.125rem;
  }

  .mockup-profile-name {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .mockup-verified {
    flex-shrink: 0;
  }

  .mockup-profile-handle {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .mockup-profile-stats {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.625rem;
    padding-left: 0.125rem;
  }

  .mockup-stat {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .mockup-stat strong {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .mockup-stat span {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .mockup-stat-active {
    padding-bottom: 0.375rem;
    border-bottom: 1px solid #8B5CF6;
  }

  .mockup-profile-media {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    border-radius: 0.375rem;
    overflow: hidden;
  }

  .mockup-media-item {
    aspect-ratio: 1;
    overflow: hidden;
  }

  .mockup-media-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* ---- SWIPE HINT (mobile only) ---- */
  .swipe-hint {
    display: none;
  }

  /* ---- MIGRATE SECTION ---- */
  .migrate-section {
    text-align: center;
  }

  .migrate-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    background: rgba(0, 210, 106, 0.1);
    border: 1px solid rgba(0, 210, 106, 0.25);
    border-radius: 2rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--success);
    margin-bottom: 1rem;
  }

  .migrate-steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 2rem 0;
    text-align: left;
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  }

  .migrate-step {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .migrate-step-num {
    width: 2rem;
    height: 2rem;
    background: var(--accent-gradient);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .migrate-step-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .migrate-step-text strong {
    font-size: 0.9375rem;
    font-weight: 600;
  }

  .migrate-step-text span {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  /* ---- BUTTONS ---- */
  .primary-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 2rem;
    background: var(--accent-gradient);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .primary-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(250, 60, 131, 0.4);
  }

  .primary-btn svg {
    transition: transform 0.2s ease;
  }

  .primary-btn:hover svg {
    transform: translateX(3px);
  }

  .migrate-btn {
    font-size: 1.0625rem;
    padding: 1rem 2.5rem;
  }

  /* ---- DOWNLOAD SECTION ---- */
  .download-section {
    text-align: center;
  }

  .app-links {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .app-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    color: var(--text-primary);
    text-decoration: none;
    font-size: 0.8125rem;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .app-badge:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .app-links-center {
    justify-content: center;
    margin-top: 1.5rem;
  }

  /* ---- READS ---- */
  .reads-grid {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    margin-top: 1.5rem;
  }

  .read-card {
    display: flex;
    gap: 1rem;
    padding: 0.75rem;
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 1rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    text-decoration: none;
    color: inherit;
    transition: all 0.2s ease;
    overflow: hidden;
  }

  .read-card:hover {
    border-color: rgba(139, 92, 246, 0.4);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .read-img {
    width: 120px;
    height: 80px;
    border-radius: 0.625rem;
    overflow: hidden;
    flex-shrink: 0;
  }

  .read-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .read-body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    min-width: 0;
  }

  .read-body strong {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .read-body span {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .read-author {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.25rem;
  }

  .read-author-avatar {
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .read-author span {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  /* ---- FAQ ---- */
  .faq-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  .faq-item {
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 0.75rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: all 0.2s ease;
    overflow: hidden;
  }

  .faq-item:hover {
    border-color: rgba(250, 60, 131, 0.2);
  }

  .faq-item[open] {
    border-color: rgba(250, 60, 131, 0.3);
  }

  .faq-item summary {
    padding: 1rem 1.25rem;
    font-weight: 600;
    font-size: 0.9375rem;
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: color 0.2s ease;
  }

  .faq-item summary::-webkit-details-marker {
    display: none;
  }

  .faq-item summary::after {
    content: '+';
    font-size: 1.25rem;
    font-weight: 400;
    color: var(--text-muted);
    transition: all 0.2s ease;
    flex-shrink: 0;
    margin-left: 1rem;
  }

  .faq-item[open] summary::after {
    content: '\2212';
    color: var(--accent);
  }

  .faq-item summary:hover {
    color: var(--accent);
  }

  .faq-item p {
    padding: 0 1.25rem 1rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.7;
    margin: 0;
  }

  /* ---- FINAL CTA ---- */
  .final-cta {
    text-align: center;
    padding: 3rem 0;
    border-top: 1px solid var(--border);
  }

  .final-cta h2 {
    font-size: 1.75rem;
    margin-bottom: 0.5rem;
  }

  .final-cta p {
    color: var(--text-secondary);
    font-size: 1rem;
    margin-bottom: 1.5rem;
  }

  /* ---- SIGNUP ---- */
  .signup-section {
    text-align: center;
    padding: 2rem 0;
    border-top: 1px solid var(--border);
  }

  .signup-heading {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }

  .signup-form {
    display: flex;
    gap: 0.5rem;
    max-width: 400px;
    margin: 0 auto;
  }

  .signup-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--bg-glass);
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    transition: border-color 0.2s;
  }

  .signup-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.5;
  }

  .signup-input:focus {
    border-color: var(--accent);
  }

  .signup-button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
    white-space: nowrap;
  }

  .signup-button:hover {
    opacity: 0.9;
  }

  .signup-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .signup-success {
    color: var(--accent);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .signup-error {
    color: var(--error);
    font-size: 0.8125rem;
    margin-top: 0.5rem;
  }

  /* ---- FOOTER ---- */
  footer {
    text-align: center;
    padding: 2rem;
    border-top: 1px solid var(--border);
  }

  footer p {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  footer a {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.2s ease;
  }

  footer a:hover {
    color: var(--accent);
  }

  /* ---- RESPONSIVE ---- */
  @media (max-width: 640px) {
    main {
      padding: 0 1rem;
    }

    .hero {
      padding: 0.5rem 0 0.5rem;
    }

    .hero-sub {
      font-size: 0.9375rem;
    }

    .video-section {
      margin-bottom: 0.5rem;
    }

    h1 {
      font-size: 2rem;
    }

    .hero-sub {
      font-size: 1rem;
    }

    h2 {
      font-size: 1.5rem;
    }

    .chart-header,
    .chart-row {
      grid-template-columns: 110px repeat(5, 1fr);
      padding: 0.625rem 0.75rem;
    }

    .chart-header span {
      font-size: 0.5rem;
    }

    .chart-platform span {
      font-size: 0.75rem;
    }

    .chart-logo {
      width: 20px;
      height: 20px;
    }

    .chart-icon {
      width: 16px;
      height: 16px;
    }

    .mark {
      width: 24px;
      height: 24px;
    }

    .mark svg {
      width: 12px;
      height: 12px;
    }

    .mark[data-tip]::after {
      max-width: 150px;
      font-size: 0.625rem;
    }

    .quotes {
      flex-direction: row;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 0.5rem;
      scrollbar-width: none;
    }

    .quotes::-webkit-scrollbar {
      display: none;
    }

    .quote-card {
      flex: 0 0 80%;
      scroll-snap-align: center;
    }

    .quote-swipe-hint {
      display: flex;
    }

    .meme-grid {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      gap: 0.75rem;
      padding-bottom: 0.5rem;
      scrollbar-width: none;        /* Firefox */
    }

    .meme-grid::-webkit-scrollbar {
      display: none;                /* Chrome/Safari */
    }

    .meme-card {
      flex: 0 0 75%;
      scroll-snap-align: center;
    }

    .swipe-hint {
      display: flex;
      justify-content: center;
      gap: 0.375rem;
      padding-top: 0.75rem;
    }

    .swipe-hint span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      opacity: 0.3;
    }

    .swipe-hint span.active {
      opacity: 0.8;
      background: var(--accent);
    }

    .migrate-btn {
      width: 100%;
      justify-content: center;
    }

    .final-cta .primary-btn {
      width: 100%;
      justify-content: center;
    }

    .app-links {
      flex-direction: column;
    }

    .app-badge {
      justify-content: center;
    }
  }

  @media (max-width: 380px) {
    h1 {
      font-size: 1.75rem;
    }

    .hero-sub {
      font-size: 0.9375rem;
    }

    .section {
      padding: 2rem 0;
    }
  }
</style>
