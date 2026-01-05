import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const BLOSSOM_SERVER = 'https://blossom.primal.net';

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
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);

    // Create Blossom auth event (kind 24242)
    const now = Math.floor(Date.now() / 1000);
    const eventTemplate = {
      kind: 24242,
      created_at: now,
      tags: [
        ['t', 'upload'],
        ['x', fileHash],
        ['expiration', String(now + 300)] // 5 min expiration
      ],
      content: 'Upload file'
    };

    // Sign the event using nostr-tools
    const signedEvent = finalizeEvent(eventTemplate, secretKey);

    // Upload to Blossom
    const authHeader = `Nostr ${btoa(JSON.stringify(signedEvent))}`;

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
