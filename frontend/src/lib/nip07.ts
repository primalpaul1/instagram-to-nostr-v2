/**
 * NIP-07 (window.nostr) utilities for browser-extension login.
 * Works with desktop extensions (Alby, nos2x, Nostrame, etc.) and any
 * mobile in-app browser that injects window.nostr (e.g. Keychat).
 */

import type { Event } from 'nostr-tools';
import type { WindowNostr } from 'nostr-tools/nip07';

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

/**
 * Detect a NIP-07 provider. Some extensions inject window.nostr after
 * DOMContentLoaded, so we poll briefly before giving up.
 */
export function detectNostrExtension(timeoutMs = 1500): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.nostr) return Promise.resolve(true);

  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.nostr) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

export async function getNIP07Pubkey(): Promise<string> {
  if (!window.nostr) throw new Error('No Nostr extension detected');
  return await window.nostr.getPublicKey();
}

export async function signWithNIP07(event: Omit<Event, 'sig'>): Promise<Event> {
  if (!window.nostr) throw new Error('No Nostr extension detected');
  return await window.nostr.signEvent(event as Event);
}
