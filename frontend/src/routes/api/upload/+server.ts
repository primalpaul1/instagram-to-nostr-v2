import { json } from '@sveltejs/kit';
import type { RequestHandler, Config } from './$types';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

// Allow large file uploads (500MB)
export const config: Config = {
  body: {
    maxSize: '500mb'
  }
};

const BLOSSOM_SERVER = 'https://blossom.primal.net';

function generateTempKeypair(): { privateKey: Uint8Array; publicKeyHex: string } {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  // Remove the prefix byte (02 or 03) to get the x-coordinate only
  const publicKeyHex = bytesToHex(publicKey.slice(1));
  return { privateKey, publicKeyHex };
}

async function signEvent(event: any, privateKey: Uint8Array): Promise<string> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ]);
  const hash = sha256(new TextEncoder().encode(serialized));
  const sig = await secp256k1.signAsync(hash, privateKey);
  return sig.toCompactHex();
}

function getEventId(event: any): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return json({ error: 'No file provided' }, { status: 400 });
    }

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    // Calculate SHA256 hash of the file
    const fileHash = bytesToHex(sha256(fileBuffer));

    // Generate temporary keypair for auth
    const { privateKey, publicKeyHex } = generateTempKeypair();

    // Create Blossom auth event (kind 24242)
    const now = Math.floor(Date.now() / 1000);
    const authEvent: any = {
      pubkey: publicKeyHex,
      created_at: now,
      kind: 24242,
      tags: [
        ['t', 'upload'],
        ['x', fileHash],
        ['expiration', String(now + 300)] // 5 min expiration
      ],
      content: 'Upload file'
    };

    authEvent.id = getEventId(authEvent);
    authEvent.sig = await signEvent(authEvent, privateKey);

    // Upload to Blossom
    const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`;

    const uploadResponse = await fetch(`${BLOSSOM_SERVER}/upload`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Blossom upload failed:', errorText);
      return json({ error: 'Upload failed: ' + errorText }, { status: 500 });
    }

    const result = await uploadResponse.json();

    return json({
      url: result.url,
      sha256: result.sha256 || fileHash,
      size: result.size || file.size,
      type: result.type || file.type
    });
  } catch (err) {
    console.error('Upload error:', err);
    return json({ error: 'Upload failed' }, { status: 500 });
  }
};
