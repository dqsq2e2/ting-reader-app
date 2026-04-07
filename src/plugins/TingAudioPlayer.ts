import { registerPlugin } from '@capacitor/core';

export type ChapterInfo = {
  id: string;
  title: string;
  url: string;
  duration: number;
}

export type PreparePlaylistOptions = {
  playlist: ChapterInfo[];
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string;
  startChapterIndex: number;
  startPosition: number;
  playWhenReady: boolean;
  skipIntro?: number;
  skipOutro?: number;
  ignoreAudioFocus?: boolean;
}

export type SetSleepTimerOptions = {
  minutes: number;
}

export type PluginListenerHandle = {
  remove: () => void;
}

export interface TingAudioPlayerPlugin {
  /**
   * Prepare a playlist of chapters for playback
   */
  preparePlaylist(options: PreparePlaylistOptions): Promise<void>;

  /**
   * Start or resume playback
   */
  play(): Promise<void>;

  /**
   * Pause playback
   */
  pause(): Promise<void>;

  /**
   * Seek to a specific position in the current chapter (in seconds)
   */
  seekTo(options: { position: number }): Promise<void>;

  /**
   * Seek to a specific chapter and position
   */
  seekToChapter(options: { chapterIndex: number; position?: number }): Promise<void>;

  /**
   * Set playback speed
   */
  setPlaybackSpeed(options: { speed: number }): Promise<void>;

  /**
   * Set sleep timer (in minutes, 0 to cancel)
   */
  setSleepTimer(options: SetSleepTimerOptions): Promise<void>;

  /**
   * Get remaining sleep timer (in seconds)
   */
  getSleepTimer(): Promise<{ remaining: number }>;

  /**
   * Get current playback position (in seconds)
   */
  getCurrentPosition(): Promise<{ position: number }>;

  /**
   * Get duration of current chapter (in seconds)
   */
  getDuration(): Promise<{ duration: number }>;

  /**
   * Get current chapter index
   */
  getCurrentChapterIndex(): Promise<{ chapterIndex: number }>;

  /**
   * Check if player is currently playing
   */
  isPlaying(): Promise<{ isPlaying: boolean }>;

  /**
   * Close playback and stop service
   */
  closePlayback(): Promise<void>;

  /**
   * Add listener for playback events
   */
  addListener(
    eventName: 'onPlayingUpdate',
    listenerFunc: (data: { isPlaying: boolean }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'onPositionUpdate',
    listenerFunc: (data: { position: number; duration: number }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'onPlaybackEnded',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'onPlaybackError',
    listenerFunc: (data: { error: string }) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'onChapterChanged',
    listenerFunc: (data: { chapterIndex: number }) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Remove all listeners
   */
  removeAllListeners(): Promise<void>;
}

const TingAudioPlayer = registerPlugin<TingAudioPlayerPlugin>('TingAudioPlayer');

export { TingAudioPlayer };
export type { TingAudioPlayerPlugin };
