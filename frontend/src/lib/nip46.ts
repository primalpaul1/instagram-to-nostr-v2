/**
 * NIP-46 (Nostr Connect) utilities for "Login with Primal" functionality.
 * Handles QR code generation and remote signing via Primal wallet.
 */

import { generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { Relay } from 'nostr-tools/relay';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import QRCode from 'qrcode';

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
  // Use dedicated lightweight callback page (like Zappix) for iOS Safari compatibility
  if (includeCallback && typeof window !== 'undefined') {
    const origin = window.location.origin;
    params.append('callback', `${origin}/login-success`);
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
  const localSecretKeyBytes = hexToBytes(localSecretKey);

  onConnecting?.();

  // Use BunkerSigner.fromURI which handles waiting for the connection
  const signer = await BunkerSigner.fromURI(
    localSecretKeyBytes,
    connectionURI,
    {}, // params
    timeoutMs
  );

  // Get the remote pubkey from the signer
  const remotePubkey = await signer.getPublicKey();

  return {
    signer,
    remotePubkey,
    localSecretKey
  };
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

// NIP-46 NostrConnect event kind
const NostrConnect = 24133;

/**
 * Sign an event directly using NIP-46 protocol without pre-established BunkerSigner.
 * Uses stored credentials from localStorage.
 */
export async function signEventDirect(
  eventToSign: Omit<Event, 'sig'>,
  timeoutMs: number = 30000
): Promise<Event> {
  const credentialsJson = localStorage.getItem('nip46_credentials');
  if (!credentialsJson) {
    throw new Error('No NIP-46 credentials found');
  }

  const { localSecretKey, remotePubkey } = JSON.parse(credentialsJson);
  const localSecretKeyBytes = hexToBytes(localSecretKey);
  const localPublicKey = getPublicKey(localSecretKeyBytes);

  const { getConversationKey, encrypt: nip44Encrypt, decrypt: nip44Decrypt } = await import('nostr-tools/nip44');
  const { finalizeEvent } = await import('nostr-tools');

  const conversationKey = getConversationKey(localSecretKeyBytes, remotePubkey);

  // Create sign_event request
  const requestId = `sign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const request = {
    id: requestId,
    method: 'sign_event',
    params: [JSON.stringify(eventToSign)]
  };

  const encryptedRequest = nip44Encrypt(JSON.stringify(request), conversationKey);

  // Create and sign the request event
  const requestEvent = finalizeEvent({
    kind: NostrConnect,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', remotePubkey]],
    content: encryptedRequest
  }, localSecretKeyBytes);

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
        cleanup();
        reject(new Error('Sign request timeout'));
      }
    }, timeoutMs);

    try {
      relay = await Relay.connect(NIP46_RELAYS[0]);

      // Subscribe for response
      const since = Math.floor(Date.now() / 1000) - 10;
      relay.subscribe([{
        kinds: [NostrConnect],
        authors: [remotePubkey],
        '#p': [localPublicKey],
        since
      }], {
        onevent: async (event: Event) => {
          if (resolved) return;

          try {
            const decrypted = nip44Decrypt(event.content, conversationKey);
            const response = JSON.parse(decrypted);

            if (response.id === requestId) {
              resolved = true;
              cleanup();

              if (response.error) {
                reject(new Error(response.error));
              } else {
                // Response contains the signed event
                const signedEvent = typeof response.result === 'string'
                  ? JSON.parse(response.result)
                  : response.result;
                resolve(signedEvent);
              }
            }
          } catch (err) {
            // Decryption failed, not our response
          }
        }
      });

      // Publish the request
      await relay.publish(requestEvent);
      console.log('[NIP46] Sign request published');

    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Wait for a NIP-46 connection response using a `since` filter.
 * This is used by the callback page to catch historical responses from Primal
 * that were sent while iOS had our WebSocket killed.
 *
 * Unlike BunkerSigner.fromURI which uses limit:0 (real-time only),
 * this uses a `since` filter to fetch recent historical events.
 */
export async function waitForConnectionResponse(
  localSecretKey: string,
  localPublicKey: string,
  secret: string,
  timeoutMs: number = 60000
): Promise<string> {
  console.log('[NIP46] waitForConnectionResponse starting');
  console.log('[NIP46] localPublicKey:', localPublicKey.slice(0, 16) + '...');
  console.log('[NIP46] secret:', secret.slice(0, 20) + '...');

  // Dynamic import to avoid SSR issues
  const { getConversationKey, decrypt: nip44Decrypt } = await import('nostr-tools/nip44');
  console.log('[NIP46] nip44 imported successfully');

  const localSecretKeyBytes = hexToBytes(localSecretKey);

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
        console.log('[NIP46] Timeout reached, events received:', eventCount);
        cleanup();
        reject(new Error(`Connection timeout (received ${eventCount} events)`));
      }
    }, timeoutMs);

    try {
      console.log('[NIP46] Connecting to relay:', NIP46_RELAYS[0]);
      relay = await Relay.connect(NIP46_RELAYS[0]);
      console.log('[NIP46] Relay connected');

      // Use `since` filter to catch historical events (last 2 minutes)
      const since = Math.floor(Date.now() / 1000) - 120;
      console.log('[NIP46] Subscribing with since:', since, '(now - 120s)');

      const filter = {
        kinds: [NostrConnect],
        '#p': [localPublicKey],
        since: since
      };
      console.log('[NIP46] Filter:', JSON.stringify(filter));

      relay.subscribe([filter], {
        onevent: async (event: Event) => {
          eventCount++;
          console.log('[NIP46] Event received #' + eventCount + ':', {
            pubkey: event.pubkey.slice(0, 16) + '...',
            created_at: event.created_at,
            content_length: event.content.length
          });

          if (resolved) return;

          try {
            // Decrypt the message using NIP-44
            const conversationKey = getConversationKey(localSecretKeyBytes, event.pubkey);
            const decrypted = nip44Decrypt(event.content, conversationKey);
            console.log('[NIP46] Decrypted:', decrypted.slice(0, 100) + '...');

            const response = JSON.parse(decrypted);
            console.log('[NIP46] Response result:', response.result?.slice(0, 20) + '...');

            // Check if this is the connection acknowledgment with our secret
            if (response.result === secret) {
              console.log('[NIP46] Secret matched! Remote pubkey:', event.pubkey);
              resolved = true;
              cleanup();
              resolve(event.pubkey);
              return;
            } else {
              console.log('[NIP46] Secret mismatch, expected:', secret.slice(0, 20) + '...');
            }
          } catch (decryptErr) {
            console.log('[NIP46] Decrypt/parse failed:', decryptErr);
          }
        },
        oneose: () => {
          console.log('[NIP46] EOSE received, continuing to listen...');
        }
      });
    } catch (err) {
      console.error('[NIP46] Error:', err);
      cleanup();
      reject(err);
    }
  });
}
