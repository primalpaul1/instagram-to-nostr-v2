/**
 * NIP-46 (Nostr Connect) utilities for "Login with Primal" functionality.
 * Handles QR code generation and remote signing via Primal wallet.
 */

import { generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import QRCode from 'qrcode';

// NIP-46 relays - matching xnostr.com's working implementation
const NIP46_RELAYS = [
  'wss://relay.bullishbounty.com',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://bucket.coracle.social'
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
 * Using 8 hex chars (like Zappix) for shorter URI - sufficient for short-lived connection.
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
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
