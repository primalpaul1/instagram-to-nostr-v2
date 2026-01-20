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
export type PostType = 'reel' | 'image' | 'carousel' | 'text';

export interface MediaItemInfo {
  url: string;
  media_type: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url?: string;
}

export interface PostInfo {
  id: string;
  post_type: PostType;
  caption?: string;
  original_date?: string;
  thumbnail_url?: string;
  media_items: MediaItemInfo[];
  selected: boolean;
}

// Keep VideoInfo for backwards compatibility
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

export interface ArticleInfo {
  id: string;
  title: string;
  summary?: string;
  content_markdown: string;
  published_at?: string;
  link?: string;
  image_url?: string;
  hashtags: string[];
  inline_images: string[];
  selected: boolean;
}

export interface FeedInfo {
  title: string;
  description?: string;
  link?: string;
  image_url?: string;
  author_name?: string;
  author_image?: string;
  author_bio?: string;
}

export type ContentType = 'posts' | 'articles';

export interface WizardState {
  step: WizardStep;
  handle: string;
  keyPair: KeyPair | null;
  videos: VideoInfo[];  // Backwards compatibility - reels only
  posts: PostInfo[];    // All posts including images and carousels
  articles: ArticleInfo[];  // RSS articles
  feedInfo: FeedInfo | null;  // RSS feed metadata
  contentType: ContentType;  // 'posts' or 'articles'
  sourceType: 'instagram' | 'tiktok' | 'twitter' | 'rss' | null;  // Source platform
  profile: ProfileInfo | null;
  jobId: string | null;
  migrationId: string | null;  // For client-side signing flow
  error: string | null;
  loading: boolean;
  authMode: AuthMode;
  nip46Connection: NIP46Connection | null;
  nip46Pubkey: string | null;
}

// Media cache for pre-downloaded content (stored outside reactive state for performance)
const mediaCache = new Map<string, ArrayBuffer>();

export function setMediaCache(url: string, data: ArrayBuffer): void {
  mediaCache.set(url, data);
}

export function getMediaCache(url: string): ArrayBuffer | undefined {
  return mediaCache.get(url);
}

export function clearMediaCache(): void {
  mediaCache.clear();
}

const initialState: WizardState = {
  step: 'handle',
  handle: '',
  keyPair: null,
  videos: [],
  posts: [],
  articles: [],
  feedInfo: null,
  contentType: 'posts',
  sourceType: null,
  profile: null,
  jobId: null,
  migrationId: null,
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
    setPosts: (posts: PostInfo[]) => update(s => ({ ...s, posts })),
    setArticles: (articles: ArticleInfo[]) => update(s => ({ ...s, articles })),
    setFeedInfo: (feedInfo: FeedInfo | null) => update(s => ({ ...s, feedInfo })),
    setContentType: (contentType: ContentType) => update(s => ({ ...s, contentType })),
    setSourceType: (sourceType: 'instagram' | 'tiktok' | 'twitter' | 'rss' | null) => update(s => ({ ...s, sourceType })),
    setProfile: (profile: ProfileInfo | null) => update(s => ({ ...s, profile })),
    setMigrationId: (migrationId: string | null) => update(s => ({ ...s, migrationId })),
    // Toggle video (backwards compatibility)
    toggleVideo: (url: string) => update(s => ({
      ...s,
      videos: s.videos.map(v =>
        v.url === url ? { ...v, selected: !v.selected } : v
      )
    })),
    // Toggle post by ID
    togglePost: (id: string) => update(s => ({
      ...s,
      posts: s.posts.map(p =>
        p.id === id ? { ...p, selected: !p.selected } : p
      )
    })),
    // Select/deselect all videos (backwards compatibility)
    selectAll: () => update(s => ({
      ...s,
      videos: s.videos.map(v => ({ ...v, selected: true }))
    })),
    deselectAll: () => update(s => ({
      ...s,
      videos: s.videos.map(v => ({ ...v, selected: false }))
    })),
    // Select/deselect posts by type
    selectAllPosts: (postType?: PostType) => update(s => ({
      ...s,
      posts: s.posts.map(p =>
        !postType || p.post_type === postType ? { ...p, selected: true } : p
      )
    })),
    deselectAllPosts: (postType?: PostType) => update(s => ({
      ...s,
      posts: s.posts.map(p =>
        !postType || p.post_type === postType ? { ...p, selected: false } : p
      )
    })),
    // Toggle article by ID
    toggleArticle: (id: string) => update(s => ({
      ...s,
      articles: s.articles.map(a =>
        a.id === id ? { ...a, selected: !a.selected } : a
      )
    })),
    // Select/deselect all articles
    selectAllArticles: () => update(s => ({
      ...s,
      articles: s.articles.map(a => ({ ...a, selected: true }))
    })),
    deselectAllArticles: () => update(s => ({
      ...s,
      articles: s.articles.map(a => ({ ...a, selected: false }))
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

// Derived stores for posts
export const selectedPosts = derived(
  wizard,
  $wizard => $wizard.posts.filter(p => p.selected)
);

export const selectedPostsCount = derived(
  selectedPosts,
  $selected => $selected.length
);

// Filter posts by type
export const reelPosts = derived(
  wizard,
  $wizard => $wizard.posts.filter(p => p.post_type === 'reel')
);

export const imagePosts = derived(
  wizard,
  $wizard => $wizard.posts.filter(p => p.post_type === 'image' || p.post_type === 'carousel')
);

export const selectedReels = derived(
  wizard,
  $wizard => $wizard.posts.filter(p => p.post_type === 'reel' && p.selected)
);

export const selectedImagePosts = derived(
  wizard,
  $wizard => $wizard.posts.filter(p => (p.post_type === 'image' || p.post_type === 'carousel') && p.selected)
);

// Derived stores for articles
export const selectedArticles = derived(
  wizard,
  $wizard => $wizard.articles.filter(a => a.selected)
);

export const selectedArticlesCount = derived(
  selectedArticles,
  $selected => $selected.length
);
