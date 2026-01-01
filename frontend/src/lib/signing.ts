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
  let createdAt = Math.floor(Date.now() / 1000);
  if (video.originalDate) {
    try {
      const date = new Date(video.originalDate);
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
