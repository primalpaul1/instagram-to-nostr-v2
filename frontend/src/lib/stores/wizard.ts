import { writable, derived } from 'svelte/store';

export type WizardStep =
  | 'handle'
  | 'keys'
  | 'videos'
  | 'confirm'
  | 'progress'
  | 'complete';

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
}

const initialState: WizardState = {
  step: 'handle',
  handle: '',
  keyPair: null,
  videos: [],
  profile: null,
  jobId: null,
  error: null,
  loading: false
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
    setLoading: (loading: boolean) => update(s => ({ ...s, loading }))
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
