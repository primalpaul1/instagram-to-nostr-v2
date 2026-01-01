import { writable, derived } from 'svelte/store';
import type { NIP46Connection } from '$lib/nip46';

export type WizardStep =
  | 'handle'
  | 'keys'
  | 'videos'
  | 'confirm'
  | 'progress'
  | 'progress-nip46'
  | 'complete';

export type AuthMode = 'generate' | 'nip46';

export interface VideoInfo {
  url: string;
  filename: string;
  caption?: string;
  original_date?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url?: string;
  selected: boolean;
}

export interface KeyPair {
  publicKey: string;
  secretKey: string;
  npub: string;
  nsec: string;
}

export interface ProfileInfo {
  username: string;
  display_name?: string;
  bio?: string;
  profile_picture_url?: string;
  followers?: number;
  following?: number;
}

export interface WizardState {
  step: WizardStep;
  handle: string;
  keyPair: KeyPair | null;
  videos: VideoInfo[];
  profile: ProfileInfo | null;
  jobId: string | null;
  error: string | null;
  loading: boolean;
  authMode: AuthMode;
  nip46Connection: NIP46Connection | null;
  nip46Pubkey: string | null;
}

const initialState: WizardState = {
  step: 'handle',
  handle: '',
  keyPair: null,
  videos: [],
  profile: null,
  jobId: null,
  error: null,
  loading: false,
  authMode: 'generate',
  nip46Connection: null,
  nip46Pubkey: null
};

function createWizardStore() {
  const { subscribe, set, update } = writable<WizardState>(initialState);

  return {
    subscribe,
    reset: () => set(initialState),
    setStep: (step: WizardStep) => update(s => ({ ...s, step })),
    setHandle: (handle: string) => update(s => ({ ...s, handle })),
    setKeyPair: (keyPair: KeyPair) => update(s => ({ ...s, keyPair })),
    setVideos: (videos: VideoInfo[]) => update(s => ({ ...s, videos })),
    setProfile: (profile: ProfileInfo | null) => update(s => ({ ...s, profile })),
    toggleVideo: (url: string) => update(s => ({
      ...s,
      videos: s.videos.map(v =>
        v.url === url ? { ...v, selected: !v.selected } : v
      )
    })),
    selectAll: () => update(s => ({
      ...s,
      videos: s.videos.map(v => ({ ...v, selected: true }))
    })),
    deselectAll: () => update(s => ({
      ...s,
      videos: s.videos.map(v => ({ ...v, selected: false }))
    })),
    setJobId: (jobId: string) => update(s => ({ ...s, jobId })),
    setError: (error: string | null) => update(s => ({ ...s, error })),
    setLoading: (loading: boolean) => update(s => ({ ...s, loading })),
    setAuthMode: (authMode: AuthMode) => update(s => ({ ...s, authMode })),
    setNIP46Connection: (nip46Connection: NIP46Connection | null, nip46Pubkey: string | null) =>
      update(s => ({ ...s, nip46Connection, nip46Pubkey })),
    clearNIP46: () => update(s => ({
      ...s,
      authMode: 'generate',
      nip46Connection: null,
      nip46Pubkey: null
    }))
  };
}

export const wizard = createWizardStore();

export const selectedVideos = derived(
  wizard,
  $wizard => $wizard.videos.filter(v => v.selected)
);

export const selectedCount = derived(
  selectedVideos,
  $selected => $selected.length
);
