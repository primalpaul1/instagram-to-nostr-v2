/**
 * Signing utilities for Nostr events.
 * Used for NIP-46 mode where signing happens via remote signer (Primal).
 */

import type { Event } from 'nostr-tools';
import type { NIP46Connection } from './nip46';

// Blossom auth kind
const BLOSSOM_AUTH_KIND = 24242;

// Default relays for publishing
export const NOSTR_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol'
];

// Primal cache server for direct import
export const PRIMAL_CACHE_URL = 'wss://cache1.primal.net/v1';

export interface VideoMetadata {
  url: string;
  sha256: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  caption?: string;
  originalDate?: string;
}

export interface MediaUpload {
  url: string;  // Blossom URL after upload
  sha256: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

/**
 * Create a Blossom auth event template for upload authorization.
 * Kind 24242 with upload tag and sha256.
 */
export function createBlossomAuthEvent(
  pubkey: string,
  sha256: string,
  size: number
): Omit<Event, 'sig'> {
  const now = Math.floor(Date.now() / 1000);
  // Expiration: 5 minutes from now
  const expiration = now + 300;

  return {
    kind: BLOSSOM_AUTH_KIND,
    pubkey,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['size', size.toString()],
      ['expiration', expiration.toString()]
    ],
    content: `Upload ${sha256}`,
    id: '' // Will be filled by signer
  };
}

/**
 * Create a video post event template (kind 1 with imeta tags).
 */
export function createVideoPostEvent(
  pubkey: string,
  video: VideoMetadata,
  blossomUrl: string
): Omit<Event, 'sig'> {
  // Build imeta tag with all video metadata
  const imetaParts = [
    `url ${blossomUrl}`,
    `m ${video.mimeType}`,
    `x ${video.sha256}`,
    `size ${video.size}`
  ];

  if (video.width && video.height) {
    imetaParts.push(`dim ${video.width}x${video.height}`);
  }

  // Build content with caption
  let content = video.caption || '';

  // Add video URL at the end
  if (content) {
    content += '\n\n';
  }
  content += blossomUrl;

  // Parse original date for created_at timestamp
  // Dates from backend are in ISO format without timezone, treat as UTC
  let createdAt = Math.floor(Date.now() / 1000);
  if (video.originalDate) {
    try {
      // Append 'Z' if no timezone specified to parse as UTC
      const dateStr = video.originalDate.includes('Z') || video.originalDate.includes('+') || video.originalDate.includes('-', 10)
        ? video.originalDate
        : video.originalDate + 'Z';
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        createdAt = Math.floor(date.getTime() / 1000);
      }
    } catch {
      // Use current time if parsing fails
    }
  }

  return {
    kind: 1,
    pubkey,
    created_at: createdAt,
    tags: [
      ['imeta', ...imetaParts]
    ],
    content,
    id: '' // Will be filled by signer
  };
}

/**
 * Create a post event with multiple media items (kind 1 with multiple imeta tags).
 * Used for carousels and multi-media posts.
 */
export function createMultiMediaPostEvent(
  pubkey: string,
  mediaUploads: MediaUpload[],
  caption?: string,
  originalDate?: string
): Omit<Event, 'sig'> {
  // Build imeta tags for each media item
  const tags: string[][] = [];
  const urls: string[] = [];

  for (const media of mediaUploads) {
    const imetaParts = [
      'imeta',
      `url ${media.url}`,
      `m ${media.mimeType}`,
      `x ${media.sha256}`,
      `size ${media.size}`
    ];

    if (media.width && media.height) {
      imetaParts.push(`dim ${media.width}x${media.height}`);
    }

    tags.push(imetaParts);
    urls.push(media.url);
  }

  // Build content with caption and all URLs
  let content = caption || '';
  if (content && urls.length > 0) {
    content += '\n\n';
  }
  content += urls.join('\n');

  // Parse original date for created_at timestamp
  let createdAt = Math.floor(Date.now() / 1000);
  if (originalDate) {
    try {
      const dateStr = originalDate.includes('Z') || originalDate.includes('+') || originalDate.includes('-', 10)
        ? originalDate
        : originalDate + 'Z';
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        createdAt = Math.floor(date.getTime() / 1000);
      }
    } catch {
      // Use current time if parsing fails
    }
  }

  return {
    kind: 1,
    pubkey,
    created_at: createdAt,
    tags,
    content,
    id: '' // Will be filled by signer
  };
}

/**
 * Create a profile metadata event (kind 0).
 */
export function createProfileEvent(
  pubkey: string,
  name: string,
  about?: string,
  picture?: string
): Omit<Event, 'sig'> {
  const metadata: Record<string, string> = { name };

  if (about) {
    metadata.about = about;
  }

  if (picture) {
    metadata.picture = picture;
  }

  return {
    kind: 0,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(metadata),
    id: '' // Will be filled by signer
  };
}

export interface ArticleMetadata {
  identifier: string;  // d-tag (URL slug)
  title: string;
  summary?: string;
  imageUrl?: string;   // Blossom URL for header image
  publishedAt?: string; // Unix timestamp as string
  hashtags?: string[];
  content: string;     // Markdown content
}

/**
 * Create a long-form content event (NIP-23 kind 30023).
 * These are addressable, replaceable events with d-tag.
 * Optimized for display on Primal's Reads feed.
 */
export function createLongFormContentEvent(
  pubkey: string,
  article: ArticleMetadata
): Omit<Event, 'sig'> {
  const tags: string[][] = [
    ['d', article.identifier],
    ['title', article.title],
  ];

  // Summary for Primal feed preview
  if (article.summary) {
    tags.push(['summary', article.summary]);
  }

  // Header image for Primal display
  if (article.imageUrl) {
    tags.push(['image', article.imageUrl]);
  }

  // Hashtags as t-tags for discoverability
  if (article.hashtags) {
    for (const tag of article.hashtags) {
      const cleanTag = tag.toLowerCase().replace(/^#/, '').trim();
      if (cleanTag) {
        tags.push(['t', cleanTag]);
      }
    }
  }

  // Parse created_at from published_at or use current time
  let createdAt = Math.floor(Date.now() / 1000);
  if (article.publishedAt) {
    const timestamp = parseInt(article.publishedAt, 10);
    if (!isNaN(timestamp)) {
      createdAt = timestamp;
    }
  }

  // Always add published_at tag (required by Primal for indexing)
  tags.push(['published_at', createdAt.toString()]);

  return {
    kind: 30023,
    pubkey,
    created_at: createdAt,
    tags,
    content: article.content,  // Pure Markdown
    id: '' // Will be filled by signer
  };
}

/**
 * Sign an event using NIP-46 connection.
 */
export async function signWithNIP46(
  connection: NIP46Connection,
  event: Omit<Event, 'sig'>
): Promise<Event> {
  return await connection.signer.signEvent(event as Event);
}

/**
 * Generate Authorization header for Blossom upload from signed event.
 */
export function createBlossomAuthHeader(signedEvent: Event): string {
  // Base64 encode the signed event JSON
  const eventJson = JSON.stringify(signedEvent);
  const base64 = btoa(eventJson);
  return `Nostr ${base64}`;
}

/**
 * Calculate SHA256 hash of video content.
 */
export async function calculateSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Publish a signed event to multiple relays.
 */
export async function publishToRelays(
  event: Event,
  relays: string[] = NOSTR_RELAYS
): Promise<{ success: string[]; failed: string[] }> {
  const results = { success: [] as string[], failed: [] as string[] };

  await Promise.allSettled(
    relays.map(async (relay) => {
      try {
        const ws = new WebSocket(relay);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timeout'));
          }, 10000);

          ws.onopen = () => {
            ws.send(JSON.stringify(['EVENT', event]));
          };

          ws.onmessage = (msg) => {
            try {
              const data = JSON.parse(msg.data);
              if (data[0] === 'OK' && data[1] === event.id) {
                clearTimeout(timeout);
                ws.close();
                if (data[2] === true) {
                  results.success.push(relay);
                  resolve();
                } else {
                  reject(new Error(data[3] || 'Relay rejected event'));
                }
              }
            } catch {
              // Ignore parse errors
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('WebSocket error'));
          };
        });
      } catch {
        results.failed.push(relay);
      }
    })
  );

  return results;
}

/**
 * Import a single event to Primal's cache server immediately.
 * Used for fast publishing where each event should appear in Primal right away.
 * Returns quickly with a short timeout.
 */
export async function importSingleToPrimalCache(event: Event): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(PRIMAL_CACHE_URL);
      const subId = Math.random().toString(36).substring(2, 14);

      // Short timeout for single event - 3 seconds
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 3000);

      ws.onopen = () => {
        // Send both import_events and direct EVENT for best coverage
        const importMessage = JSON.stringify([
          'REQ',
          subId,
          { cache: ['import_events', { events: [event] }] }
        ]);
        ws.send(importMessage);
        ws.send(JSON.stringify(['EVENT', event]));
      };

      ws.onmessage = () => {
        // Got a response - consider it successful
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

/**
 * Import events directly to Primal's cache server.
 * This ensures events appear in Primal immediately, even with old timestamps.
 * Tries multiple methods: import_events API and direct EVENT broadcast.
 */
export async function importToPrimalCache(events: Event[]): Promise<boolean> {
  if (events.length === 0) return false;

  // Try both methods in parallel - they're independent and we just need one to succeed
  const [importResult, eventResult] = await Promise.all([
    sendImportEvents(events).catch(() => false),
    sendEventsToCache(events).catch(() => false)
  ]);

  return importResult || eventResult;
}

async function sendImportEvents(events: Event[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(PRIMAL_CACHE_URL);
      const subId = Math.random().toString(36).substring(2, 14);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 10000);

      ws.onopen = () => {
        const message = JSON.stringify([
          'REQ',
          subId,
          { cache: ['import_events', { events }] }
        ]);
        ws.send(message);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          console.log('Primal import_events response:', data);
          ws.send(JSON.stringify(['CLOSE', subId]));
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        } catch {
          // Ignore
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

async function sendEventsToCache(events: Event[]): Promise<boolean> {
  // Send events as standard EVENT messages to the cache server
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(PRIMAL_CACHE_URL);
      let sentCount = 0;

      const timeout = setTimeout(() => {
        ws.close();
        resolve(sentCount > 0);
      }, 10000);

      ws.onopen = () => {
        for (const event of events) {
          ws.send(JSON.stringify(['EVENT', event]));
          sentCount++;
        }
        console.log(`Sent ${sentCount} events to Primal cache`);

        // Give it a moment to process
        setTimeout(() => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }, 1000);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}
