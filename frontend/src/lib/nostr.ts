import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as secp256k1 from '@noble/secp256k1';

// Bech32 encoding for npub/nsec
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (const c of hrp) {
    ret.push(c.charCodeAt(0) >> 5);
  }
  ret.push(0);
  for (const c of hrp) {
    ret.push(c.charCodeAt(0) & 31);
  }
  return ret;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function convertBits(
  data: Uint8Array,
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error('Invalid value');
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
    throw new Error('Invalid bits');
  }

  return ret;
}

function bech32Encode(hrp: string, data: Uint8Array): string {
  const data5bit = convertBits(data, 8, 5, true);
  const checksum = bech32CreateChecksum(hrp, data5bit);
  let result = hrp + '1';
  for (const d of [...data5bit, ...checksum]) {
    result += CHARSET[d];
  }
  return result;
}

export interface KeyPair {
  publicKey: string;
  secretKey: string;
  npub: string;
  nsec: string;
}

export function generateKeyPair(): KeyPair {
  // Generate random 32 bytes for private key
  const secretKeyBytes = secp256k1.utils.randomPrivateKey();
  const secretKey = bytesToHex(secretKeyBytes);

  // Derive public key (x-only for Nostr)
  const publicKeyBytes = secp256k1.getPublicKey(secretKeyBytes);
  // Remove the prefix byte (02 or 03) to get x-only pubkey
  const publicKey = bytesToHex(publicKeyBytes.slice(1));

  // Encode as bech32
  const npub = bech32Encode('npub', hexToBytes(publicKey));
  const nsec = bech32Encode('nsec', secretKeyBytes);

  return {
    publicKey,
    secretKey,
    npub,
    nsec
  };
}

export function getPublicKeyFromSecret(secretKeyHex: string): string {
  const secretKeyBytes = hexToBytes(secretKeyHex);
  const publicKeyBytes = secp256k1.getPublicKey(secretKeyBytes);
  return bytesToHex(publicKeyBytes.slice(1));
}
