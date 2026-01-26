/**
 * NIP-46 (Nostr Connect) utilities for "Login with Primal" functionality.
 * Handles QR code generation and remote signing via Primal wallet.
 */

import { generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools';
import { BunkerSigner } from 'nostr-tools/nip46';
import { Relay } from 'nostr-tools/relay';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import QRCode from 'qrcode';

// NIP-46 NostrConnect event kind
const NostrConnect = 24133;

// NIP-46 relay - using relay.primal.net like Primal's own web app
const NIP46_RELAYS = [
  'wss://relay.primal.net'
];

export interface NIP46Connection {
  signer: BunkerSigner;
  remotePubkey: string;
  localSecretKey: string;
}

/**
 * Generate a nostrconnect:// URI for QR code display.
 * User scans this with Primal to establish connection.
 * @param includeCallback - Whether to include callback URL (only for mobile deep link, not QR codes)
 */
export function createConnectionURI(
  localPubkey: string,
  secret: string,
  includeCallback: boolean = false
): string {
  const params = new URLSearchParams();

  // Add each relay as separate param (like xnostr does)
  NIP46_RELAYS.forEach(relay => params.append('relay', relay));

  params.append('secret', secret);
  params.append('name', 'Own Your Posts');
  params.append('url', 'https://ownyourposts.com');
  params.append('image', 'https://ownyourposts.com/logo.png');

  // Only include callback for mobile deep link button, not QR codes
  // Primal will redirect back to this URL after user approves
  if (includeCallback && typeof window !== 'undefined') {
    // Use a dedicated callback path (like ZapTrax's /remoteloginsuccess)
    params.append('callback', `${window.location.origin}/login-callback`);
  }

  return `nostrconnect://${localPubkey}?${params.toString()}`;
}

/**
 * Generate QR code data URL from a nostrconnect URI.
 */
export async function generateQRCode(uri: string): Promise<string> {
  return await QRCode.toDataURL(uri, {
    width: 280,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
}

/**
 * Generate a random secret for NIP-46 connection.
 * Using UUID-style format like Primal's web app: sec-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = bytesToHex(bytes);
  // Format as UUID-style: sec-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `sec-${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

/**
 * Generate a new local keypair for NIP-46 client.
 */
export function generateLocalKeypair(): { secretKey: string; publicKey: string } {
  const secretKeyBytes = generateSecretKey();
  const secretKey = bytesToHex(secretKeyBytes);
  const publicKey = getPublicKey(secretKeyBytes);
  return { secretKey, publicKey };
}

/**
 * Wait for a NIP-46 connection from Primal.
 * Returns when user scans QR code and approves connection.
 */
export async function waitForConnection(
  localSecretKey: string,
  secret: string,
  connectionURI: string,
  onConnecting?: () => void,
  timeoutMs: number = 300000 // 5 minutes
): Promise<NIP46Connection> {
  const { getConversationKey, decrypt: nip44Decrypt } = await import('nostr-tools/nip44');

  const localSecretKeyBytes = hexToBytes(localSecretKey);
  const localPublicKey = getPublicKey(localSecretKeyBytes);

  console.log('[NIP46-QR] Starting waitForConnection (ZapTrax-style)');
  console.log('[NIP46-QR] Local pubkey:', localPublicKey.slice(0, 16) + '...');
  console.log('[NIP46-QR] Timeout:', timeoutMs, 'ms');

  onConnecting?.();

  return new Promise(async (resolve, reject) => {
    let relay: Relay | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;
    let resolved = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (relay) {
        try { relay.close(); } catch {}
      }
    };

    timeoutId = setTimeout(() => {
      if (!resolved) {
        console.log('[NIP46-QR] Timeout waiting for connection');
        cleanup();
        reject(new Error('Connection timeout'));
      }
    }, timeoutMs);

    try {
      console.log('[NIP46-QR] Connecting to relay:', NIP46_RELAYS[0]);
      relay = await Relay.connect(NIP46_RELAYS[0]);
      console.log('[NIP46-QR] Connected to relay, subscribing...');

      // Subscribe to NIP-46 events tagged to our local pubkey
      relay.subscribe([{
        kinds: [NostrConnect],
        '#p': [localPublicKey],
        limit: 0 // Only real-time events
      }], {
        onevent: async (event: Event) => {
          console.log('[NIP46-QR] Event received from:', event.pubkey.slice(0, 16) + '...');

          if (resolved) return;

          // Verify #p tag
          const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
          if (!pTags.includes(localPublicKey)) {
            console.log('[NIP46-QR] Event not tagged to us, skipping');
            return;
          }

          try {
            // Decrypt the response
            const conversationKey = getConversationKey(localSecretKeyBytes, event.pubkey);
            const decrypted = nip44Decrypt(event.content, conversationKey);
            console.log('[NIP46-QR] Decrypted:', decrypted.slice(0, 100));

            const response = JSON.parse(decrypted);

            // Check if this is the connection ACK
            if (response.result === secret || response.result === 'ack' || response.result === true) {
              console.log('[NIP46-QR] SUCCESS! Got ACK from:', event.pubkey.slice(0, 16) + '...');

              resolved = true;

              // event.pubkey is the BUNKER's pubkey (signing service), not necessarily the user's pubkey
              const bunkerPubkey = event.pubkey;
              console.log('[NIP46-QR] Bunker pubkey:', bunkerPubkey.slice(0, 16) + '...');

              // Create BunkerSigner with the bunker pubkey
              const bunkerPointer = {
                pubkey: bunkerPubkey,
                relays: NIP46_RELAYS
              };
              const signer = BunkerSigner.fromBunker(localSecretKeyBytes, bunkerPointer, {});

              // Now get the ACTUAL user pubkey via NIP-46 RPC
              console.log('[NIP46-QR] Getting actual user pubkey via getPublicKey()...');
              try {
                const userPubkey = await signer.getPublicKey();
                console.log('[NIP46-QR] User pubkey:', userPubkey.slice(0, 16) + '...');

                cleanup();
                resolve({
                  signer,
                  remotePubkey: userPubkey,
                  localSecretKey
                });
              } catch (err) {
                console.error('[NIP46-QR] getPublicKey() failed:', err);
                // Fall back to bunker pubkey if getPublicKey fails
                cleanup();
                resolve({
                  signer,
                  remotePubkey: bunkerPubkey,
                  localSecretKey
                });
              }
            }
          } catch (err) {
            console.log('[NIP46-QR] Failed to decrypt event:', err);
          }
        },
        oneose: () => {
          console.log('[NIP46-QR] EOSE received, waiting for real-time events...');
        }
      });
    } catch (err) {
      console.error('[NIP46-QR] Connection error:', err);
      cleanup();
      reject(err);
    }
  });
}

/**
 * Sign an event using the NIP-46 connection.
 */
export async function signEvent(
  connection: NIP46Connection,
  event: Partial<Event>
): Promise<Event> {
  return await connection.signer.signEvent(event as Event);
}

/**
 * Get the npub for a hex public key.
 */
export function hexToNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex);
}

/**
 * Get the hex pubkey from an npub.
 */
export function npubToHex(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') {
      return decoded.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Close the NIP-46 connection and cleanup resources.
 */
export function closeConnection(connection: NIP46Connection | null): void {
  if (connection?.signer) {
    connection.signer.close();
  }
}

/**
 * Wait for a NIP-46 connection response using `since` filter.
 * This catches historical ACK events that BunkerSigner.fromURI misses
 * (it uses limit:0 which only gets real-time events).
 *
 * Used after iOS Safari redirect when the original WebSocket was killed.
 * Returns the actual USER pubkey (not the bunker pubkey).
 */
export async function waitForConnectionResponse(
  localSecretKey: string,
  localPublicKey: string,
  secret: string,
  timeoutMs: number = 30000
): Promise<string> {
  const { getConversationKey, decrypt: nip44Decrypt } = await import('nostr-tools/nip44');

  const localSecretKeyBytes = hexToBytes(localSecretKey);

  console.log('[NIP46-Recovery] Starting waitForConnectionResponse');
  console.log('[NIP46-Recovery] Local pubkey:', localPublicKey.slice(0, 16) + '...');
  console.log('[NIP46-Recovery] Looking for secret:', secret.slice(0, 20) + '...');
  console.log('[NIP46-Recovery] Timeout:', timeoutMs, 'ms');

  return new Promise(async (resolve, reject) => {
    let relay: Relay | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;
    let resolved = false;
    let eventCount = 0;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (relay) {
        try { relay.close(); } catch {}
      }
    };

    timeoutId = setTimeout(() => {
      if (!resolved) {
        console.log('[NIP46-Recovery] Timeout after', eventCount, 'events checked');
        cleanup();
        reject(new Error('Connection timeout - no ACK found'));
      }
    }, timeoutMs);

    try {
      console.log('[NIP46-Recovery] Connecting to relay:', NIP46_RELAYS[0]);
      relay = await Relay.connect(NIP46_RELAYS[0]);
      console.log('[NIP46-Recovery] Connected to relay');

      // Use since filter to catch events from last 5 minutes
      // Extend window in case of slow relay response
      const since = Math.floor(Date.now() / 1000) - 300;

      console.log('[NIP46-Recovery] Subscribing with since:', since, '(5 min ago)');

      relay.subscribe([{
        kinds: [NostrConnect],
        '#p': [localPublicKey],
        since: since
      }], {
        onevent: async (event: Event) => {
          eventCount++;
          console.log('[NIP46-Recovery] Event #' + eventCount, 'from:', event.pubkey.slice(0, 16) + '...', 'at:', new Date(event.created_at * 1000).toISOString());

          if (resolved) return;

          // VERIFY: Event must be tagged to OUR localPublicKey
          // Don't trust relay filtering - verify the #p tag explicitly
          const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
          if (!pTags.includes(localPublicKey)) {
            console.log('[NIP46-Recovery] Event not tagged to our pubkey, skipping');
            return;
          }

          try {
            const conversationKey = getConversationKey(localSecretKeyBytes, event.pubkey);
            const decrypted = nip44Decrypt(event.content, conversationKey);
            console.log('[NIP46-Recovery] Decrypted content:', decrypted.slice(0, 150));
            const response = JSON.parse(decrypted);
            console.log('[NIP46-Recovery] Response:', JSON.stringify(response).slice(0, 100));

            // Check if this is the connection ACK
            // Primal may send: the exact secret, "ack", or the response may contain other fields
            // Be more lenient in accepting the connection
            const result = response.result;
            if (result === secret || result === 'ack' || result === true || result === 'true') {
              console.log('[NIP46-Recovery] SUCCESS! Found matching ACK, result:', result);

              resolved = true;

              // event.pubkey is the BUNKER's pubkey (signing service), not the user's pubkey
              const bunkerPubkey = event.pubkey;
              console.log('[NIP46-Recovery] Bunker pubkey:', bunkerPubkey.slice(0, 16) + '...');

              // Create BunkerSigner with the bunker pubkey to get actual user pubkey
              const bunkerPointer = {
                pubkey: bunkerPubkey,
                relays: NIP46_RELAYS
              };
              const signer = BunkerSigner.fromBunker(localSecretKeyBytes, bunkerPointer, {});

              // Get the ACTUAL user pubkey via NIP-46 RPC
              console.log('[NIP46-Recovery] Getting actual user pubkey via getPublicKey()...');
              try {
                const userPubkey = await signer.getPublicKey();
                console.log('[NIP46-Recovery] User pubkey:', userPubkey.slice(0, 16) + '...');
                signer.close();
                cleanup();
                resolve(userPubkey);
              } catch (err) {
                console.error('[NIP46-Recovery] getPublicKey() failed:', err);
                // Fall back to bunker pubkey if getPublicKey fails
                signer.close();
                cleanup();
                resolve(bunkerPubkey);
              }
            } else if (response.error) {
              console.log('[NIP46-Recovery] Error response:', response.error);
            } else {
              console.log('[NIP46-Recovery] Non-matching result:', result);
            }
          } catch (err) {
            // Decryption failure might mean this event is from a different session
            console.log('[NIP46-Recovery] Decrypt failed (might be from different session):', err);
          }
        },
        oneose: () => {
          console.log('[NIP46-Recovery] EOSE received after', eventCount, 'events');
          // After EOSE, if we haven't found the ACK, keep subscription open
          // in case it arrives later (real-time)
        }
      });
    } catch (err) {
      console.error('[NIP46-Recovery] Connection error:', err);
      cleanup();
      reject(err);
    }
  });
}

/**
 * Create a BunkerSigner when we already know the remote pubkey.
 * Used after recovering connection from iOS Safari redirect.
 */
export async function createSignerWithKnownPubkey(
  localSecretKey: string,
  remotePubkey: string
): Promise<NIP46Connection> {
  const localSecretKeyBytes = hexToBytes(localSecretKey);

  // Create BunkerPointer object - the format expected by fromBunker
  const bunkerPointer = {
    pubkey: remotePubkey,
    relays: NIP46_RELAYS
  };

  // Use fromBunker static method which properly sets up bp and subscription
  // This is required because the constructor doesn't set this.bp
  const signer = BunkerSigner.fromBunker(localSecretKeyBytes, bunkerPointer, {});

  // Connection is already established (we received the ACK), so we're ready to use

  return {
    signer,
    remotePubkey,
    localSecretKey
  };
}

