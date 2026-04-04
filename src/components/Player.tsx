import { Capacitor } from '@capacitor/core';
import React, { useRef, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import apiClient from '../api/client';
import { FastAverageColor } from 'fast-average-color';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  // FastForward, 
  ChevronUp,
  ChevronLeft,
  Maximize2,
  Clock,
  Settings,
  RotateCcw,
  RotateCw,
  Zap,
  ArrowLeft,
  ListMusic,
  X,
  Check
} from 'lucide-react';
import { getCoverUrl } from '../utils/image';
import { setAlpha, toSolidColor, isLight, isTooLight } from '../utils/color';
import { CapacitorMusicControls as MusicControls } from 'capacitor-music-controls-plugin';

type MediaError = {
  code?: number;
  message?: string;
};

type MediaInstance = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  release: () => void;
  getDuration: () => number;
  getCurrentPosition: (success: (position: number) => void, error?: (err: MediaError) => void) => void;
  seekTo: (positionMs: number) => void;
  setVolume?: (volume: number) => void;
  setRate?: (rate: number) => void;
  _status?: number;
  _resumeTime?: number;
  _initialSeekDone?: boolean;
};

type MediaConstructor = new (
  src: string,
  success: () => void,
  error: (err: MediaError) => void,
  status: (status: number) => void
) => MediaInstance;

type WindowWithMedia = Window & {
  Media?: MediaConstructor;
  electronAPI?: unknown;
};

interface ProgressBarProps {
  isMini?: boolean;
  isSeeking: boolean;
  seekTime: number;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  themeColor?: string | null;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ 
  isMini = false,
  isSeeking,
  seekTime,
  currentTime,
  duration,
  bufferedTime,
  themeColor,
  onSeek,
  onSeekStart,
  onSeekEnd
}) => {
  const displayTime = isSeeking ? seekTime : currentTime;
  const playedPercent = (Number.isFinite(duration) && duration > 0) ? (displayTime / duration) * 100 : 0;
  const bufferedPercent = (Number.isFinite(duration) && duration > 0) ? (bufferedTime / duration) * 100 : 0;
  
  // Filter out light colors
  const effectiveThemeColor = themeColor && !isTooLight(themeColor) ? themeColor : undefined;

  const barColor = effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined;
  const shadowColor = effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.4) : undefined;
  
  return (
    <div className={`relative group/progress ${isMini ? 'flex-1 w-full h-3 sm:h-2' : 'w-full h-4'} flex items-center select-none touch-none`}>
      {/* Track Background */}
      <div 
        className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 ${isMini ? 'h-1' : 'h-1.5'} bg-slate-300 dark:bg-slate-900 rounded-full overflow-hidden`}
      >
        {/* Buffered Bar */}
        <div 
          className="absolute inset-y-0 left-0 bg-slate-400/30 dark:bg-slate-700/40 transition-all duration-300" 
          style={{ width: `${bufferedPercent}%` }}
        />
        {/* Played Bar */}
        <div 
          className={`absolute inset-y-0 left-0 z-10 ${!barColor ? 'bg-primary-600' : ''}`}
          style={{ 
            width: `${playedPercent}%`,
            backgroundColor: barColor,
            boxShadow: shadowColor ? `0 0 10px ${shadowColor}` : undefined
          }}
        />
      </div>

      {/* Thumb / Handle */}
      <div 
        className={`absolute top-1/2 -translate-y-1/2 z-20 w-3 h-3 bg-white rounded-full shadow-md transition-transform duration-100 ease-out pointer-events-none ${isSeeking ? 'scale-150' : 'scale-100'}`}
        style={{ 
          left: `${playedPercent}%`, 
          marginLeft: '-6px',
          backgroundColor: isSeeking ? '#ffffff' : (barColor || '#ffffff'),
          border: `1px solid ${barColor || 'transparent'}`
        }}
      />

      {/* Range Input for Seeking - Positioned and sized correctly to cover the entire bar */}
      <input 
        type="range" 
        min="0" 
        max={Number.isFinite(duration) ? duration : 0} 
        step="any"
        value={displayTime} 
        onInput={onSeek}
        onMouseDown={onSeekStart}
        onTouchStart={onSeekStart}
        onMouseUp={onSeekEnd}
        onTouchEnd={onSeekEnd}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
        style={{
          margin: 0,
          padding: 0,
          WebkitAppearance: 'none'
        }}
      />
    </div>
  );
};

const Player: React.FC = () => {
  const { token, activeUrl } = useAuthStore();
  const API_BASE_URL = activeUrl || import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
  
  const [retryCount, setRetryCount] = useState(0);
  const [shouldTranscode, setShouldTranscode] = useState(false);

  const getStreamUrl = React.useCallback((chapterId: string, seekTime?: number) => {
    let url = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).electronAPI) {
      // Electron mode: use custom protocol for caching
      const remote = encodeURIComponent(API_BASE_URL);
      url = `ting://stream/${chapterId}?token=${token}&remote=${remote}`;
    } else {
      url = `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
    }
    
    if (shouldTranscode) {
      url += '&transcode=mp3';
      if (seekTime && seekTime > 0) {
        url += `&seek=${seekTime}`;
      }
    }
    
    // Add retry count to force URL refresh even if shouldTranscode didn't change (e.g. network retry)
    if (retryCount > 0) {
        url += `&retry=${retryCount}`;
    }
    
    return url;
  }, [API_BASE_URL, token, shouldTranscode, retryCount]);

  const { 
    currentBook, 
    currentChapter, 
    isPlaying, 
    currentTime, 
    duration, 
    setCurrentTime, 
    setDuration,
    nextChapter,
    prevChapter,
    playbackSpeed,
    setPlaybackSpeed,
    volume,
    setVolume,
    themeColor,
    setThemeColor,
    playChapter,
    setIsPlaying,
    isExpanded,
    setIsExpanded,
    isCollapsed,
    setIsCollapsed,
    isSeriesEditing
  } = usePlayerStore();

  const isNative = Capacitor.isNativePlatform();
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRef = useRef<MediaInstance | null>(null);
  const mediaTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSeekingRef = useRef(false);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamOffsetRef = useRef(0);
  const location = useLocation();
  const [isMuted, setIsMuted] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'main' | 'extra'>('main');
  const scrollRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);

  const scrollGroups = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [chapters, setChapters] = useState<any[]>([]);
  const [customMinutes, setCustomMinutes] = useState('');
  const [editSkipIntro, setEditSkipIntro] = useState(0);
  const [editSkipOutro, setEditSkipOutro] = useState(0);

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const effectiveThemeColor = themeColor && !isTooLight(themeColor) ? themeColor : undefined;
  // Always use the theme color for the mini player progress bar, even in dark mode
  const miniPlayerThemeColor = effectiveThemeColor;
  // Determine if we should use dark mode text colors (white/gray) for controls
  // In dark mode, we always want bright white/gray for contrast
  const useDarkControls = isDark;

  // Use stored theme color from book to avoid flash
  useEffect(() => {
    // Prefer camelCase if available, otherwise snake_case
    const color = currentBook?.themeColor;
    if (color) {
      setThemeColor(color);
    } else if (currentBook?.coverUrl) {
      // If no theme color but we have a cover, extract it client-side
      const coverUrl = getCoverUrl(currentBook.coverUrl, currentBook.libraryId, currentBook.id);
      const fac = new FastAverageColor();
      fac.getColorAsync(coverUrl, { algorithm: 'dominant' })
        .then(color => {
          setThemeColor(color.hex);
          // Update the store's currentBook locally so it persists in this session and avoids re-extraction
          usePlayerStore.setState(state => ({
            currentBook: state.currentBook ? {
              ...state.currentBook,
              themeColor: color.hex
            } : null
          }));
        })
        .catch(e => console.warn('在播放器中从封面提取颜色失败', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.id, currentBook?.themeColor]);

  useEffect(() => {
    if (currentBook) {
      setTimeout(() => {
        setEditSkipIntro(currentBook.skipIntro || 0);
        setEditSkipOutro(currentBook.skipOutro || 0);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.id]);

  const handleSaveSettings = async () => {
    if (!currentBook) return;
    try {
      await apiClient.patch(`/api/books/${currentBook.id}`, {
        skipIntro: editSkipIntro,
        skipOutro: editSkipOutro
      });
      // Update local store state if necessary, but currentBook is in store
      usePlayerStore.setState(state => ({
        currentBook: state.currentBook ? {
          ...state.currentBook,
          skipIntro: editSkipIntro,
          skipOutro: editSkipOutro
        } : null
      }));
      setShowSettings(false);
    } catch (err) {
      console.error('保存设置失败', err);
    }
  };

  const { mainChapters, extraChapters } = React.useMemo(() => {
    return {
      mainChapters: chapters.filter(c => !c.isExtra),
      extraChapters: chapters.filter(c => c.isExtra)
    };
  }, [chapters]);

  const currentChapters = activeTab === 'main' ? mainChapters : extraChapters;

  const chaptersPerGroup = 100;
  const groups = React.useMemo(() => {
    const g = [];
    for (let i = 0; i < currentChapters.length; i += chaptersPerGroup) {
      const slice = currentChapters.slice(i, i + chaptersPerGroup);
      g.push({
        start: slice[0]?.chapterIndex || (i + 1),
        end: slice[slice.length - 1]?.chapterIndex || (i + slice.length),
        chapters: slice
      });
    }
    return g;
  }, [currentChapters]);

  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const sleepTimerEndTimeRef = useRef<number | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerMenuRef = useRef<HTMLDivElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [autoPreload, setAutoPreload] = useState(false);
  const [autoCache, setAutoCache] = useState(false);
  const isInitialLoadRef = useRef(true);
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const chapterEndHandledRef = useRef<string | null>(null);
  const playbackWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKnownAudioTimeRef = useRef(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // Fetch settings for auto_preload and user preferences
  useEffect(() => {
    apiClient.get('/api/settings').then(res => {
      // API returns camelCase
      setAutoPreload(!!res.data.autoPreload);
      setAutoCache(!!res.data.autoCache);
      
      // Apply user's default playback speed
      if (res.data.playbackSpeed) {
        setPlaybackSpeed(res.data.playbackSpeed);
      }
      
      // Apply volume if present in settings (check both root and settings_json)
      // Note: Volume might be stored in settings_json as it's not a core column
      const vol = res.data.volume ?? res.data.settingsJson?.volume;
      if (vol !== undefined) {
        setVolume(vol);
      }
    }).catch(err => console.error('获取设置失败', err));
  }, [setPlaybackSpeed, setVolume]);

  // Fetch chapters for the current book
  useEffect(() => {
    if (currentBook?.id) {
      apiClient.get(`/api/books/${currentBook.id}/chapters`).then(res => {
        setChapters(res.data);
        setCurrentGroupIndex(0); // Reset group index when book changes
      }).catch(err => console.error('获取章节失败', err));
    }
  }, [currentBook?.id]);

  // Close timer menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timerMenuRef.current && !timerMenuRef.current.contains(event.target as Node)) {
        setShowSleepTimer(false);
      }
      if (volumeControlRef.current && !volumeControlRef.current.contains(event.target as Node)) {
        setShowVolumeControl(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset initial load ref when chapter changes
  useEffect(() => {
    isInitialLoadRef.current = true;
    chapterEndHandledRef.current = null;
    setShouldTranscode(false);
    setTimeout(() => {
      setBufferedTime(0);
      setRetryCount(0);
    }, 0);
  }, [currentChapter?.id]);

  // Reset initial load ref when retrying (to allow resume logic to run again)
  useEffect(() => {
    if (retryCount > 0) {
      isInitialLoadRef.current = true;
    }
  }, [retryCount]);

  const syncMusicControlsElapsed = React.useCallback((elapsed: number, playing = usePlayerStore.getState().isPlaying) => {
    const safeElapsed = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
    try {
      MusicControls.updateElapsed({
        elapsed: safeElapsed,
        isPlaying: playing,
        playbackRate: usePlayerStore.getState().playbackSpeed
      });
    } catch (err) {
      console.warn('更新锁屏进度失败', err);
    }
  }, []);

  const clearResumeRecoveryTimer = React.useCallback(() => {
    if (resumeRecoveryTimeoutRef.current) {
      clearTimeout(resumeRecoveryTimeoutRef.current);
      resumeRecoveryTimeoutRef.current = null;
    }
  }, []);

  const markPlaybackPaused = React.useCallback((elapsed?: number) => {
    const fallbackElapsed = elapsed ?? audioRef.current?.currentTime ?? usePlayerStore.getState().currentTime;
    setIsPlaying(false);
    syncMusicControlsElapsed(fallbackElapsed, false);
  }, [setIsPlaying, syncMusicControlsElapsed]);

  const attemptPlaybackRecovery = React.useCallback(async (resumeAt: number) => {
    const audio = audioRef.current;
    if (!audio || !currentChapter) return false;

    try {
      const nextSrc = getStreamUrl(currentChapter.id);
      if (audio.src !== nextSrc) {
        audio.src = nextSrc;
      }

      audio.load();

      await new Promise<void>((resolve) => {
        const onReady = () => {
          audio.removeEventListener('loadedmetadata', onReady);
          audio.removeEventListener('canplay', onReady);
          resolve();
        };

        audio.addEventListener('loadedmetadata', onReady, { once: true });
        audio.addEventListener('canplay', onReady, { once: true });

        setTimeout(() => {
          audio.removeEventListener('loadedmetadata', onReady);
          audio.removeEventListener('canplay', onReady);
          resolve();
        }, 1500);
      });

      if (resumeAt > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(resumeAt, Math.max(audio.duration - 0.5, 0));
      } else if (resumeAt > 0) {
        audio.currentTime = resumeAt;
      }

      await audio.play();
      return true;
    } catch (err) {
      console.error('后台恢复播放失败', err);
      return false;
    }
  }, [currentChapter, getStreamUrl]);

  const finalizeChapterPlayback = React.useCallback((chapterId: string, finalPosition?: number) => {
    if (chapterEndHandledRef.current === chapterId) return;

    const state = usePlayerStore.getState();
    if (state.currentChapter?.id !== chapterId || !state.currentBook) return;

    chapterEndHandledRef.current = chapterId;

    const audioDuration = audioRef.current?.duration;
    const safeFinalPosition = Number.isFinite(finalPosition) && (finalPosition ?? 0) > 0
      ? finalPosition!
      : Math.max(
          state.currentTime,
          state.duration,
          Number.isFinite(audioDuration) ? audioDuration : 0
        );

    apiClient.post('/api/progress', {
      bookId: state.currentBook.id,
      chapterId,
      position: Math.floor(safeFinalPosition)
    }).catch(err => console.error('同步最终进度失败', err));

    const currentIndex = state.chapters.findIndex(chapter => chapter.id === chapterId);
    const hasNextChapter = currentIndex !== -1 && currentIndex < state.chapters.length - 1;

    if (hasNextChapter) {
      state.nextChapter();
      return;
    }

    state.setIsPlaying(false);
  }, []);

  const initNativeMedia = React.useCallback((url: string) => {
    const oldMedia = mediaRef.current;
    if (mediaRef.current) mediaRef.current = null;
    if (mediaTimerRef.current) { clearInterval(mediaTimerRef.current); mediaTimerRef.current = null; }

    const mediaCtor = (window as WindowWithMedia).Media;
    if (!mediaCtor) {
      console.error('Cordova Media plugin not found!');
      if (oldMedia) oldMedia.release();
      return;
    }

    const media = new mediaCtor(
      url,
      () => {
        if (mediaRef.current !== media) return;
        if (currentChapter?.id) {
          // Trigger the centralized end playback handler
          setTimeout(() => finalizeChapterPlayback(currentChapter.id, usePlayerStore.getState().duration), 0);
        }
      },
      (err: MediaError) => {
        if (mediaRef.current !== media) return;
        const errorCode = err?.code;
        const shouldRetry = errorCode === 1 || errorCode === 3 || errorCode === 4 || (typeof errorCode === 'number' && errorCode < 0);

        if (errorCode === -2147483648) {
          console.warn('Caught generic media error, recovering...');
          const currentPos = usePlayerStore.getState().currentTime;
          const currentId = usePlayerStore.getState().currentChapter?.id;
          if (currentId) {
            setTimeout(() => initNativeMedia(getStreamUrl(currentId, currentPos)), 500);
          }
          return;
        }

        if (shouldRetry && retryCount < 3) {
          console.log(`Playback error ${errorCode}, retrying with transcode (${retryCount + 1}/3)...`);
          setShouldTranscode(true);
          isInitialLoadRef.current = true;
          setRetryCount(prev => prev + 1);
          return;
        }
        if (errorCode !== 0) setError(`播放出错: ${err?.message || err?.code || JSON.stringify(err)}`);
      },
      (status: number) => {
        if (mediaRef.current !== media) return;
        if (mediaRef.current) mediaRef.current._status = status;
        
        if (status === 2) {
          setIsPlaying(true);
          const state = usePlayerStore.getState();
          if (media.setRate) media.setRate(state.playbackSpeed);
          if (media.setVolume) media.setVolume(isMuted ? 0 : state.volume);
          if (media._resumeTime && media._resumeTime > 0 && !media._initialSeekDone) {
            media.seekTo(media._resumeTime * 1000);
            // Assume seek completes after a short delay to avoid progress bar freeze
            setTimeout(() => {
                if (mediaRef.current === media) {
                    media._initialSeekDone = true;
                }
            }, 1000);
          }
        } else if (status === 3) {
          markPlaybackPaused(usePlayerStore.getState().currentTime);
        } else if (status === 4) {
          console.log('Status stopped (4), ignoring to prevent background freeze before next chapter');
        }
      }
    );

    media._status = 0;
    let resumeTime = usePlayerStore.getState().currentTime;
    if (url.includes('seek=')) resumeTime = 0;
    media._resumeTime = resumeTime;
    media._initialSeekDone = resumeTime <= 0;

    mediaRef.current = media;
    if (usePlayerStore.getState().isPlaying) media.play();
    if (oldMedia) oldMedia.release();

    mediaTimerRef.current = setInterval(() => {
      if (mediaRef.current) {
        mediaRef.current.getCurrentPosition((position: number) => {
          if (position > -1) {
            if (mediaRef.current?._resumeTime && mediaRef.current._resumeTime > 0 && !mediaRef.current._initialSeekDone) {
              if (Math.abs(position - mediaRef.current._resumeTime) < 2) {
                mediaRef.current._initialSeekDone = true;
              } else return;
            }
            if (isSeekingRef.current) return;
            
            const state = usePlayerStore.getState();
            const realPosition = position + streamOffsetRef.current;
            if (Math.abs(realPosition - state.currentTime) > 0.5) {
              setCurrentTime(realPosition);
            }
            
            const d = mediaRef.current?.getDuration() || 0;
            if (d > 0 && d !== state.duration && !shouldTranscode) {
              setDuration(d);
            }
            
            syncMusicControlsElapsed(realPosition, state.isPlaying);
            
            const book = state.currentBook;
            if (book) {
              if (isInitialLoadRef.current && book.skipIntro && realPosition < book.skipIntro) {
                if (shouldTranscode) {
                  streamOffsetRef.current = book.skipIntro;
                  initNativeMedia(getStreamUrl(state.currentChapter!.id, book.skipIntro));
                } else {
                  mediaRef.current!.seekTo(book.skipIntro * 1000);
                }
                setCurrentTime(book.skipIntro);
                isInitialLoadRef.current = false;
              }
              if (book.skipOutro && d > 0) {
                const minDuration = (book.skipIntro || 0) + book.skipOutro + 10;
                if (d > minDuration && (d - realPosition) <= book.skipOutro) {
                  state.nextChapter();
                }
              }
            }
          }
        }, () => {});
      }
    }, 1000);
  }, [currentChapter, isMuted, retryCount, shouldTranscode, finalizeChapterPlayback, getStreamUrl, markPlaybackPaused, setCurrentTime, setDuration, setIsPlaying, syncMusicControlsElapsed]);

  const performSeek = React.useCallback((time: number) => {
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    isSeekingRef.current = true;
    setCurrentTime(time);

    if (shouldTranscode) {
      seekTimeoutRef.current = setTimeout(() => {
        streamOffsetRef.current = time;
        const currentId = usePlayerStore.getState().currentChapter?.id;
        if (currentId) {
          const url = getStreamUrl(currentId, time) + (retryCount > 0 ? `&retry=${retryCount}` : '');
          if (isNative) initNativeMedia(url);
          else if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.load();
            audioRef.current.play().catch(() => {});
          }
        }
        setTimeout(() => { isSeekingRef.current = false; }, 1000);
      }, 500);
      return;
    }

    seekTimeoutRef.current = setTimeout(() => {
      if (isNative && mediaRef.current) {
        mediaRef.current.seekTo(time * 1000);
      }
      setTimeout(() => { isSeekingRef.current = false; }, 1000);
    }, 300);
  }, [setCurrentTime, shouldTranscode, retryCount, getStreamUrl, isNative, initNativeMedia]);

  const requestPlay = React.useCallback(async (reason: 'ui' | 'remote' | 'resume-check' = 'ui') => {
    if (isNative) {
      if (mediaRef.current) mediaRef.current.play();
      else if (currentChapter) initNativeMedia(getStreamUrl(currentChapter.id));
      return true;
    }

    const audio = audioRef.current;
    if (!audio || !currentChapter) return false;

    clearResumeRecoveryTimer();

    const resumeAt = Number.isFinite(audio.currentTime) && audio.currentTime > 0
      ? audio.currentTime
      : usePlayerStore.getState().currentTime;

    audio.playbackRate = playbackSpeed;
    audio.volume = isMuted ? 0 : volume;
    lastKnownAudioTimeRef.current = resumeAt;

    try {
      await audio.play();
    } catch (err) {
      console.warn(`播放请求失败(${reason})，尝试重新恢复流`, err);
      const recovered = await attemptPlaybackRecovery(resumeAt);
      if (!recovered) {
        markPlaybackPaused(resumeAt);
        return false;
      }
    }

    resumeRecoveryTimeoutRef.current = setTimeout(async () => {
      const liveAudio = audioRef.current;
      if (!liveAudio || liveAudio.paused || usePlayerStore.getState().currentChapter?.id !== currentChapter.id) return;

      const actualTime = liveAudio.currentTime;
      const advanced = actualTime > lastKnownAudioTimeRef.current + 0.2;
      const hasAudibleOutput = !liveAudio.muted && liveAudio.volume > 0;

      if (!advanced && !hasAudibleOutput) {
        const recovered = await attemptPlaybackRecovery(actualTime || resumeAt);
        if (!recovered) {
          markPlaybackPaused(actualTime || resumeAt);
        }
      }
    }, reason === 'remote' ? 1800 : 1200);

    return true;
  }, [attemptPlaybackRecovery, clearResumeRecoveryTimer, currentChapter, isMuted, markPlaybackPaused, playbackSpeed, volume, getStreamUrl, initNativeMedia, isNative]);

  const requestPause = React.useCallback(() => {
    clearResumeRecoveryTimer();
    if (isNative) {
      if (mediaRef.current) {
        const status = mediaRef.current._status;
        if (status === 1 || status === 2 || status === 3) mediaRef.current.pause();
      }
      markPlaybackPaused();
      return;
    }
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      return;
    }

    markPlaybackPaused();
  }, [clearResumeRecoveryTimer, markPlaybackPaused, isNative]);

  const togglePlayback = React.useCallback(() => {
    if (isNative) {
      if (usePlayerStore.getState().isPlaying) requestPause();
      else void requestPlay('ui');
      return;
    }
    const audio = audioRef.current;
    if (audio && !audio.paused && !audio.ended && usePlayerStore.getState().isPlaying) {
      requestPause();
      return;
    }

    void requestPlay('ui');
  }, [requestPause, requestPlay, isNative]);

  // Update Controls: Create/Update Metadata when Chapter Changes
  useEffect(() => {
    if (!currentBook?.id || !currentChapter?.id) return;
    
    MusicControls.create({
        track: currentChapter.title,
        artist: currentBook.title,
        cover: getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id) || '',
        isPlaying: usePlayerStore.getState().isPlaying,
        dismissable: true,
        hasPrev: true,
        hasNext: true,
        hasClose: true,
        hasScrubbing: true,
        duration: usePlayerStore.getState().duration,
        elapsed: usePlayerStore.getState().currentTime,
        playbackRate: usePlayerStore.getState().playbackSpeed,
        ticker: `正在播放: ${currentChapter.title}`,
        playIcon: '',
        pauseIcon: '',
        prevIcon: '',
        nextIcon: '',
        closeIcon: '',
        notificationIcon: ''
    }).catch(console.error);
  }, [currentBook?.id, currentBook?.title, currentBook?.coverUrl, currentBook?.libraryId, currentChapter?.id, currentChapter?.title]);

  // Update Controls: Duration (if loaded late)
  useEffect(() => {
    if (duration > 0 && currentChapter?.id) {
        MusicControls.create({
            track: currentChapter.title,
            artist: currentBook?.title || '',
            cover: getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id) || '',
            isPlaying: usePlayerStore.getState().isPlaying,
            dismissable: true,
            hasPrev: true,
            hasNext: true,
            hasClose: true,
            hasScrubbing: true,
            duration: duration,
            elapsed: usePlayerStore.getState().currentTime,
            playbackRate: usePlayerStore.getState().playbackSpeed,
            ticker: `正在播放: ${currentChapter.title}`,
            playIcon: '',
            pauseIcon: '',
            prevIcon: '',
            nextIcon: '',
            closeIcon: '',
            notificationIcon: ''
        }).catch(console.error);
    }
  }, [duration, currentBook?.id, currentBook?.title, currentBook?.coverUrl, currentBook?.libraryId, currentChapter?.id, currentChapter?.title]);

  // Media Session / Music Controls Support - Listeners
  useEffect(() => {
    MusicControls.addListener('music-controls-next', () => {
        usePlayerStore.getState().nextChapter();
    });
    MusicControls.addListener('music-controls-previous', () => {
        usePlayerStore.getState().prevChapter();
    });
    MusicControls.addListener('music-controls-pause', () => {
        requestPause();
    });
    MusicControls.addListener('music-controls-play', () => {
        void requestPlay('remote');
    });
    MusicControls.addListener('music-controls-destroy', () => {
        requestPause();
    });
    MusicControls.addListener('music-controls-toggle-play-pause', () => {
        togglePlayback();
    });
    MusicControls.addListener('music-controls-seek-to', (payload: { position: number }) => {
        const time = payload.position;
        if (isNative && mediaRef.current && !shouldTranscode) {
            performSeek(time);
        } else if (!isNative && audioRef.current && !shouldTranscode) {
            audioRef.current.currentTime = time;
        } else if (shouldTranscode) {
            performSeek(time);
        }
        
        if (!shouldTranscode) {
            usePlayerStore.getState().setCurrentTime(time);
            MusicControls.updateElapsed({
                elapsed: time,
                isPlaying: usePlayerStore.getState().isPlaying,
                playbackRate: usePlayerStore.getState().playbackSpeed
            });
        }
    });

    return () => {
        MusicControls.removeAllListeners();
    };
  }, [requestPause, requestPlay, togglePlayback, isNative, performSeek, shouldTranscode]);

  // Update Controls: Play/Pause State
  useEffect(() => {
      MusicControls.updateIsPlaying({
          isPlaying: isPlaying,
          elapsed: usePlayerStore.getState().currentTime,
          playbackRate: usePlayerStore.getState().playbackSpeed
      });
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying || !currentChapter?.id) return;

    const syncPlaybackState = () => {
      const audio = audioRef.current;
      if (!audio) return;

      const liveTime = audio.currentTime;
      const liveDuration = Number.isFinite(audio.duration) ? audio.duration : usePlayerStore.getState().duration;

      if (!isSeeking && Number.isFinite(liveTime) && Math.abs(liveTime - usePlayerStore.getState().currentTime) > 0.5) {
        usePlayerStore.getState().setCurrentTime(liveTime);
      }

      if (Number.isFinite(liveTime)) {
        lastKnownAudioTimeRef.current = liveTime;
        syncMusicControlsElapsed(liveTime);
      }

      if (liveDuration > 0 && (audio.ended || liveTime >= liveDuration - 0.25)) {
        finalizeChapterPlayback(currentChapter.id, liveDuration);
      }
    };

    syncPlaybackState();
    playbackWatchdogRef.current = setInterval(syncPlaybackState, 1000);

    return () => {
      if (playbackWatchdogRef.current) {
        clearInterval(playbackWatchdogRef.current);
        playbackWatchdogRef.current = null;
      }
    };
  }, [isPlaying, isSeeking, currentChapter?.id, finalizeChapterPlayback, syncMusicControlsElapsed]);

  // Sync Native Media source loading
  useEffect(() => {
    if (!currentChapter || !isNative) return;
    
    let isMounted = true;
    const chapterId = currentChapter.id;
    
    const loadAndPlay = async () => {
        let url = getStreamUrl(chapterId);
        
        if (!isMounted) return;
        if (currentChapter.id !== chapterId) return;

        let resumeTime = usePlayerStore.getState().currentTime;
        
        if (isInitialLoadRef.current && currentChapter.id === chapterId) {
            if (currentChapter && currentChapter.duration && currentChapter.duration > 0) {
                if (currentChapter.duration - resumeTime < 2 || resumeTime / currentChapter.duration > 0.99) {
                    resumeTime = 0;
                    usePlayerStore.getState().setCurrentTime(0);
                }
            }
        }

        if (shouldTranscode && isInitialLoadRef.current && currentChapter.id === chapterId) {
            if (resumeTime > 0) {
                streamOffsetRef.current = resumeTime;
                url = getStreamUrl(chapterId, resumeTime);
            } else {
                streamOffsetRef.current = 0;
            }
        } else {
            streamOffsetRef.current = 0;
        }

        initNativeMedia(url);
    };

    loadAndPlay();

    return () => {
        isMounted = false;
    };
  }, [currentChapter, retryCount, shouldTranscode, getStreamUrl, initNativeMedia, setCurrentTime, isNative]);

  // Cleanup native media on unmount
  useEffect(() => {
      return () => {
          if (mediaRef.current) {
              mediaRef.current.release();
              mediaRef.current = null;
          }
          if (mediaTimerRef.current) {
              clearInterval(mediaTimerRef.current);
          }
      };
  }, []);

  // Sync state with audio element
  useEffect(() => {
    if (isNative) return;
    if (!audioRef.current || !currentChapter) return;
    setTimeout(() => setError(null), 0); // Clear error on source change
    
    // Reset retry count when chapter changes (this is also handled in another effect, but safe to double check)
    // IMPORTANT: If source changes due to transcoding, we do NOT want to reset retry count immediately here
    // or we might enter a loop. 
    // Actually, retryCount is part of the dependency array, so this runs on retry too.
    
    if (isPlaying) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          // Ignore AbortError which happens when pausing/switching quickly
          if (err.name === 'AbortError' || err.code === 20) {
            console.log('播放承诺已中止 (正常)');
            return;
          }
          console.error('播放失败', err);
          markPlaybackPaused(audioRef.current?.currentTime);
        });
      }
    } else {
      audioRef.current.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentChapter?.id, retryCount, shouldTranscode, markPlaybackPaused]);

  // Preload and Server-side Cache next chapter logic
  useEffect(() => {
    if ((!autoPreload && !autoCache) || !currentChapter || !currentBook) return;
    
    // Find next chapter index
    apiClient.get(`/api/books/${currentBook.id}/chapters`).then(res => {
      const chapters = res.data;
      const currentIndex = chapters.findIndex((c: { id: string }) => c.id === currentChapter.id);
      if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
        const nextChapterId = chapters[currentIndex + 1].id;
        const nextSrc = getStreamUrl(nextChapterId);
        
        // 1. Auto Preload (Memory)
        if (autoPreload) {
          if (!preloadAudioRef.current) {
            preloadAudioRef.current = new Audio();
            preloadAudioRef.current.preload = 'auto';
          }
          
          if (preloadAudioRef.current.src !== nextSrc) {
            console.log('正在预加载下一章:', chapters[currentIndex + 1].title);
            preloadAudioRef.current.src = nextSrc;
            preloadAudioRef.current.load();
          }
        }

        // 2. Auto Cache (Server-side WebDAV)
        if (autoCache) {
           console.log('触发服务器端缓存:', chapters[currentIndex + 1].title);
           apiClient.post(`/api/cache/${nextChapterId}`).catch(err => {
              console.error('触发服务器端缓存失败', err);
           });
        }
      }
    }).catch(err => console.error('预加载失败', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter?.id, autoPreload, autoCache, currentBook?.id]);

  // Handle Skip Intro and Outro
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    
    const time = audioRef.current.currentTime;
    
    // Prevent overwriting persisted progress with 0 on initial load
    // If we are at the very beginning (time < 0.5) but store has significant progress (> 2s),
    // ignore this update until we've resumed properly.
    if (isInitialLoadRef.current && time < 0.5 && currentTime > 2) {
      return;
    }

    // Mark initial load as done if we have successfully played past 1s
    if (isInitialLoadRef.current && time > 1) {
       isInitialLoadRef.current = false;
    }

    setCurrentTime(time);
    syncMusicControlsElapsed(time);

    // Update buffered time more accurately
    if (audioRef.current.buffered.length > 0) {
      // Find the range that contains the current time
      let currentRangeEnd = 0;
      for (let i = 0; i < audioRef.current.buffered.length; i++) {
        if (audioRef.current.buffered.start(i) <= time && audioRef.current.buffered.end(i) >= time) {
          currentRangeEnd = audioRef.current.buffered.end(i);
          break;
        }
      }
      
      // If no range contains current time, just use the end of the last range before current time
      if (currentRangeEnd === 0) {
        for (let i = audioRef.current.buffered.length - 1; i >= 0; i--) {
          if (audioRef.current.buffered.start(i) <= time) {
            currentRangeEnd = audioRef.current.buffered.end(i);
            break;
          }
        }
      }
      
      setBufferedTime(currentRangeEnd);
    }

    // Handle Skip Intro
    if (isInitialLoadRef.current && currentBook?.skipIntro) {
      if (time < currentBook.skipIntro) {
        audioRef.current.currentTime = currentBook.skipIntro;
        setCurrentTime(currentBook.skipIntro);
      }
      isInitialLoadRef.current = false;
    }

    // Handle Skip Outro
    if (currentBook?.skipOutro && duration > 0) {
      // Only skip if the chapter is long enough to actually have an outro
      // and we've played at least some of it
      const minChapterDuration = (currentBook.skipIntro || 0) + currentBook.skipOutro + 10;
      if (duration > minChapterDuration && (duration - time) <= currentBook.skipOutro) {
        nextChapter();
      }
    }
  };

  const handleProgress = () => {
    if (audioRef.current && audioRef.current.buffered.length > 0) {
      const time = audioRef.current.currentTime;
      let currentRangeEnd = 0;
      for (let i = 0; i < audioRef.current.buffered.length; i++) {
        if (audioRef.current.buffered.start(i) <= time && audioRef.current.buffered.end(i) >= time) {
          currentRangeEnd = audioRef.current.buffered.end(i);
          break;
        }
      }
      if (currentRangeEnd === 0) {
        for (let i = audioRef.current.buffered.length - 1; i >= 0; i--) {
          if (audioRef.current.buffered.start(i) <= time) {
            currentRangeEnd = audioRef.current.buffered.end(i);
            break;
          }
        }
      }
      setBufferedTime(currentRangeEnd);
    }
  };

  // Handle Sleep Timer Countdown
  useEffect(() => {
    if (sleepTimer === null || sleepTimer <= 0 || !sleepTimerEndTimeRef.current) return;

    // Clear any existing interval
    if (sleepTimerIntervalRef.current) {
      clearInterval(sleepTimerIntervalRef.current);
    }

    // Set up new interval to update remaining time based on end time
    const interval = setInterval(() => {
      if (sleepTimerEndTimeRef.current) {
        const remaining = Math.max(0, Math.floor((sleepTimerEndTimeRef.current - Date.now()) / 1000));
        
        // If timer is up or past due, stop the timer immediately
        if (remaining === 0) {
            if (usePlayerStore.getState().isPlaying) {
                requestPause();
            }
            sleepTimerEndTimeRef.current = null;
            if (sleepTimerIntervalRef.current) {
                clearInterval(sleepTimerIntervalRef.current);
                sleepTimerIntervalRef.current = null;
            }
            setTimeout(() => setSleepTimer(null), 0);
        } else {
            setSleepTimer(remaining);
        }
      }
    }, 1000);

    sleepTimerIntervalRef.current = interval;

    return () => {
      if (sleepTimerIntervalRef.current) {
        clearInterval(sleepTimerIntervalRef.current);
        sleepTimerIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepTimer === null, requestPause]);

  // Handle Sleep Timer Expiration (Fallback for immediate state changes)
  useEffect(() => {
    if (sleepTimer === 0) {
      if (usePlayerStore.getState().isPlaying) {
        requestPause();
      }
      
      // Reset sleep timer references
      sleepTimerEndTimeRef.current = null;
      if (sleepTimerIntervalRef.current) {
        clearInterval(sleepTimerIntervalRef.current);
        sleepTimerIntervalRef.current = null;
      }
      
      setTimeout(() => setSleepTimer(null), 0);
    }
  }, [sleepTimer, requestPause]);

  useEffect(() => {
    if (isNative && mediaRef.current && typeof mediaRef.current.setRate === 'function') {
      mediaRef.current.setRate(playbackSpeed);
    }
    if (!isNative && audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, isNative]);

  useEffect(() => {
    const vol = isMuted ? 0 : volume;
    if (isNative && mediaRef.current && typeof mediaRef.current.setVolume === 'function') {
      mediaRef.current.setVolume(vol);
    }
    if (!isNative && audioRef.current) {
      audioRef.current.volume = vol;
    }
  }, [volume, isMuted, isNative]);

  useEffect(() => {
    return () => {
      clearResumeRecoveryTimer();
    };
  }, [clearResumeRecoveryTimer]);

  const currentTimeRef = useRef(0);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Sync progress to backend
  useEffect(() => {
    if (isPlaying && currentBook && currentChapter) {
      // Save progress immediately when starting
      const saveProgress = () => {
        apiClient.post('/api/progress', {
          bookId: currentBook.id,
          chapterId: currentChapter.id,
          position: Math.floor(currentTimeRef.current)
        }).catch(err => console.error('同步进度失败', err));
      };

      saveProgress();
      
      progressTimerRef.current = setInterval(saveProgress, 5000); // Every 5 seconds
    } else {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentBook?.id, currentChapter?.id]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      let browserDuration = audioRef.current.duration;
      
      // Handle infinite duration (common in streaming/transcoding)
      if (!Number.isFinite(browserDuration) || isNaN(browserDuration)) {
        if (currentChapter?.duration) {
          browserDuration = currentChapter.duration;
        }
      }

      setDuration(browserDuration);

      // Resume position from store if this is the initial load for this chapter
      if (isInitialLoadRef.current) {
        const resumePosition = usePlayerStore.getState().currentTime;
        if (resumePosition > 0) {
          // If progress is very close to the end (e.g., within 2 seconds or > 99%), start from the beginning
          if (browserDuration > 0 && (browserDuration - resumePosition < 2 || resumePosition / browserDuration > 0.99)) {
            console.log(`Chapter ${currentChapter?.title} 已完成，从头开始`);
            audioRef.current.currentTime = 0;
            setCurrentTime(0);
          } else {
            console.log(`继续章节 ${currentChapter?.title} at ${resumePosition}s`);
            audioRef.current.currentTime = resumePosition;
          }
        }
      }

      // Ensure playback rate is applied
      audioRef.current.playbackRate = playbackSpeed;

      // Sync duration back to server if it's significantly different and valid
      if (currentChapter && Number.isFinite(browserDuration) && browserDuration > 0) {
        const diff = Math.abs(browserDuration - (currentChapter.duration || 0));
        if (diff > 2) {
          console.log(`同步准确的持续时间: ${currentChapter.title}: ${browserDuration}s`);
          apiClient.patch(`/api/chapters/${currentChapter.id}`, { duration: browserDuration })
            .catch(err => console.error('同步持续时间失败', err));
        }
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setSeekTime(time);
    if (!isSeeking) {
      if (isNative && mediaRef.current && !shouldTranscode) {
        performSeek(time);
      } else if (!isNative && audioRef.current && !shouldTranscode) {
        audioRef.current.currentTime = time;
      }
      setCurrentTime(time);
    }
  };

  const handleSeekStart = () => {
    setIsSeeking(true);
    setSeekTime(currentTime);
  };

  const handleSeekEnd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setIsSeeking(false);
    isSeekingRef.current = false;

    if (shouldTranscode) {
      streamOffsetRef.current = time;
      const url = getStreamUrl(currentChapter!.id, time) + (retryCount > 0 ? `&retry=${retryCount}` : '');
      if (isNative) initNativeMedia(url);
      else if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        audioRef.current.play().catch(() => {});
      }
      setCurrentTime(time);
      return;
    }

    if (isNative && mediaRef.current) {
      performSeek(time);
    } else if (!isNative && audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || isNaN(time) || time < 0) return '0:00';
    const h = Math.floor(time / 3600);
    const m = Math.floor((time % 3600) / 60);
    const s = Math.floor(time % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getChapterProgressText = (chapter: any) => {
    if (!chapter.progressPosition || !chapter.duration) return null;
    
    const percent = Math.floor((chapter.progressPosition / chapter.duration) * 100);
    if (percent === 0) return null;
    if (percent >= 95) return '已播完';
    return `已播${percent}%`;
  };

  const hiddenPaths = ['/admin', '/settings', '/downloads', '/cache'];
  const isHiddenPage = hiddenPaths.some(path => location.pathname.startsWith(path));
  const isWidgetMode = window.location.pathname.startsWith('/widget');

  // Auto collapse player when navigating to hidden pages
  useEffect(() => {
    if (isHiddenPage && isExpanded) {
      setTimeout(() => setIsExpanded(false), 0);
    }
  }, [location.pathname, isExpanded, isHiddenPage, setIsExpanded]);

  useEffect(() => {
    setShowVolumeControl(false);
  }, [isExpanded]);

  // Fullscreen Logic for Widget
  const toggleFullscreen = async () => {
    if (!isWidgetMode) {
      setIsExpanded(true);
      return;
    }

    // Check if fullscreen is allowed
    if (!document.fullscreenEnabled) {
      console.warn('在此上下文中未启用全屏');
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsExpanded(true);
      } else {
        await document.exitFullscreen();
        setIsExpanded(false);
      }
    } catch (err) {
      console.error('切换全屏时出错:', err);
      // Do NOT fallback to isExpanded=true if fullscreen fails
      // This prevents the UI from breaking inside a small iframe
    }
  };

  // Exit Expanded/Fullscreen View
  const handleExitExpanded = async () => {
    if (isWidgetMode && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        console.error('退出全屏时出错:', err);
      }
    }
    setIsExpanded(false);
  };

  // Sync state when fullscreen changes (e.g. user presses Esc)
  useEffect(() => {
    if (!isWidgetMode) return;

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isWidgetMode, setIsExpanded]);

  if (!currentChapter) return null;

  const miniPlayerStyle = !isExpanded ? { 
    bottom: isWidgetMode ? '0' : 'var(--mini-player-offset)',
    height: isWidgetMode ? '100%' : (isCollapsed ? '64px' : 'var(--player-h)'),
    left: isWidgetMode ? '0' : undefined,
    right: isWidgetMode ? '0' : undefined,
  } : {};

  const handleEnded = () => {
    if (currentChapter?.id) {
      finalizeChapterPlayback(currentChapter.id, duration);
    }
  };

  return (
    <div 
      className={`
        absolute transition-all duration-500 ease-in-out
        ${(isHiddenPage || isSeriesEditing) && !isExpanded ? 'translate-y-full opacity-0 pointer-events-none' : ''}
        ${isExpanded 
          ? 'inset-0 z-[110] bg-white dark:bg-slate-950' 
          : 'left-0 right-0 z-[30] bg-transparent pointer-events-none'
        }
      `}
      style={miniPlayerStyle}
    >
      {!isNative && (
        <audio
          ref={audioRef}
          src={getStreamUrl(currentChapter.id)}
          crossOrigin="anonymous"
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onPlay={() => {
            if (currentChapter?.id && chapterEndHandledRef.current === currentChapter.id && (audioRef.current?.currentTime ?? 0) < 1) {
              chapterEndHandledRef.current = null;
            }
            setIsPlaying(true);
            if (audioRef.current) {
              audioRef.current.playbackRate = playbackSpeed;
            }
          }}
          onPause={() => {
            const audio = audioRef.current;
            const state = usePlayerStore.getState();
            const liveTime = audio?.currentTime ?? state.currentTime;
            const liveDuration = Number.isFinite(audio?.duration) ? (audio?.duration ?? 0) : state.duration;
            const reachedEnd = !!audio && (
              audio.ended ||
              (Number.isFinite(liveDuration) && liveDuration > 0 && liveTime >= liveDuration - 0.25)
            );

            if (reachedEnd && currentChapter?.id) {
              finalizeChapterPlayback(currentChapter.id, liveDuration || liveTime);
              return;
            }

            // If the user wants to ignore audio focus, and the player was unexpectedly paused 
            // by the system (i.e. isPlaying is still true in the store), force it to resume.
            if (state.ignoreAudioFocus && state.isPlaying) {
               console.log('System paused audio but ignoreAudioFocus is true, forcing play...');
               setTimeout(() => {
                  if (audioRef.current && usePlayerStore.getState().isPlaying) {
                     void requestPlay('resume-check');
                  }
               }, 50);
            } else {
               markPlaybackPaused(liveTime);
            }
          }}
          onError={(e) => {
            const audio = audioRef.current;
            console.log('触发音频错误事件', { 
              error: audio?.error, 
              code: audio?.error?.code, 
              message: audio?.error?.message,
              retryCount,
              shouldTranscode
            });

            if (audio && audio.error) {
              if (audio.error.code === 1) {
                console.log('播放已中止 (用户操作)');
                return;
              }

              if (retryCount < 3) {
                   console.log(`Playback error ${audio.error.code}, 使用转码重试 (${retryCount + 1}/3)...`);
                   setShouldTranscode(true);
                   setRetryCount(prev => prev + 1);
                   return;
              }
              console.error('音频元素错误', audio.error);
            } else {
              if (retryCount < 3) {
                  console.log('未知的音频错误，尝试转码重试...');
                  setShouldTranscode(true);
                  setRetryCount(prev => prev + 1);
                  return;
              }
              console.error('音频元素错误 (未知)', e);
            }
            setError('音频加载出错，请尝试重新扫描库或稍后再试');
          }}
        />
      )}

      {error && !isExpanded && (
        <div className="absolute top-0 left-4 right-4 bg-red-500 text-white text-[10px] py-1 px-2 text-center rounded-t-lg animate-pulse z-[101]">
          {error}
        </div>
      )}

      {/* Mini Player - Floating Card Style on Mobile */}
      {!isExpanded && (
        <div className={`h-full ${isWidgetMode ? 'px-0' : 'px-2 sm:px-4'} pointer-events-none`}>
          {isCollapsed ? (
            /* Collapsed State - Cover Only in Bottom Left */
            <div 
              className="h-full flex items-end justify-start pointer-events-auto pb-2 pl-2"
              onClick={() => setIsCollapsed(false)}
            >
              <div 
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden shadow-2xl cursor-pointer hover:scale-105 transition-transform border-2 border-white/50 dark:border-slate-700/50"
                style={{ 
                  borderColor: effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.3) : undefined
                }}
              >
                <img 
                  src={getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id)} 
                  alt={currentBook?.title}
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover';
                  }}
                />
              </div>
            </div>
          ) : (
            /* Normal Mini Player */
          <div 
            className={`
              h-full ${isWidgetMode ? 'max-w-none rounded-none border-none shadow-none' : 'max-w-7xl mx-auto rounded-2xl sm:rounded-3xl shadow-2xl shadow-black/10 border border-slate-200/50 dark:border-slate-800/50'}
              bg-white/95 dark:bg-slate-900/95 backdrop-blur-md 
              flex items-center justify-between gap-3 sm:gap-4 ${isWidgetMode ? 'px-3 max-[380px]:flex-col max-[380px]:justify-center max-[380px]:gap-1.5 max-[380px]:py-2' : 'px-3 sm:px-6'} pointer-events-auto
              transition-all duration-300
            `}
            style={{ 
              backgroundColor: isWidgetMode ? undefined : (miniPlayerThemeColor ? setAlpha(miniPlayerThemeColor, 0.05) : undefined),
              borderColor: isWidgetMode ? undefined : (miniPlayerThemeColor ? setAlpha(miniPlayerThemeColor, 0.2) : undefined)
            }}
          >
            {/* Info */}
            <div className={`flex items-center gap-2 sm:gap-3 min-w-0 ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:max-w-none' : ''} max-[500px]:max-w-[48px] max-[380px]:max-w-[40px] sm:max-w-[200px] md:max-w-[240px] lg:max-w-[320px] md:flex-none flex-1`}>
              <div 
                className="w-12 h-12 max-[380px]:w-10 max-[380px]:h-10 sm:w-16 sm:h-16 rounded-lg sm:rounded-xl overflow-hidden shadow-md cursor-pointer shrink-0"
                onClick={toggleFullscreen}
              >
                <img 
                  src={getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id)} 
                  alt={currentBook?.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover';
                  }}
                />
              </div>
              <div className="min-w-0 flex-1 hidden min-[500px]:block md:block max-[380px]:hidden">
                <h4 className="font-bold dark:text-white truncate text-sm max-[380px]:text-xs">{currentBook?.title}</h4>
                <p className="text-slate-500 truncate text-xs max-[380px]:text-[10px]">{currentChapter.title}</p>
              </div>
            </div>

            {/* Widget Vertical Layout: Progress Bar (Visible only on small widget) */}
            {isWidgetMode && (
              <div className="hidden max-[380px]:block w-full px-1 py-1">
                 <ProgressBar 
                   isMini={true} 
                   isSeeking={isSeeking}
                   seekTime={seekTime}
                   currentTime={currentTime}
                   duration={duration}
                   bufferedTime={bufferedTime}
                  themeColor={miniPlayerThemeColor}
                  onSeek={handleSeek}
                   onSeekStart={handleSeekStart}
                   onSeekEnd={handleSeekEnd}
                 />
              </div>
            )}

            {/* Controls (Desktop) */}
            <div className="hidden md:flex flex-col items-center gap-1.5 flex-1 max-xl:max-w-xl px-4 lg:px-8">
              <div className="flex items-center gap-6">
                <button 
                  onClick={prevChapter} 
                  className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`}
                  style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                >
                  <SkipBack size={20} fill="currentColor" />
                </button>
                <button 
                  onClick={() => { 
                  const current = usePlayerStore.getState().currentTime;
                  const newTime = Math.max(0, current - 15);
                  if (isNative) performSeek(newTime);
                  else if (audioRef.current) audioRef.current.currentTime -= 15;
                }}
                  className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`}
                  style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                >
                  <RotateCcw size={18} />
                </button>
                <button 
                  onClick={togglePlayback}
                  className={`w-10 h-10 rounded-full text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all ${!effectiveThemeColor ? 'bg-primary-600 dark:bg-primary-600' : ''}`}
                  style={{ 
                    backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined,
                    boxShadow: effectiveThemeColor ? `0 10px 15px -3px ${setAlpha(effectiveThemeColor, 0.3)}` : undefined,
                    color: (effectiveThemeColor && isLight(effectiveThemeColor)) ? '#475569' : (effectiveThemeColor ? '#ffffff' : undefined)
                  }}
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                </button>
                <button 
                  onClick={() => { 
                  const current = usePlayerStore.getState().currentTime;
                  const newTime = current + 30;
                  if (isNative) performSeek(newTime);
                  else if (audioRef.current) audioRef.current.currentTime += 30;
                }}
                  className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`}
                  style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                >
                  <RotateCw size={18} />
                </button>
                <button 
                  onClick={nextChapter} 
                  className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`}
                  style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                >
                  <SkipForward size={20} fill="currentColor" />
                </button>
              </div>

              <div className="w-full flex items-center gap-3">
                <span className="text-[10px] text-slate-400 w-8 text-right">{formatTime(currentTime)}</span>
                <ProgressBar 
                  isMini={true} 
                  isSeeking={isSeeking}
                  seekTime={seekTime}
                  currentTime={currentTime}
                  duration={duration}
                  bufferedTime={bufferedTime}
                  themeColor={miniPlayerThemeColor}
                  onSeek={handleSeek}
                  onSeekStart={handleSeekStart}
                  onSeekEnd={handleSeekEnd}
                />
                <span className="text-[10px] text-slate-400 w-8">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Mobile Controls - Only visible on small screens */}
            <div className={`flex md:hidden items-center gap-2 sm:gap-3 flex-1 min-w-0 justify-end ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:justify-center max-[380px]:gap-6 max-[380px]:flex-none' : ''}`}>
              <div className={`flex-1 min-w-0 h-1.5 py-4 flex items-center w-full ${isWidgetMode ? 'max-[380px]:hidden' : ''}`}>
                <ProgressBar 
                  isMini={true} 
                  isSeeking={isSeeking}
                  seekTime={seekTime}
                  currentTime={currentTime}
                  duration={duration}
                  bufferedTime={bufferedTime}
                  themeColor={miniPlayerThemeColor}
                  onSeek={handleSeek}
                  onSeekStart={handleSeekStart}
                  onSeekEnd={handleSeekEnd}
                />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isWidgetMode && (
                  <div className="flex items-center gap-1">
                    <button 
                    onClick={() => { 
                    const current = usePlayerStore.getState().currentTime;
                    const newTime = Math.max(0, current - 15);
                    if (isNative) performSeek(newTime);
                    else if (audioRef.current) audioRef.current.currentTime -= 15;
                  }}
                    className={`p-1.5 transition-colors hover:text-primary-500 ${useDarkControls ? 'text-slate-200' : 'text-slate-400 dark:text-slate-300'}`}
                    style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button 
                    onClick={prevChapter}
                    className={`p-1.5 transition-colors hover:text-primary-500 ${useDarkControls ? 'text-slate-200' : 'text-slate-400 dark:text-slate-300'}`}
                    style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                  >
                      <SkipBack size={16} fill="currentColor" />
                    </button>
                  </div>
                )}
                <button 
                  onClick={togglePlayback}
                  className={`w-10 h-10 max-[380px]:w-8 max-[380px]:h-8 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition-transform ${!effectiveThemeColor ? 'bg-primary-600 dark:bg-primary-600' : ''}`}
                  style={{ 
                    backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined,
                    color: (effectiveThemeColor && isLight(effectiveThemeColor)) ? '#475569' : (effectiveThemeColor ? '#ffffff' : undefined)
                  }}
                >
                  {isPlaying ? <Pause size={20} className="max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" /> : <Play size={20} className="ml-1 max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" />}
                </button>
                {isWidgetMode && (
                  <div className="flex items-center gap-1">
                    {/* Always show Next button */}
                    <button 
                      onClick={nextChapter}
                      className={`p-1.5 transition-colors hover:text-primary-500 ${useDarkControls ? 'text-slate-200' : 'text-slate-400 dark:text-slate-300'}`}
                      style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                    >
                      <SkipForward size={16} fill="currentColor" />
                    </button>
                    <button 
                      onClick={() => { 
                      const current = usePlayerStore.getState().currentTime;
                      const newTime = current + 30;
                      if (isNative) performSeek(newTime);
                      else if (audioRef.current) audioRef.current.currentTime += 30;
                    }}
                      className={`p-1.5 transition-colors hover:text-primary-500 ${useDarkControls ? 'text-slate-200' : 'text-slate-400 dark:text-slate-300'}`}
                      style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                    >
                      <RotateCw size={16} />
                    </button>
                  </div>
                )}
                {!isWidgetMode && (
                  <button 
                    onClick={() => setIsCollapsed(true)}
                    className={`p-2 transition-colors ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`}
                    style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                    title="收起播放器"
                  >
                    <ChevronLeft size={24} />
                  </button>
                )}
              </div>
            </div>

            {/* Desktop Extra Controls - Visible on Tablet and Desktop */}
            <div className="hidden md:flex items-center gap-4 lg:gap-6 min-w-[100px] lg:min-w-[140px] justify-end">
              {/* Volume Control */}
              <div className="relative" ref={!isExpanded ? volumeControlRef : null}>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVolumeControl(!showVolumeControl);
                  }}
                  className={`transition-colors p-1 hover:scale-110 flex items-center gap-1 ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`}
                  style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                  title="音量"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX size={20} />
                  ) : (
                    <Volume2 size={20} />
                  )}
                </button>

                {showVolumeControl && (
                  <div 
                    className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 shadow-xl rounded-full py-4 border border-slate-100 dark:border-slate-700 w-12 flex flex-col items-center gap-3 z-[220] animate-in zoom-in-95 duration-200 cursor-default"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[10px] font-bold text-slate-500 min-w-[24px] text-center select-none">
                      {Math.round(volume * 100)}
                    </span>
                    
                    <div className="h-24 w-full flex items-center justify-center relative">
                      <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.01"
                        value={volume}
                        onChange={(e) => {
                          setVolume(parseFloat(e.target.value));
                          if (isMuted && parseFloat(e.target.value) > 0) setIsMuted(false);
                        }}
                        className="absolute w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary-600 -rotate-90 hover:accent-primary-500"
                      />
                    </div>

                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className={`p-2 rounded-full transition-colors ${
                        isMuted 
                          ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30' 
                          : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title={isMuted ? "取消静音" : "静音"}
                    >
                      {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                  </div>
                )}
              </div>

              <button 
                onClick={() => setPlaybackSpeed(playbackSpeed === 2 ? 1 : playbackSpeed + 0.25)} 
                className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${useDarkControls ? 'text-slate-200 hover:text-white' : 'dark:text-slate-300'}`}
                style={{ 
                  backgroundColor: (miniPlayerThemeColor && !useDarkControls) ? setAlpha(miniPlayerThemeColor, 0.1) : undefined,
                  color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.8)) : undefined
                }}
              >
                {playbackSpeed}x
              </button>
              <button 
                onClick={() => setIsCollapsed(true)} 
                className={`transition-colors p-1 hover:scale-110 ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`}
                style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                title="收起播放器"
              >
                <ChevronLeft size={20} />
              </button>
              <button 
                onClick={() => setIsExpanded(true)} 
                className={`transition-colors p-1 hover:scale-110 ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`}
                style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}
                title="展开播放器"
              >
                <Maximize2 size={20} />
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Expanded Player View */}
      {isExpanded && (
        <div 
          className="absolute inset-0 flex flex-col px-4 pt-[calc(3rem+env(safe-area-inset-top))] pb-40 sm:p-8 md:p-12 overflow-y-auto animate-in slide-in-from-bottom duration-500 xl:pb-12 bg-white dark:bg-slate-950"
          style={{ backgroundColor: isWidgetMode ? (effectiveThemeColor ? toSolidColor(effectiveThemeColor) : '#1e293b') : (effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.05) : undefined) }}
        >
          {/* Header */}
          <div className="flex items-center justify-between w-full max-w-4xl mx-auto mb-4 sm:mb-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-2 sm:p-3 rounded-2xl shadow-sm border border-slate-200/30 dark:border-slate-800/30">
            <button 
              onClick={handleExitExpanded}
              className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors"
            >
              <ArrowLeft size={20} className="sm:w-6 sm:h-6 dark:text-white text-[#4A3728]" />
            </button>
            <div className="flex-1 text-center px-2 sm:px-4 min-w-0">
              <h2 className="text-sm sm:text-lg font-bold dark:text-white text-[#4A3728] truncate">{currentBook?.title}</h2>
              <p className="text-[10px] sm:text-xs text-slate-500 truncate">{currentChapter.title}</p>
            </div>
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button 
                onClick={() => {
                  // Calculate group index for current chapter
                  if (currentChapter && chapters.length > 0) {
                    // Determine if target chapter is in main or extra
                    const isExtra = !!currentChapter.isExtra || /番外|SP|Extra/i.test(currentChapter.title);
                    const targetTab = isExtra ? 'extra' : 'main';
                    if (activeTab !== targetTab) setActiveTab(targetTab);

                    const targetList = chapters.filter(c => {
                         const cIsExtra = !!c.isExtra || /番外|SP|Extra/i.test(c.title);
                         return (cIsExtra === isExtra);
                    });
                    
                    const index = targetList.findIndex(c => c.id === currentChapter.id);
                    if (index !== -1) {
                      const groupIndex = Math.floor(index / chaptersPerGroup);
                      setCurrentGroupIndex(groupIndex);
                      
                      // Auto scroll to current chapter and group tab
                      setTimeout(() => {
                        // 1. Scroll to chapter
                        const chapterEl = document.getElementById(`player-chapter-${currentChapter.id}`);
                        if (chapterEl) {
                          chapterEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }

                        // 2. Scroll group tab into view
                        const groupTab = document.getElementById(`player-group-tab-${groupIndex}`);
                        const container = scrollRef.current;
                        if (groupTab && container) {
                          const containerWidth = container.offsetWidth;
                          const tabWidth = groupTab.offsetWidth;
                          const tabLeft = groupTab.offsetLeft;
                          
                          container.scrollTo({
                            left: tabLeft - containerWidth / 2 + tabWidth / 2,
                            behavior: 'smooth'
                          });
                        }
                      }, 100);
                    }
                  }
                  setShowChapters(true);
                }}
                className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors"
                title="章节列表"
              >
                <ListMusic size={18} className="sm:w-5 sm:h-5 dark:text-white text-[#4A3728]" />
              </button>
              <button 
                onClick={() => setShowSettings(true)}
                className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors"
              >
                <Settings size={18} className="sm:w-5 sm:h-5 dark:text-white text-[#4A3728]" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full gap-4 sm:gap-8">
            <div className="w-full max-w-[240px] sm:max-w-[320px] lg:max-w-[400px] aspect-square rounded-[32px] sm:rounded-[40px] overflow-hidden shadow-2xl border-4 sm:border-8 border-white dark:border-slate-800 transition-all duration-500">
              <img 
                src={getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id)} 
                alt={currentBook?.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover';
                }}
              />
            </div>

            <div className="w-full space-y-8 sm:space-y-12">
              {/* Progress Bar Section */}
              <div className="px-2 sm:px-4">
                <div className="flex items-center gap-3 sm:gap-6">
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 min-w-[40px] text-right">
                    {formatTime(currentTime)}
                  </span>
                  <div className="flex-1">
                    <ProgressBar 
                      isSeeking={isSeeking}
                      seekTime={seekTime}
                      currentTime={currentTime}
                      duration={duration}
                      bufferedTime={bufferedTime}
                      themeColor={themeColor}
                      onSeek={handleSeek}
                      onSeekStart={handleSeekStart}
                      onSeekEnd={handleSeekEnd}
                    />
                  </div>
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 min-w-[40px]">
                    {formatTime(duration)}
                  </span>

                  {/* Volume Control */}
                  <div className="relative" ref={volumeControlRef}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowVolumeControl(!showVolumeControl);
                      }}
                      className="p-1.5 sm:p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                      title="音量"
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX size={18} className="sm:w-5 sm:h-5" />
                      ) : (
                        <Volume2 size={18} className={`sm:w-5 sm:h-5 ${showVolumeControl ? 'text-primary-600' : ''}`} />
                      )}
                    </button>

                    {showVolumeControl && (
                      <div 
                        className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 shadow-xl rounded-full py-4 border border-slate-100 dark:border-slate-700 w-12 flex flex-col items-center gap-3 z-[220] animate-in zoom-in-95 duration-200 cursor-default"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[10px] font-bold text-slate-500 min-w-[24px] text-center select-none">
                          {Math.round(volume * 100)}
                        </span>
                        
                        <div className="h-24 w-full flex items-center justify-center relative">
                          <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.01"
                            value={volume}
                            onChange={(e) => {
                              setVolume(parseFloat(e.target.value));
                              if (isMuted && parseFloat(e.target.value) > 0) setIsMuted(false);
                            }}
                            className="absolute w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary-600 -rotate-90 hover:accent-primary-500"
                          />
                        </div>

                        <button
                          onClick={() => setIsMuted(!isMuted)}
                          className={`p-2 rounded-full transition-colors ${
                            isMuted 
                              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30' 
                              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                          title={isMuted ? "取消静音" : "静音"}
                        >
                          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Main Controls */}
              <div className="flex items-center justify-center gap-4 sm:gap-10 md:gap-14">
                <button 
                  onClick={() => { 
                  const current = usePlayerStore.getState().currentTime;
                  const newTime = Math.max(0, current - 15);
                  if (isNative) performSeek(newTime);
                  else if (audioRef.current) audioRef.current.currentTime -= 15;
                }}
                  className="text-slate-600 dark:text-slate-400 p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <div className="relative">
                    <RotateCcw size={24} className="sm:w-8 sm:h-8" />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] sm:text-[10px] font-bold mt-0.5">15</span>
                  </div>
                </button>
                <button 
                  onClick={prevChapter}
                  className="text-slate-900 dark:text-white p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <SkipBack size={28} className="sm:w-9 sm:h-9" fill="currentColor" />
                </button>
                
                <button 
                  onClick={togglePlayback}
                  className={`w-16 h-16 sm:w-24 sm:h-24 rounded-full text-white flex items-center justify-center shadow-2xl transform hover:scale-105 active:scale-95 transition-all ${!effectiveThemeColor ? 'bg-primary-600' : ''}`}
                  style={effectiveThemeColor ? { 
                    backgroundColor: toSolidColor(effectiveThemeColor),
                    color: isLight(effectiveThemeColor) ? '#475569' : '#ffffff'
                  } : {}}
                >
                  {isPlaying ? <Pause size={32} className="sm:w-12 sm:h-12" fill="currentColor" /> : <Play size={32} className="sm:w-12 sm:h-12 ml-1 sm:ml-2" fill="currentColor" />}
                </button>

                <button 
                  onClick={nextChapter}
                  className="text-slate-900 dark:text-white p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <SkipForward size={28} className="sm:w-9 sm:h-9" fill="currentColor" />
                </button>
                <button 
                  onClick={() => { 
                  const current = usePlayerStore.getState().currentTime;
                  const newTime = current + 15;
                  if (isNative) performSeek(newTime);
                  else if (audioRef.current) audioRef.current.currentTime += 15;
                }}
                  className="text-slate-600 dark:text-slate-400 p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <div className="relative">
                    <RotateCw size={24} className="sm:w-8 sm:h-8" />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] sm:text-[10px] font-bold mt-0.5">15</span>
                  </div>
                </button>
              </div>

              {/* Bottom Row Controls */}
              <div className="flex justify-between items-center max-w-2xl mx-auto w-full px-2 sm:px-4 text-slate-600 dark:text-slate-400">
                <button 
                  onClick={() => setPlaybackSpeed(playbackSpeed >= 2 ? 0.5 : playbackSpeed + 0.25)}
                  className="flex flex-col items-center gap-1 sm:gap-1.5 transition-all active:scale-95 group relative"
                >
                  <div className="p-2 rounded-xl group-hover:bg-white/40 dark:group-hover:bg-slate-800/40 transition-colors">
                    <Zap size={18} className={`sm:w-5 sm:h-5 ${playbackSpeed !== 1 ? 'text-primary-600 animate-pulse' : ''}`} />
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold">{playbackSpeed}x</span>
                </button>



                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  <div className="p-2">
                    <SkipBack size={18} className="sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">片头 {currentBook?.skipIntro || 0}s</span>
                </div>

                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  <div className="p-2">
                    <SkipForward size={18} className="sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">片尾 {currentBook?.skipOutro || 0}s</span>
                </div>

                <div className="relative" ref={timerMenuRef}>
                  <button 
                    onClick={() => setShowSleepTimer(!showSleepTimer)}
                    className="flex flex-col items-center gap-1 sm:gap-1.5 transition-all active:scale-95 group"
                  >
                    <div className="p-2 rounded-xl group-hover:bg-white/40 dark:group-hover:bg-slate-800/40 transition-colors">
                      <Clock size={18} className={`sm:w-5 sm:h-5 ${sleepTimer ? 'text-primary-600' : ''}`} />
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">
                      {sleepTimer ? `${Math.floor(sleepTimer / 60)}:${(sleepTimer % 60).toString().padStart(2, '0')}` : '定时'}
                    </span>
                  </button>
                  
                  {showSleepTimer && (
                    <div className="absolute bottom-full mb-4 right-0 bg-white dark:bg-slate-800 shadow-2xl rounded-2xl p-3 sm:p-4 border border-slate-100 dark:border-slate-700 min-w-[180px] sm:min-w-[200px] flex flex-col gap-2 z-[220] animate-in zoom-in-95 duration-200">
                      <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700 mb-1 text-center">
                        睡眠定时
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[15, 30, 45, 60].map(mins => (
                          <button
                            key={mins}
                            onClick={() => {
                              const duration = mins * 60;
                              const endTime = Date.now() + duration * 1000;
                              sleepTimerEndTimeRef.current = endTime;
                              setSleepTimer(duration);
                              setShowSleepTimer(false);
                            }}
                            className="px-3 py-2 text-xs sm:text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
                          >
                            {mins} 分钟
                          </button>
                        ))}
                      </div>

                      <div className="mt-1 flex items-center gap-1 p-1 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700 focus-within:border-primary-500/50 transition-colors">
                        <input
                          type="number"
                          min="1"
                          value={customMinutes}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || parseInt(val) >= 0) {
                              setCustomMinutes(val);
                            }
                          }}
                          placeholder="自定义分钟"
                          className="flex-1 bg-transparent border-none outline-none px-2 py-1.5 text-xs dark:text-white placeholder:text-slate-400 w-0"
                        />
                        <button
                          onClick={() => {
                            const mins = parseInt(customMinutes);
                            if (mins > 0) {
                              const duration = mins * 60;
                              const endTime = Date.now() + duration * 1000;
                              sleepTimerEndTimeRef.current = endTime;
                              setSleepTimer(duration);
                              setShowSleepTimer(false);
                              setCustomMinutes('');
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
                        >
                          开启
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          setSleepTimer(null);
                          sleepTimerEndTimeRef.current = null;
                          if (sleepTimerIntervalRef.current) {
                            clearInterval(sleepTimerIntervalRef.current);
                            sleepTimerIntervalRef.current = null;
                          }
                          setShowSleepTimer(false);
                        }}
                        className="mt-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 transition-colors"
                      >
                        取消定时
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Settings Modal */}
          {showSettings && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)}></div>
              <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 sm:p-8">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">播放设置</h3>
                    <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                      <X size={20} className="text-slate-400" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <SkipBack size={14} />
                        跳过片头 (秒)
                      </label>
                      <input 
                        type="number" 
                        value={editSkipIntro}
                        onChange={e => setEditSkipIntro(parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                        placeholder="例如: 30"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <SkipForward size={14} />
                        跳过片尾 (秒)
                      </label>
                      <input 
                        type="number" 
                        value={editSkipOutro}
                        onChange={e => setEditSkipOutro(parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                        placeholder="例如: 15"
                      />
                    </div>
                  </div>

                  <div className="mt-8 flex gap-3">
                    <button 
                      onClick={() => setShowSettings(false)}
                      className="flex-1 py-3.5 font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all"
                    >
                      取消
                    </button>
                    <button 
                      onClick={handleSaveSettings}
                      className="flex-1 py-3.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-2xl shadow-lg shadow-primary-500/30 flex items-center justify-center gap-2 transition-all"
                    >
                      <Check size={20} />
                      保存
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Chapter List Drawer */}
          {showChapters && (
            <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center">
              <div 
                className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300" 
                onClick={() => setShowChapters(false)}
              />
              <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] h-[80vh] sm:h-[70vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 shadow-2xl">
                <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <h3 className="text-lg sm:text-xl font-bold dark:text-white flex items-center gap-2">
                      <ListMusic size={24} className="text-primary-600" />
                      章节列表
                    </h3>
                    {extraChapters.length > 0 && (
                      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl scale-90 origin-left">
                        <button 
                          onClick={() => { setActiveTab('main'); setCurrentGroupIndex(0); }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'main' 
                              ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' 
                              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                          }`}
                        >
                          正文
                        </button>
                        <button 
                          onClick={() => { setActiveTab('extra'); setCurrentGroupIndex(0); }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'extra' 
                              ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' 
                              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                          }`}
                        >
                          番外
                        </button>
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => setShowChapters(false)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                  >
                    <ChevronUp className="rotate-180" size={24} />
                  </button>
                </div>

                {groups.length > 1 && (
                  <div className="relative group/nav border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center">
                    <button 
                      onClick={() => scrollGroups('left')}
                      className="absolute -left-4 sm:-left-7 top-1/2 -translate-y-1/2 z-10 p-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow-md rounded-full opacity-0 group-hover/nav:opacity-100 transition-opacity hidden sm:block border border-slate-100 dark:border-slate-700"
                    >
                      <ChevronLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div 
                      ref={scrollRef}
                      className="flex gap-2 p-4 overflow-x-auto no-scrollbar scroll-smooth snap-x mx-1 w-full"
                    >
                      {groups.map((group, index) => (
                        <button
                          key={index}
                          id={`player-group-tab-${index}`}
                          onClick={() => setCurrentGroupIndex(index)}
                          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border shrink-0 snap-start ${
                            currentGroupIndex === index
                              ? `text-white shadow-lg shadow-primary-500/30 ${!effectiveThemeColor ? 'bg-primary-600 border-primary-600' : ''}`
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                          }`}
                          style={currentGroupIndex === index ? { 
                            backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined,
                            borderColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined,
                            color: (effectiveThemeColor && isLight(effectiveThemeColor)) ? '#475569' : (effectiveThemeColor ? '#ffffff' : undefined)
                          } : {}}
                        >
                          第 {group.start}-{group.end} 章
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={() => scrollGroups('right')}
                      className="absolute -right-4 sm:-right-7 top-1/2 -translate-y-1/2 z-10 p-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow-md rounded-full opacity-0 group-hover/nav:opacity-100 transition-opacity hidden sm:block border border-slate-100 dark:border-slate-700"
                    >
                      <ChevronLeft size={20} className="rotate-180 text-slate-600 dark:text-slate-400" />
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(groups[currentGroupIndex]?.chapters || currentChapters).map((chapter, index) => {
                    const actualIndex = currentGroupIndex * chaptersPerGroup + index;
                    const isCurrent = currentChapter?.id === chapter.id;
                    
                    return (
                      <div 
                        key={chapter.id}
                        id={`player-chapter-${chapter.id}`}
                        onClick={() => {
                          playChapter(currentBook!, currentChapters, chapter);
                          setShowChapters(false);
                        }}
                        className={`group flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border ${
                          isCurrent 
                            ? 'bg-opacity-10 border-opacity-20' 
                            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-primary-200 dark:hover:border-primary-800'
                        }`}
                        style={isCurrent ? { 
                          backgroundColor: effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.1) : undefined,
                          borderColor: effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.3) : undefined,
                        } : {}}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div 
                            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center font-bold text-base sm:text-lg shrink-0 ${
                              isCurrent ? `text-white ${!effectiveThemeColor ? 'bg-primary-600' : ''}` : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                            style={isCurrent ? { 
                              backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined,
                              color: (effectiveThemeColor && isLight(effectiveThemeColor)) ? '#475569' : (effectiveThemeColor ? '#ffffff' : undefined)
                            } : {}}
                          >
                            {chapter.chapterIndex || (actualIndex + 1)}
                          </div>
                          <div className="min-w-0">
                            <p 
                              className={`text-sm sm:text-base font-bold truncate ${isCurrent ? '' : 'text-slate-900 dark:text-white'}`}
                              style={isCurrent ? { color: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined } : {}}
                            >
                              {chapter.title}
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              <div className="flex items-center gap-1 text-[10px] sm:text-xs text-slate-400 font-medium">
                                <Clock size={12} />
                                {formatTime(chapter.duration)}
                              </div>
                              {getChapterProgressText(chapter) && (
                                <div 
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                    getChapterProgressText(chapter) === '已播完' 
                                      ? 'bg-green-50 text-green-500 dark:bg-green-900/20' 
                                      : 'bg-primary-50 text-primary-600 dark:bg-primary-900/20'
                                  }`}
                                >
                                  {getChapterProgressText(chapter)}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {isCurrent && isPlaying && (
                          <div className="flex gap-1 items-end h-5">
                            <div className={`w-1 animate-music-bar-1 rounded-full ${!effectiveThemeColor ? 'bg-primary-600' : ''}`} style={{ backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined }}></div>
                            <div className={`w-1 animate-music-bar-2 rounded-full ${!effectiveThemeColor ? 'bg-primary-600' : ''}`} style={{ backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined }}></div>
                            <div className={`w-1 animate-music-bar-3 rounded-full ${!effectiveThemeColor ? 'bg-primary-600' : ''}`} style={{ backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined }}></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Player;
