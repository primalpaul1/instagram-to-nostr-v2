/**
 * Key derivation utilities for deterministic Nostr key generation.
 * Used in the gift flow where recipients choose a password to derive their key.
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

// PBKDF2 iterations - higher = more secure but slower
// 100,000 iterations takes ~100-200ms which is acceptable for user experience
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a 32-byte private key from password + Instagram handle + salt.
 * Uses PBKDF2 with SHA-256 for key stretching.
 *
 * @param password - User's chosen password
 * @param igHandle - Instagram handle (used as part of the salt)
 * @param salt - Random salt stored with the gift
 * @returns Private key as hex string
 */
export function derivePrivateKey(password: string, igHandle: string, salt: string): string {
  // Combine handle and salt for the PBKDF2 salt
  const combinedSalt = `${igHandle.toLowerCase()}:${salt}`;

  // Derive 32 bytes using PBKDF2
  const derived = pbkdf2(
    sha256,
    password,
    combinedSalt,
    { c: PBKDF2_ITERATIONS, dkLen: 32 }
  );

  return bytesToHex(derived);
}

/**
 * Generate a complete keypair from password + handle + salt.
 * Returns both hex and bech32 (npub/nsec) formats.
 */
export interface DerivedKeypair {
  privateKeyHex: string;
  publicKeyHex: string;
  nsec: string;
  npub: string;
}

export function deriveKeypair(password: string, igHandle: string, salt: string): DerivedKeypair {
  const privateKeyHex = derivePrivateKey(password, igHandle, salt);
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const publicKeyHex = getPublicKey(privateKeyBytes);

  return {
    privateKeyHex,
    publicKeyHex,
    nsec: nip19.nsecEncode(privateKeyBytes),
    npub: nip19.npubEncode(publicKeyHex)
  };
}

/**
 * Generate a random salt for key derivation.
 * Uses crypto.randomUUID() for secure randomness.
 */
export function generateSalt(): string {
  return crypto.randomUUID();
}

/**
 * Validate password strength.
 * Returns an object with validation result and message.
 */
export interface PasswordValidation {
  valid: boolean;
  message: string;
  strength: 'weak' | 'medium' | 'strong';
}

export function validatePassword(password: string): PasswordValidation {
  if (password.length < 8) {
    return {
      valid: false,
      message: 'Password must be at least 8 characters',
      strength: 'weak'
    };
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  const criteria = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;

  if (criteria < 2) {
    return {
      valid: false,
      message: 'Password needs more variety (mix of letters, numbers, symbols)',
      strength: 'weak'
    };
  }

  if (criteria === 2) {
    return {
      valid: true,
      message: 'Password is acceptable',
      strength: 'medium'
    };
  }

  return {
    valid: true,
    message: 'Strong password',
    strength: 'strong'
  };
}
