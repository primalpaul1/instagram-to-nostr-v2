/**
 * NIP-46 (Nostr Connect) utilities for "Login with Primal" functionality.
 * Handles QR code generation and remote signing via Primal wallet.
 */

import { generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools';
import { BunkerSigner } from 'nostr-tools/nip46';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as QRCode from 'qrcode';

// Default relays for NIP-46 communication
const NIP46_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://relay.nsec.app'
];

export interface NIP46Connection {
  signer: BunkerSigner;
  remotePubkey: string;
  localSecretKey: string;
}

/**
 * Generate a nostrconnect:// URI for QR code display.
 * User scans this with Primal to establish connection.
 */
export function createConnectionURI(localPubkey: string, secret: string): string {
  const relayParams = NIP46_RELAYS.map(r => `relay=${encodeURIComponent(r)}`).join('&');
  const perms = 'sign_event:0,sign_event:1,sign_event:24242';

  return `nostrconnect://${localPubkey}?${relayParams}&secret=${secret}&name=${encodeURIComponent('Instagram to Nostr')}&perms=${encodeURIComponent(perms)}`;
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
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
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
  onConnecting?: () => void,
  timeoutMs: number = 300000 // 5 minutes
): Promise<NIP46Connection> {
  const localSecretKeyBytes = hexToBytes(localSecretKey);
  const localPubkey = getPublicKey(localSecretKeyBytes);

  // Create the bunker signer which will listen for incoming connection
  const bunkerSigner = new BunkerSigner(
    localSecretKeyBytes,
    NIP46_RELAYS
  );

  onConnecting?.();

  // Wait for connection with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout - please try again')), timeoutMs);
  });

  const connectionPromise = bunkerSigner.waitForBunkerAuth(secret);

  try {
    const remotePubkey = await Promise.race([connectionPromise, timeoutPromise]);

    return {
      signer: bunkerSigner,
      remotePubkey,
      localSecretKey
    };
  } catch (error) {
    bunkerSigner.close();
    throw error;
  }
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
 * Close the NIP-46 connection and cleanup resources.
 */
export function closeConnection(connection: NIP46Connection | null): void {
  if (connection?.signer) {
    connection.signer.close();
  }
}
