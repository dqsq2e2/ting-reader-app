import { useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { TingAudioPlayer, type ChapterInfo } from '../plugins/TingAudioPlayer';

interface UseNativePlayerOptions {
  onPlayingUpdate?: (isPlaying: boolean) => void;
  onPositionUpdate?: (position: number, duration: number) => void;
  onChapterChanged?: (chapterIndex: number) => void;
  onPlaybackEnded?: () => void;
  onPlaybackError?: (error: string) => void;
}

export const useNativePlayer = (options: UseNativePlayerOptions = {}) => {
  const isNative = Capacitor.isNativePlatform();
  const listenersRegistered = useRef(false);

  useEffect(() => {
    if (!isNative || listenersRegistered.current) return;

    listenersRegistered.current = true;

    // Register event listeners
    const listeners: Array<{ remove: () => void }> = [];

    const registerListeners = async () => {
      if (options.onPlayingUpdate) {
        const handle = await TingAudioPlayer.addListener('onPlayingUpdate', (data) => {
          options.onPlayingUpdate?.(data.isPlaying);
        });
        listeners.push(handle);
      }

      if (options.onPositionUpdate) {
        const handle = await TingAudioPlayer.addListener('onPositionUpdate', (data) => {
          options.onPositionUpdate?.(data.position, data.duration);
        });
        listeners.push(handle);
      }

      if (options.onChapterChanged) {
        const handle = await TingAudioPlayer.addListener('onChapterChanged', (data) => {
          options.onChapterChanged?.(data.chapterIndex);
        });
        listeners.push(handle);
      }

      if (options.onPlaybackEnded) {
        const handle = await TingAudioPlayer.addListener('onPlaybackEnded', () => {
          options.onPlaybackEnded?.();
        });
        listeners.push(handle);
      }

      if (options.onPlaybackError) {
        const handle = await TingAudioPlayer.addListener('onPlaybackError', (data) => {
          options.onPlaybackError?.(data.error);
        });
        listeners.push(handle);
      }
    };

    registerListeners();

    return () => {
      listeners.forEach(listener => listener.remove());
      listenersRegistered.current = false;
    };
  }, [isNative, options]);

  const preparePlaylist = useCallback(
    async (
      chapters: ChapterInfo[],
      bookTitle: string,
      bookAuthor: string,
      coverUrl: string,
      startChapterIndex: number,
      startPosition: number,
      playWhenReady: boolean = true,
      skipIntro: number = 0,
      skipOutro: number = 0,
      ignoreAudioFocus: boolean = false
    ) => {
      if (!isNative) {
        console.warn('Native player only available on native platforms');
        return;
      }

      await TingAudioPlayer.preparePlaylist({
        playlist: chapters,
        bookTitle,
        bookAuthor,
        coverUrl,
        startChapterIndex,
        startPosition,
        playWhenReady,
        skipIntro,
        skipOutro,
        ignoreAudioFocus,
      });
    },
    [isNative]
  );

  const play = useCallback(async () => {
    if (!isNative) return;
    await TingAudioPlayer.play();
  }, [isNative]);

  const pause = useCallback(async () => {
    if (!isNative) return;
    await TingAudioPlayer.pause();
  }, [isNative]);

  const seekTo = useCallback(
    async (position: number) => {
      if (!isNative) return;
      await TingAudioPlayer.seekTo({ position });
    },
    [isNative]
  );

  const seekToChapter = useCallback(
    async (chapterIndex: number, position: number = 0) => {
      if (!isNative) return;
      await TingAudioPlayer.seekToChapter({ chapterIndex, position });
    },
    [isNative]
  );

  const setPlaybackSpeed = useCallback(
    async (speed: number) => {
      if (!isNative) return;
      await TingAudioPlayer.setPlaybackSpeed({ speed });
    },
    [isNative]
  );

  const getCurrentPosition = useCallback(async () => {
    if (!isNative) return 0;
    const result = await TingAudioPlayer.getCurrentPosition();
    return result.position;
  }, [isNative]);

  const getDuration = useCallback(async () => {
    if (!isNative) return 0;
    const result = await TingAudioPlayer.getDuration();
    return result.duration;
  }, [isNative]);

  const getCurrentChapterIndex = useCallback(async () => {
    if (!isNative) return 0;
    const result = await TingAudioPlayer.getCurrentChapterIndex();
    return result.chapterIndex;
  }, [isNative]);

  const isPlaying = useCallback(async () => {
    if (!isNative) return false;
    const result = await TingAudioPlayer.isPlaying();
    return result.isPlaying;
  }, [isNative]);

  const closePlayback = useCallback(async () => {
    if (!isNative) return;
    await TingAudioPlayer.closePlayback();
  }, [isNative]);

  const setSleepTimer = useCallback(
    async (minutes: number) => {
      if (!isNative) return;
      await TingAudioPlayer.setSleepTimer({ minutes });
    },
    [isNative]
  );

  const getSleepTimer = useCallback(async () => {
    if (!isNative) return 0;
    const result = await TingAudioPlayer.getSleepTimer();
    return result.remaining;
  }, [isNative]);

  return {
    isNative,
    preparePlaylist,
    play,
    pause,
    seekTo,
    seekToChapter,
    setPlaybackSpeed,
    getCurrentPosition,
    getDuration,
    getCurrentChapterIndex,
    isPlaying,
    closePlayback,
    setSleepTimer,
    getSleepTimer,
  };
};
