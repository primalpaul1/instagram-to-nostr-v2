/**
 * NIP-04 DM utilities for sending claim link notifications.
 * Uses a service account to send DMs to users with their claim links.
 */

import { getPublicKey, finalizeEvent, type Event } from 'nostr-tools';
import { nip04, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { env } from '$env/dynamic/private';

const NOSTR_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol'
];

/**
 * Publish an event to a single relay.
 */
async function publishToRelay(relayUrl: string, event: Event): Promise<boolean> {
  const WebSocket = (await import('ws')).default;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 5000);

    const ws = new WebSocket(relayUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', event]));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK' && msg[1] === event.id) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg[2] === true);
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      ws.close();
      resolve(false);
    });
  });
}

/**
 * Send a NIP-04 DM with the claim link to a user.
 * Fire-and-forget - logs errors but doesn't throw.
 *
 * @param recipientPubkeyHex - The recipient's public key in hex format
 * @param claimUrl - The full claim URL to send
 */
export async function sendClaimLinkDM(
  recipientPubkeyHex: string,
  claimUrl: string
): Promise<void> {
  const serviceNsec = env.NOSTR_SERVICE_NSEC;

  if (!serviceNsec) {
    console.log('[Nostr DM] NOSTR_SERVICE_NSEC not configured, skipping DM');
    return;
  }

  try {
    // Decode nsec to get secret key bytes
    const decoded = nip19.decode(serviceNsec);
    if (decoded.type !== 'nsec') {
      console.error('[Nostr DM] Invalid NOSTR_SERVICE_NSEC format');
      return;
    }
    const serviceSecKeyBytes = decoded.data as Uint8Array;
    const servicePubKey = getPublicKey(serviceSecKeyBytes);

    const message = `Your content is being prepared for Nostr!

When it's ready, claim it here:
${claimUrl}

This usually takes just a few minutes.

- OwnYourPosts.com`;

    // Encrypt message using NIP-04
    const ciphertext = await nip04.encrypt(serviceSecKeyBytes, recipientPubkeyHex, message);

    // Create and sign the DM event
    const event = finalizeEvent({
      kind: 4, // NIP-04 DM
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', recipientPubkeyHex]],
      content: ciphertext
    }, serviceSecKeyBytes);

    console.log('[Nostr DM] Sending claim link DM to:', recipientPubkeyHex.slice(0, 16) + '...');

    // Publish to relays (fire and forget)
    const results = await Promise.allSettled(
      NOSTR_RELAYS.map(url => publishToRelay(url, event))
    );

    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value === true
    ).length;

    console.log(`[Nostr DM] Published to ${successCount}/${NOSTR_RELAYS.length} relays`);
  } catch (err) {
    console.error('[Nostr DM] Failed to send DM:', err);
    // Don't throw - this is fire-and-forget
  }
}
