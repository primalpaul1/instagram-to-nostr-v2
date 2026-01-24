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
  // Point callback back to current page - iOS Safari might resume the existing page
  // with WebSocket still connected, allowing BunkerSigner to receive the ACK
  if (includeCallback && typeof window !== 'undefined') {
    params.append('callback', window.location.href);
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

/**
 * Wait for a NIP-46 connection response using a `since` filter.
 * This catches historical ACK events that BunkerSigner.fromURI misses
 * (it uses limit:0 which only gets real-time events).
 *
 * Used after iOS Safari redirect when the original WebSocket was killed.
 */
export async function waitForConnectionResponse(
  localSecretKey: string,
  localPublicKey: string,
  secret: string,
  timeoutMs: number = 30000
): Promise<string> {
  const { getConversationKey, decrypt: nip44Decrypt } = await import('nostr-tools/nip44');

  const localSecretKeyBytes = hexToBytes(localSecretKey);

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
        reject(new Error('Connection timeout'));
      }
    }, timeoutMs);

    try {
      relay = await Relay.connect(NIP46_RELAYS[0]);

      // Use `since` filter to catch historical events (last 2 minutes)
      const since = Math.floor(Date.now() / 1000) - 120;

      relay.subscribe([{
        kinds: [NostrConnect],
        '#p': [localPublicKey],
        since: since
      }], {
        onevent: async (event: Event) => {
          if (resolved) return;

          try {
            const conversationKey = getConversationKey(localSecretKeyBytes, event.pubkey);
            const decrypted = nip44Decrypt(event.content, conversationKey);
            const response = JSON.parse(decrypted);

            // Check if this is the connection ACK with our secret
            if (response.result === secret) {
              resolved = true;
              cleanup();
              resolve(event.pubkey);
            }
          } catch {
            // Decryption failed, not our response
          }
        }
      });
    } catch (err) {
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

  // Create BunkerSigner directly with known remote pubkey
  const signer = new BunkerSigner(localSecretKeyBytes, remotePubkey, NIP46_RELAYS);

  // Connect to relay (this doesn't wait for ACK since we already have remote pubkey)
  await signer.connect();

  return {
    signer,
    remotePubkey,
    localSecretKey
  };
}

