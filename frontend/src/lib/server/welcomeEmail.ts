import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

// Welcome email sent once, when an address is first added to the subscribers list.
// Copy depends on where they signed up: ownyourposts.com or paulinthejungle.com.

const BASE_URL = env.BASE_URL || 'https://ownyourposts.com';

export function unsubscribeToken(email: string): string {
  return createHmac('sha256', `${env.ADMIN_KEY}:unsubscribe`).update(email).digest('hex');
}

export function isValidUnsubscribeToken(email: string, token: string): boolean {
  if (!env.ADMIN_KEY || !/^[0-9a-f]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(unsubscribeToken(email), 'hex'), Buffer.from(token, 'hex'));
}

function unsubscribeUrl(email: string): string {
  return `${BASE_URL}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
}

interface WelcomeCopy {
  from: string;
  replyTo?: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  links: Array<{ label: string; url: string }>;
  signoff: string;
  signedUpAt: string;
}

function copyFor(source: string): WelcomeCopy {
  if (source.startsWith('paulinthejungle')) {
    return {
      from: 'Paul <paul@ownyourposts.com>',
      replyTo: 'paul@primal.net',
      subject: "You're on the list",
      heading: "Hey, it's Paul",
      paragraphs: [
        "Thanks for signing up. I'll send you the good stuff: new guides, the bitcoin and freedom tech I actually use, and what I'm learning out here in the jungle.",
        "No spam, and I'll never share your email."
      ],
      links: [
        { label: 'Start with the Bitcoin Guide', url: 'https://paulinthejungle.com' },
        { label: 'Watch Hummingbird, our film', url: 'https://hummingbirdfilm.com' },
        { label: 'Follow me on Primal', url: 'https://primal.net/paul' }
      ],
      signoff: 'Paul',
      signedUpAt: 'paulinthejungle.com'
    };
  }
  return {
    from: 'Own Your Posts <notify@ownyourposts.com>',
    subject: "You're on the list",
    heading: 'Thanks for subscribing',
    paragraphs: [
      "You'll get the occasional update on Primal and on owning your content: new features here, and tips for bringing your audience to Nostr.",
      'No spam, and we never share your email.'
    ],
    links: [
      { label: 'Why Primal?', url: 'https://ownyourposts.com/whyprimal' },
      { label: 'Bring your Instagram over', url: 'https://ownyourposts.com' }
    ],
    signoff: 'The Own Your Posts team',
    signedUpAt: 'ownyourposts.com'
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHtml(c: WelcomeCopy, unsubscribe: string): string {
  const paragraphs = c.paragraphs
    .map((p) => `<p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">${escapeHtml(p)}</p>`)
    .join('\n  ');
  const links = c.links
    .map((l) => `<li style="margin: 0 0 8px;"><a href="${l.url}" style="color: #1b7ff5; text-decoration: none; font-weight: 600;">${escapeHtml(l.label)} &rarr;</a></li>`)
    .join('\n    ');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h2 style="margin: 0 0 14px;">${escapeHtml(c.heading)}</h2>
  ${paragraphs}
  <ul style="list-style: none; padding: 0; margin: 20px 0;">
    ${links}
  </ul>
  <p style="color: #444; font-size: 15px; margin: 0;">&mdash; ${escapeHtml(c.signoff)}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #999; font-size: 12px; line-height: 1.5;">
    You're getting this because you signed up at ${escapeHtml(c.signedUpAt)}.
    <a href="${unsubscribe}" style="color: #999;">Unsubscribe</a>
  </p>
</body>
</html>`;
}

function renderText(c: WelcomeCopy, unsubscribe: string): string {
  return [
    c.heading,
    '',
    ...c.paragraphs.flatMap((p) => [p, '']),
    ...c.links.map((l) => `${l.label}: ${l.url}`),
    '',
    `- ${c.signoff}`,
    '',
    `You're getting this because you signed up at ${c.signedUpAt}.`,
    `Unsubscribe: ${unsubscribe}`
  ].join('\n');
}

export async function sendWelcomeEmail(email: string, source: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[Email] RESEND_API_KEY not set, skipping welcome email to ${email}`);
    return false;
  }

  const c = copyFor(source);
  const unsubscribe = unsubscribeUrl(email);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: c.from,
        ...(c.replyTo ? { reply_to: c.replyTo } : {}),
        to: [email],
        subject: c.subject,
        html: renderHtml(c, unsubscribe),
        text: renderText(c, unsubscribe),
        headers: { 'List-Unsubscribe': `<${unsubscribe}>` }
      })
    });
    if (response.ok) {
      console.log(`[Email] Sent welcome email to ${email} (${source})`);
      return true;
    }
    console.log(`[Email] Welcome email to ${email} failed: ${response.status} ${await response.text()}`);
    return false;
  } catch (e) {
    console.log(`[Email] Error sending welcome email to ${email}: ${e}`);
    return false;
  }
}
