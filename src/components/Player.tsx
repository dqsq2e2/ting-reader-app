import { Capacitor } from '@capacitor/core';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import apiClient from '../api/client';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
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
  Check,
  Volume2,
  VolumeX
} from 'lucide-react';
import { getCoverUrl } from '../utils/image';
import { toSolidColor, isLight } from '../utils/color';
import { CapacitorMusicControls as MusicControls } from 'capacitor-music-controls-plugin';
import type { Chapter } from '../types';

import ChapterList from './ChapterList';

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

type WindowWithMedia = {
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
  const playedPercent = (displayTime / (duration || 1)) * 100;
  const bufferedPercent = (bufferedTime / (duration || 1)) * 100;
  
  // Safety check for themeColor
  const safeThemeColor = themeColor || 'rgba(0,0,0,0.15)';
  const isDarkMode = document.documentElement.classList.contains('dark');
  const barColor = isDarkMode 
    ? safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0') 
    : safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0');

  return (
    <div 
      className={`relative group/progress ${isMini ? 'flex-1 h-3 sm:h-2' : 'w-full h-4'} flex items-center select-none touch-none`}
    >
      {/* Track Background */}
      <div 
        className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 ${isMini ? 'h-1' : 'h-1.5'} bg-slate-300 dark:bg-slate-900 rounded-full overflow-hidden`}
        style={{
          backgroundColor: themeColor ? (isMini ? themeColor.replace('0.15', '0.1').replace('0.1', '0.1') : 'rgba(0,0,0,0.2)') : undefined
        }}
      >
        {/* Buffered Bar */}
        <div 
          className="absolute inset-y-0 left-0 bg-slate-400/30 dark:bg-slate-700/40 transition-all duration-300" 
          style={{ width: `${bufferedPercent}%` }}
        />
        {/* Played Bar */}
        <div 
          className="absolute inset-y-0 left-0 z-10" 
          style={{ 
            width: `${playedPercent}%`,
            backgroundColor: barColor,
            boxShadow: `0 0 10px ${safeThemeColor.replace('0.15', '0.4').replace('0.1', '0.4')}`
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
        max={duration || 0} 
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
  const { 
    currentBook, 
    currentChapter, 
    isPlaying, 
    togglePlay, 
    currentTime, 
    duration, 
    setCurrentTime, 
    setDuration,
    nextChapter,
    prevChapter,
    playbackSpeed,
    setPlaybackSpeed,
    volume,
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

  const { token, activeUrl, serverUrl } = useAuthStore();
  const API_BASE_URL = activeUrl || serverUrl || import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
  
  const coverUrl = getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id);

  const [retryCount, setRetryCount] = useState(0);
  const [shouldTranscode, setShouldTranscode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamOffsetRef = useRef(0);
  const initMediaRef = useRef<(url: string) => void>(() => {});

  const handleEnded = useCallback(() => {
    console.log('Player: Chapter ended, triggering next chapter');
    if (currentBook && currentChapter && token) {
      // Use ref for duration to avoid dependency
      const finalDuration = durationRef.current || duration;
      apiClient.post('/api/progress', {
        bookId: currentBook.id,
        chapterId: currentChapter.id,
        position: Math.floor(finalDuration)
      }).catch(err => console.error('Failed to sync final progress', err));
    }
    nextChapter();
  }, [currentBook, currentChapter, token, duration, nextChapter]);

  const getStreamUrl = useCallback((chapterId: string, seekTime?: number) => {
    let url = `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
    if (shouldTranscode) {
      url += '&transcode=mp3';
      if (seekTime && seekTime > 0) {
          url += `&seek=${seekTime}`;
      }
    }
    return url;
  }, [API_BASE_URL, shouldTranscode, token]);

  // Helper to init media
  const initMedia = useCallback((url: string) => {
      // Keep reference to old media to release it AFTER creating new one
      // This prevents a gap where no media is active, which can cause Android to kill the background service
      const oldMedia = mediaRef.current;
      
      // Detach old media from ref immediately to prevent stale callbacks affecting UI
      // The callbacks check if (mediaRef.current !== media), so setting this ensures they bail out
      if (mediaRef.current) {
          mediaRef.current = null;
      }
      
      // Stop timer
      if (mediaTimerRef.current) {
          clearInterval(mediaTimerRef.current);
          mediaTimerRef.current = null;
      }

      console.log('Initializing Native Media:', url);
      
      // Check if Media is available (Cordova plugin)
      const mediaCtor = (window as WindowWithMedia).Media;
      if (!mediaCtor) {
          console.error('Cordova Media plugin not found!');
          if (oldMedia) oldMedia.release();
          return;
      }
      
      const finalUrl = url;
      console.log('Initializing Native Media (Final):', finalUrl);

      // Create new Media
      // new Media(src, mediaSuccess, mediaError, mediaStatus)
      const media = new mediaCtor(
          finalUrl,
          () => {
              console.log('Media Success (End of playback)');
              // Prevent stale callbacks triggering next chapter
              // If the current media ref has changed or is null, ignore this callback
              if (!mediaRef.current || mediaRef.current !== media) {
                  console.log('Ignoring stale media success callback');
                  return;
              }
              handleEnded();
          },
          (err) => {
              console.error('Media Error', err);
              
              // Prevent stale callbacks
              if (!mediaRef.current || mediaRef.current !== media) {
                  console.log('Ignoring stale media error callback');
                  return;
              }

              // Check for Aborted (1), Decode error (3), not supported (4), or Android specific errors (-38, etc)
              // -38 is often a state error, but can happen with unsupported formats
              // -2147483648 is a generic error, often related to seek race conditions
              const errorCode = err?.code;
              const shouldRetry = errorCode === 1 || errorCode === 3 || errorCode === 4 || (typeof errorCode === 'number' && errorCode < 0);

              // Special handling for the seek error to auto-recover without restart
              if (errorCode === -2147483648) {
                  console.warn('Caught generic media error (likely seek race condition), attempting to recover...');
                  // Re-init media at current position
                  const currentPos = usePlayerStore.getState().currentTime;
                  const currentId = usePlayerStore.getState().currentChapter?.id;
                  if (currentId) {
                      // Small delay to let the error settle
                      setTimeout(() => {
                          const url = getStreamUrl(currentId, currentPos);
                          initMediaRef.current(url);
                      }, 500);
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

              if (errorCode !== 0) {
                  setError(`播放出错: ${err?.message || err?.code || JSON.stringify(err)}`);
              }
          },
          (status: number) => {
              console.log('Media Status:', status);

              if (mediaRef.current !== media) {
                  console.log('Ignoring stale media status callback');
                  return;
              }

              if (mediaRef.current) {
                  mediaRef.current._status = status;
              }
              
              if (status === 2) { // Running
                  setIsPlaying(true);
                  
                  // Apply playback speed
                  // Note: Use 'media' instance directly, not ref
                  const applyRate = () => {
                      const speed = usePlayerStore.getState().playbackSpeed;
                      const vol = usePlayerStore.getState().volume;
                      if (typeof media.setRate === 'function') {
                          console.log('Setting playback rate to:', speed);
                          media.setRate(speed);
                      }
                      if (typeof media.setVolume === 'function') {
                          console.log('Setting playback volume to:', vol);
                          media.setVolume(vol);
                      }
                  };

                  applyRate();
                  // Re-apply after a short delay to ensure it sticks (Android issue)
                  setTimeout(applyRate, 300);
                  setTimeout(applyRate, 1000); // Try again a bit later

                  if (media._resumeTime && media._resumeTime > 0 && !media._initialSeekDone) {
                      console.log(`Performing initial seek to ${media._resumeTime}s`);
                      media.seekTo(media._resumeTime * 1000);
                  }

                  MusicControls.updateIsPlaying({
                      isPlaying: true,
                      elapsed: usePlayerStore.getState().currentTime
                  });
              } else if (status === 3 || status === 4) { // Paused or Stopped
                  setIsPlaying(false);
                  
                  MusicControls.updateIsPlaying({
                      isPlaying: false,
                      elapsed: usePlayerStore.getState().currentTime
                  });
              }
          }
      );
      
      media._status = 0;
      
      let resumeTime = usePlayerStore.getState().currentTime;
      const currentCh = usePlayerStore.getState().currentChapter;
      
      // If progress is very close to the end (e.g., within 2 seconds or > 99%), start from the beginning
      if (currentCh && currentCh.duration && currentCh.duration > 0) {
          if (currentCh.duration - resumeTime < 2 || resumeTime / currentCh.duration > 0.99) {
              console.log(`Chapter ${currentCh.title} was already finished, starting from beginning`);
              resumeTime = 0;
              setCurrentTime(0);
          }
      }
      
      // Fix for transcoding/server-side seek:
      // If the URL contains 'seek=', the server is already returning a stream starting at that position.
      // The client should NOT attempt to seek, as the stream start (0) corresponds to the seek time.
      if (url.includes('seek=')) {
          console.log('Server-side seek detected, disabling client-side initial seek');
          resumeTime = 0;
      }
      
      media._resumeTime = resumeTime;
      media._initialSeekDone = resumeTime <= 0;

      // Assign new media to ref
      mediaRef.current = media;
      
      // Play immediately
      if (usePlayerStore.getState().isPlaying) {
          media.play();
      }

      // Now it is safe to release the old media
      if (oldMedia) {
          console.log('Releasing old media instance');
          oldMedia.release();
      }
      
      mediaTimerRef.current = setInterval(() => {
          if (mediaRef.current) {
              mediaRef.current.getCurrentPosition(
                  (position: number) => {
                      if (position > -1) {
                          if (mediaRef.current?._resumeTime && mediaRef.current._resumeTime > 0 && !mediaRef.current._initialSeekDone) {
                              if (Math.abs(position - mediaRef.current._resumeTime) < 2) {
                                  mediaRef.current._initialSeekDone = true;
                              } else {
                                  return;
                              }
                          }

                          if (isSeekingRef.current) return;

                          const realPosition = position + streamOffsetRef.current;
                          setCurrentTime(realPosition);
                          
                          // Use ref for duration to avoid dependency loop
                          const d = mediaRef.current?.getDuration() || 0;
                          if (d > 0 && d !== durationRef.current && !shouldTranscode) {
                              setDuration(d);
                          }

                          MusicControls.updateElapsed({
                              elapsed: realPosition,
                              isPlaying: usePlayerStore.getState().isPlaying
                          });
                      }
                  },
                  () => {}
              );
          }
      }, 1000);
  }, [retryCount, shouldTranscode, handleEnded, setIsPlaying, setCurrentTime, setDuration, setError, getStreamUrl]);

  useEffect(() => {
      initMediaRef.current = initMedia;
  }, [initMedia]);

  useEffect(() => {
    if (!currentChapter) return;
    if (typeof (window as WindowWithMedia).electronAPI !== 'undefined') return;

    let isMounted = true;
    const chapterId = currentChapter.id;
    
    const loadAndPlay = async () => {
        if (!API_BASE_URL || !/^https?:\/\//i.test(API_BASE_URL)) {
            setError('服务器地址无效，请重新登录后重试');
            return;
        }

        // Build URL manually to avoid dependency on getStreamUrl
        let url = `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
        if (shouldTranscode) {
          url += '&transcode=mp3';
          // Initial seek handled by initMedia resumeTime logic or seek param
        }
        
        if (!isMounted) return;
        // Ensure we are still on the same chapter
        if (currentChapter.id !== chapterId) return;

        if (shouldTranscode && isInitialLoadRef.current && currentChapter.id === chapterId) {
                let resumeTime = usePlayerStore.getState().currentTime;
                // If progress is very close to the end, start from the beginning
                if (currentChapter && currentChapter.duration && currentChapter.duration > 0) {
                    if (currentChapter.duration - resumeTime < 2 || resumeTime / currentChapter.duration > 0.99) {
                        console.log(`Chapter ${currentChapter.title} was already finished, starting from beginning`);
                        resumeTime = 0;
                        setCurrentTime(0);
                    }
                }

                if (resumeTime > 0) {
                    console.log(`Resuming transcode stream from ${resumeTime}s`);
                    streamOffsetRef.current = resumeTime;
                    url += `&seek=${resumeTime}`;
                } else {
                    streamOffsetRef.current = 0;
                }
        } else {
                streamOffsetRef.current = 0;
        }

        initMedia(url);
    };

    loadAndPlay();

    return () => {
        isMounted = false;
        // Do not release media here to avoid killing background service during chapter transition
        // Media will be released in initMedia or when component unmounts
        if (mediaTimerRef.current) {
            clearInterval(mediaTimerRef.current);
        }
    };
    // Include all dependencies to satisfy linter
  }, [currentChapter, retryCount, shouldTranscode, API_BASE_URL, token, initMedia, setCurrentTime]);

  // Cleanup media on unmount only
  useEffect(() => {
      return () => {
          if (mediaRef.current) {
              console.log('Component unmounting, releasing media');
              mediaRef.current.release();
              mediaRef.current = null;
          }
      };
  }, []);

  const audioRef = useRef<HTMLAudioElement>(null); // Keep for Electron fallback? No, let's remove usage for App.
  const isSeekingRef = useRef(false);

  const location = useLocation();
  // const [isExpanded, setIsExpanded] = useState(false); // Moved to store
  const [showChapters, setShowChapters] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  
  // Ref for Native Media
  const mediaRef = useRef<MediaInstance | null>(null);
  const mediaTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'main' | 'extra'>('main');
  // scrollRef moved to ChapterList
  
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const { extraChapters } = React.useMemo(() => {
    const main: Chapter[] = [];
    const extra: Chapter[] = [];
    chapters.forEach(c => {
        const isExtra = !!c.isExtra || /番外|SP|Extra/i.test(c.title);
        if (isExtra) extra.push(c);
        else main.push(c);
    });
    return { mainChapters: main, extraChapters: extra };
  }, [chapters]);

  const [customMinutes, setCustomMinutes] = useState('');
  const [editSkipIntro, setEditSkipIntro] = useState(0);
  const [editSkipOutro, setEditSkipOutro] = useState(0);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const durationRef = useRef(duration);
  const currentBookId = currentBook?.id;
  const currentBookTitle = currentBook?.title || '';
  const currentBookCoverUrl = currentBook?.coverUrl;
  const currentBookLibraryId = currentBook?.libraryId;
  const currentChapterId = currentChapter?.id;
  const currentChapterTitle = currentChapter?.title || '';

  useEffect(() => {
    currentTimeRef.current = currentTime;
    isPlayingRef.current = isPlaying;
    // eslint-disable-next-line react-hooks/immutability
    durationRef.current = duration;
  }, [currentTime, isPlaying, duration]);

  // Use stored theme color from book to avoid flash
  useEffect(() => {
    if (currentBook?.themeColor) {
      setThemeColor(currentBook.themeColor);
    }
  }, [currentBook?.id, currentBook?.themeColor, setThemeColor]);

  useEffect(() => {
    if (!currentBook) return;
    const skipIntro = currentBook.skipIntro ?? 0;
    const skipOutro = currentBook.skipOutro ?? 0;
    setEditSkipIntro(skipIntro);
    setEditSkipOutro(skipOutro);
    localStorage.setItem(`offline_skip_${currentBook.id}`, JSON.stringify({ skip_intro: skipIntro, skip_outro: skipOutro }));
  }, [currentBook]);

  const handleSaveSettings = async () => {
    if (!currentBook) return;
    try {
      await apiClient.patch(`/api/books/${currentBook.id}`, {
        skip_intro: editSkipIntro,
        skip_outro: editSkipOutro
      });
      usePlayerStore.setState(state => ({
        currentBook: state.currentBook ? {
          ...state.currentBook,
          skipIntro: editSkipIntro,
          skipOutro: editSkipOutro
        } : null
      }));
      localStorage.setItem(`offline_skip_${currentBook.id}`, JSON.stringify({ skip_intro: editSkipIntro, skip_outro: editSkipOutro }));
      setShowSettings(false);
    } catch (err) {
      console.error('Failed to save settings', err);
    }
  };

  const chaptersPerGroup = 100;
  // groups logic moved to ChapterList

  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerMenuRef = useRef<HTMLDivElement>(null);

  const [bufferedTime, setBufferedTime] = useState(0);
  const [autoPreload, setAutoPreload] = useState(false);
  // const [clientAutoDownload, setClientAutoDownload] = useState(false); // Moved to store
  const isInitialLoadRef = useRef(true);
  
  // Fetch settings for auto_preload
  useEffect(() => {
    if (!token) return;
    apiClient.get('/api/settings').then(res => {
      // Check settingsJson first as these might be stored there
      const settingsJson = res.data.settingsJson || {};
      
      // For autoPreload and autoCache, prefer settingsJson value if present, otherwise fallback to root value
      // This handles the case where backend returns default values at root but actual user prefs in JSON
      const ap = settingsJson.autoPreload !== undefined ? settingsJson.autoPreload : 
                 (settingsJson.auto_preload !== undefined ? settingsJson.auto_preload : 
                 (res.data.autoPreload !== undefined ? res.data.autoPreload : res.data.auto_preload));
      
      setAutoPreload(!!ap);
      
    }).catch(err => console.error('Failed to fetch settings', err));
  }, [token]);

  // Fetch chapters for the current book
  useEffect(() => {
    if (currentBook?.id && token) {
      apiClient.get(`/api/books/${currentBook.id}/chapters`).then(res => {
        setChapters(res.data);
        setCurrentGroupIndex(0); // Reset group index when book changes
      }).catch(err => console.error('Failed to fetch chapters', err));
    }
  }, [currentBook?.id, token]);
  
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

  // Auto-scroll logic moved to ChapterList

  // Reset initial load ref when chapter changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    isInitialLoadRef.current = true;
    setBufferedTime(0);
    setRetryCount(0);
    setShouldTranscode(false);
    streamOffsetRef.current = 0;
  }, [currentChapter?.id]);



  // Handle Play/Pause Toggle
  useEffect(() => {
    if (typeof (window as WindowWithMedia).electronAPI !== 'undefined') return;
    
    if (mediaRef.current) {
        try {
            if (isPlaying) {
                // Only call play if not already running (though plugin handles it usually)
                mediaRef.current.play();
            } else {
                // Only call pause if status indicates it's running/starting/paused
                // Avoid calling pause on MEDIA_NONE (0)
                // Also check if mediaRef.current is valid
                const status = mediaRef.current._status;
                // Cordova Media status: 0=None, 1=Starting, 2=Running, 3=Paused, 4=Stopped
                if (status === 1 || status === 2 || status === 3) {
                     mediaRef.current.pause();
                } else {
                    console.log(`Skipping pause for invalid state: ${status}`);
                }
            }
        } catch (e) {
            console.warn('Error toggling play/pause', e);
        }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (typeof (window as WindowWithMedia).electronAPI === 'undefined') return;
    if (!audioRef.current) return;
    if (isPlaying) {
        audioRef.current.play().catch(() => {});
    } else {
        audioRef.current.pause();
    }
  }, [isPlaying]);
  
  // Handle Volume
  useEffect(() => {
    if (mediaRef.current?.setVolume) {
        mediaRef.current.setVolume(volume);
    }
  }, [volume]);
  
  // Handle Speed - Cordova Media doesn't support setRate easily on all platforms?
  // Android supports setRate since API 23.
  useEffect(() => {
      if (mediaRef.current && typeof mediaRef.current.setRate === 'function') {
          console.log('Applying playback speed change:', playbackSpeed);
          mediaRef.current.setRate(playbackSpeed);
      }
  }, [playbackSpeed]);

  // Media Session / Music Controls Support - Listeners
  useEffect(() => {
    // Listen for events
    // We set these up once. Using store getState() ensures we always access fresh state/actions.
    MusicControls.addListener('music-controls-next', () => {
        usePlayerStore.getState().nextChapter();
    });
    MusicControls.addListener('music-controls-previous', () => {
        usePlayerStore.getState().prevChapter();
    });
    MusicControls.addListener('music-controls-pause', () => {
        usePlayerStore.getState().togglePlay();
    });
    MusicControls.addListener('music-controls-play', () => {
        usePlayerStore.getState().togglePlay();
    });
    MusicControls.addListener('music-controls-destroy', () => {
        // usePlayerStore.getState().setIsPlaying(false);
        // Instead of stopping, maybe just pause?
        usePlayerStore.getState().togglePlay();
    });
    MusicControls.addListener('music-controls-toggle-play-pause', () => {
            usePlayerStore.getState().togglePlay();
    });
    MusicControls.addListener('music-controls-seek-to', (payload: { position: number }) => {
            console.log('Received seek-to event:', payload);
            const time = payload.position;

            if (shouldTranscode) {
                 // Reload for transcode seek
                 console.log(`Remote seek in transcode mode to ${time}s`);
                 streamOffsetRef.current = time;
                 const url = getStreamUrl(usePlayerStore.getState().currentChapter?.id || '', time);
                 initMedia(url);
                 usePlayerStore.getState().setCurrentTime(time);
                 return;
            }

            // Update Native Media immediately
            if (mediaRef.current) {
                mediaRef.current.seekTo(time * 1000);
            }
            usePlayerStore.getState().setCurrentTime(time);
            
            MusicControls.updateElapsed({
                elapsed: time,
                isPlaying: usePlayerStore.getState().isPlaying
            });
    });

    return () => {
        // Cleanup to avoid duplicate listeners
        MusicControls.removeAllListeners();
    };
  }, [shouldTranscode, getStreamUrl, initMedia]);

  // Update Controls: Create/Update Metadata when Chapter Changes
  useEffect(() => {
    if (!currentBookId || !currentChapterId) return;
    
    // Check if we already have controls for this book to avoid full rebuild flicker?
    // But track name changes, so we must call create/update.
    // The plugin implementation updates the notification if ID matches.
    // Ensure we don't pass nulls.
    
    MusicControls.create({
        track: currentChapterTitle,
        artist: currentBookTitle,
        cover: coverUrl || '',
        isPlaying: isPlayingRef.current,
        dismissable: true,
        hasPrev: true,
        hasNext: true,
        hasClose: true,
        hasScrubbing: true,
        duration: durationRef.current,
        elapsed: currentTimeRef.current,
        ticker: `正在播放: ${currentChapterTitle}`,
        playIcon: '',
        pauseIcon: '',
        prevIcon: '',
        nextIcon: '',
        closeIcon: '',
        notificationIcon: ''
    }).catch(console.error);

  }, [currentBookId, currentBookTitle, currentBookCoverUrl, currentBookLibraryId, currentChapterId, currentChapterTitle, coverUrl]);

  // Update Controls: Play/Pause State
  useEffect(() => {
      // Pass elapsed time to prevent progress bar jumping to 0
      MusicControls.updateIsPlaying({
          isPlaying: isPlaying,
          elapsed: currentTime
      });
  }, [isPlaying, currentTime]);
  
  // Update Controls: Duration (if loaded late)
   useEffect(() => {
       if (duration > 0 && currentChapterId) {
            // Re-create controls to update duration if it wasn't available initially
            // This is necessary because updateElapsed doesn't update the total duration on all platforms
            MusicControls.create({
                track: currentChapterTitle,
                artist: currentBookTitle,
                cover: coverUrl || '',
                isPlaying: isPlayingRef.current,
                dismissable: true,
                hasPrev: true,
                hasNext: true,
                hasClose: true,
                hasScrubbing: true,
                duration: duration,
                elapsed: currentTimeRef.current,
                ticker: `正在播放: ${currentChapterTitle}`,
                playIcon: '',
                pauseIcon: '',
                prevIcon: '',
                nextIcon: '',
                closeIcon: '',
                notificationIcon: ''
            }).catch(console.error);
       }
   }, [duration, currentBookTitle, currentBookCoverUrl, currentBookLibraryId, currentBookId, currentChapterId, currentChapterTitle, coverUrl]);

  // Preload next chapter logic (Auto-cache)
  useEffect(() => {
    if ((!autoPreload) || !currentChapter || !currentBook) return;
    
    // Find next chapter index
    const currentIndex = chapters.findIndex(c => c.id === currentChapter.id);
    if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
        
        // 1. Auto Preload (Memory - Audio Object)
        if (autoPreload && !Capacitor.isNativePlatform()) {
             // ... existing preload logic
        }
    }
  }, [autoPreload, currentBook, currentChapter, chapters]);

  // Handle Skip Intro and Outro
  // Replaced handleTimeUpdate with polling in initMedia
  
  // Logic to handle skip intro/outro inside polling or effect?
  useEffect(() => {
     // Check for skip intro/outro every second using currentTime
     if (isPlaying) {
        // Handle Skip Intro (only once per chapter load ideally, but here simple check)
        if (isInitialLoadRef.current && currentBook?.skipIntro) {
            if (currentTime < currentBook.skipIntro) {
                // Seek
                if (mediaRef.current) {
                    if (shouldTranscode) {
                        console.log(`Skip intro in transcode mode to ${currentBook.skipIntro}s`);
                        streamOffsetRef.current = currentBook.skipIntro;
                        const url = getStreamUrl(currentChapter.id, currentBook.skipIntro);
                        initMedia(url);
                    } else {
                        mediaRef.current.seekTo(currentBook.skipIntro * 1000); // ms
                    }
                    setCurrentTime(currentBook.skipIntro);
                }
            }
            // eslint-disable-next-line react-hooks/immutability
            isInitialLoadRef.current = false;
        }

        // Handle Skip Outro
        if (currentBook?.skipOutro && duration > 0) {
            const minChapterDuration = (currentBook.skipIntro || 0) + currentBook.skipOutro + 10;
            if (duration > minChapterDuration && (duration - currentTime) <= currentBook.skipOutro) {
                nextChapter();
            }
        }
     }
  }, [currentTime, isPlaying, currentBook, duration, nextChapter, setCurrentTime, currentChapter, getStreamUrl, initMedia, shouldTranscode]);

  // Handle Skip Intro and Outro
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    
    const time = audioRef.current.currentTime;
    setCurrentTime(time);

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
      // eslint-disable-next-line react-hooks/immutability
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
      // Not supported in Cordova Media easily (no buffer progress)
  };

  // Handle Sleep Timer Countdown
  useEffect(() => {
    if (sleepTimer === null || sleepTimer <= 0 || !isPlaying) return;

    const interval = setInterval(() => {
      setSleepTimer(prev => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepTimer, isPlaying]);

  // Handle Sleep Timer Expiration
  useEffect(() => {
    if (sleepTimer === 0) {
      if (isPlaying) {
        togglePlay();
      }
      setSleepTimer(null);
    }
  }, [sleepTimer, isPlaying, togglePlay]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  // Sync progress to backend
  useEffect(() => {
    if (isPlaying && currentBook && currentChapter) {
      // Save progress immediately when starting
      const saveProgress = () => {
        if (!token) return;
        apiClient.post('/api/progress', {
          bookId: currentBook.id,
          chapterId: currentChapter.id,
          position: Math.floor(currentTimeRef.current)
        }).catch(err => console.error('Failed to sync progress', err));
      };

      saveProgress();
      
      progressTimerRef.current = setInterval(saveProgress, 5000); // Every 5 seconds
    } else {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isPlaying, currentBook, currentChapter, token]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
      const browserDuration = audioRef.current.duration;
      setDuration(browserDuration);

      // Resume position from store if this is the initial load for this chapter
      if (isInitialLoadRef.current) {
        const resumePosition = usePlayerStore.getState().currentTime;
        if (resumePosition > 0) {
          // If progress is very close to the end (e.g., within 2 seconds or > 99%), start from the beginning
          if (browserDuration > 0 && (browserDuration - resumePosition < 2 || resumePosition / browserDuration > 0.99)) {
            console.log(`Chapter ${currentChapter?.title} was already finished, starting from beginning`);
            audioRef.current.currentTime = 0;
            setCurrentTime(0);
          } else {
            console.log(`Resuming chapter ${currentChapter?.title} at ${resumePosition}s`);
            audioRef.current.currentTime = resumePosition;
          }
        }
      }

      // Sync duration back to server if it's significantly different
      if (currentChapter && browserDuration > 0 && token) {
        const diff = Math.abs(browserDuration - (currentChapter.duration || 0));
        if (diff > 2) {
          console.log(`Syncing accurate duration for ${currentChapter.title}: ${browserDuration}s`);
          apiClient.patch(`/api/chapters/${currentChapter.id}`, { duration: browserDuration })
            .catch(err => console.error('Failed to sync duration', err));
        }
      }
    }
  };

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // Sync ref for polling loop
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);

  // Debounced Seek Helper
  const performSeek = useCallback((time: number) => {
      if (seekTimeoutRef.current) {
          clearTimeout(seekTimeoutRef.current);
      }

      // Block timer updates to prevent UI jumping back to old position
      // eslint-disable-next-line react-hooks/immutability
      isSeekingRef.current = true;

      // Update UI immediately
      setCurrentTime(time);

      // Handle Transcoded Seek (Server-side)
      if (shouldTranscode) {
          // Debounce reload
          seekTimeoutRef.current = setTimeout(() => {
              console.log(`Performing transcoded seek to ${time}s (reload stream)`);
              streamOffsetRef.current = time;
              const currentId = usePlayerStore.getState().currentChapter?.id;
              if (currentId) {
                  const url = getStreamUrl(currentId, time) + (retryCount > 0 ? `&retry=${retryCount}` : '');
                  if (audioRef.current) {
                      audioRef.current.src = url;
                      audioRef.current.load();
                      audioRef.current.play().catch(() => {});
                  } else {
                      initMediaRef.current(url);
                  }
              }
              
              // Reset seeking lock
              setTimeout(() => {
                  if (!isSeeking) {
                      isSeekingRef.current = false;
                  }
              }, 1000);
          }, 500); // Slightly longer debounce for reload
          return;
      }

      // Handle Native Seek
      seekTimeoutRef.current = setTimeout(() => {
          if (mediaRef.current) {
              console.log(`Performing debounced seek to ${time}s`);
              mediaRef.current.seekTo(time * 1000);
              
              // Allow timer updates after a delay to let seek complete
              // The native player needs time to process the seek
              setTimeout(() => {
                  // Only reset if user isn't actually dragging
                  if (!isSeeking) {
                      isSeekingRef.current = false;
                  }
              }, 1000);
          } else {
              // If media is gone, release lock
              if (!isSeeking) {
                  isSeekingRef.current = false;
              }
          }
      }, 300); // 300ms debounce
  }, [setCurrentTime, isSeeking, shouldTranscode, retryCount, getStreamUrl]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setSeekTime(time);
    if (!isSeeking) {
      // Seek Native Media
      if (mediaRef.current && !shouldTranscode) {
        performSeek(time);
      }
      if (audioRef.current && !shouldTranscode) {
        audioRef.current.currentTime = time;
      }
      // Also update React state for UI
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

    if (shouldTranscode) {
      console.log(`Seek in transcode mode to ${time}s (reload stream)`);
      streamOffsetRef.current = time;
      const url = getStreamUrl(currentChapter.id, time) + (retryCount > 0 ? `&retry=${retryCount}` : '');
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        audioRef.current.play().catch(() => {});
        setCurrentTime(time);
        return;
      }
      initMedia(url);
      setCurrentTime(time);
      return;
    }

    // Seek Native Media
    if (mediaRef.current) {
      performSeek(time);
    }
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    // Also update React state for UI
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    if (!time || time < 0) return '0:00';
    const h = Math.floor(time / 3600);
    const m = Math.floor((time % 3600) / 60);
    const s = Math.floor(time % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const hiddenPaths = ['/admin', '/settings', '/downloads', '/cache'];
  const isHiddenPage = hiddenPaths.some(path => location.pathname.startsWith(path));
  const isWidgetMode = window.location.pathname.startsWith('/widget');

  // Auto collapse player when navigating to hidden pages
  useEffect(() => {
    if (isHiddenPage && isExpanded) {
      setIsExpanded(false);
    }
  }, [location.pathname, isExpanded, isHiddenPage, setIsExpanded]);

  // Fullscreen Logic for Widget
  const toggleFullscreen = async () => {
    if (!isWidgetMode) {
      setIsExpanded(true);
      return;
    }

    // Check if fullscreen is allowed
    if (!document.fullscreenEnabled) {
      console.warn('Fullscreen is not enabled in this context');
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
      console.error('Error toggling fullscreen:', err);
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
        console.error('Error exiting fullscreen:', err);
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
  // const audioSrc = webAudioUrl || getStreamUrl(currentChapter.id);
  // const shouldUseWebAudio = !useNativeMedia;

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
      {typeof (window as WindowWithMedia).electronAPI !== 'undefined' && (
        <audio
          ref={audioRef}
          src={getStreamUrl(currentChapter.id) + (retryCount > 0 ? `&retry=${retryCount}` : '')}
          preload="auto"
          crossOrigin="anonymous"
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onPlay={() => {
            setIsPlaying(true);
            if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
          }}
          onPause={() => setIsPlaying(false)}
          onError={(e) => {
            const audio = audioRef.current;
            if (audio && audio.error) {
              // Ignore aborted errors (code 4) -> Actually 4 is MEDIA_ERR_SRC_NOT_SUPPORTED, 20 is Abort? 
              // Standard: 1=Abort, 2=Network, 3=Decode, 4=SrcNotSupported
              // Auto retry on Abort (1), decode error (3) or not supported (4)
              // Android sometimes returns 1 for generic failures
              if ((audio.error.code === 1 || audio.error.code === 3 || audio.error.code === 4) && retryCount < 3) {
                   console.log(`Playback error ${audio.error.code}, retrying with transcode (${retryCount + 1}/3)...`);
                   setShouldTranscode(true);
                   // eslint-disable-next-line react-hooks/immutability
                   isInitialLoadRef.current = true;
                   setRetryCount(prev => prev + 1);
                   return;
              }

              console.error('Audio element error', audio.error);
              
              // If we were trying to play a cached file and it failed, fallback to network
              if (cachedUri) {
                  console.log('Cached file playback failed, falling back to network stream...');
                  setCachedUri(null); // This will trigger re-render with network URL
                  return;
              }
            } else {
              console.error('Audio element error (unknown)', e);
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
                  borderColor: themeColor ? `${themeColor.replace('0.15', '0.3').replace('0.1', '0.3')}` : undefined
                }}
              >
                <img 
                  src={coverUrl} 
                  alt={currentBook?.title}
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/logo.png';
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
              flex items-center justify-between ${isWidgetMode ? 'px-3 max-[380px]:flex-col max-[380px]:justify-center max-[380px]:gap-1.5 max-[380px]:py-2' : 'px-3 sm:px-6 gap-3'} pointer-events-auto
              transition-all duration-300
            `}
            style={{ 
              backgroundColor: isWidgetMode ? undefined : (themeColor ? `${themeColor.replace('0.15', '0.05').replace('0.1', '0.05')}` : undefined),
              borderColor: isWidgetMode ? undefined : (themeColor ? `${themeColor.replace('0.15', '0.2').replace('0.1', '0.2')}` : undefined)
            }}
          >
            {/* Info */}
            <div className={`flex items-center gap-2 sm:gap-3 min-w-0 ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:max-w-none' : ''} max-w-[100px] max-[380px]:max-w-[140px] sm:max-w-[200px] md:max-w-[240px] lg:max-w-[320px] flex-none`}>
              <div 
                className="w-12 h-12 max-[380px]:w-10 max-[380px]:h-10 sm:w-16 sm:h-16 rounded-lg sm:rounded-xl overflow-hidden shadow-md cursor-pointer shrink-0"
                onClick={toggleFullscreen}
              >
                <img 
                  src={coverUrl} 
                  alt={currentBook?.title}
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/logo.png';
                  }}
                />
              </div>
              <div className="min-w-0 flex-1 hidden md:block">
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
                   themeColor={themeColor}
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
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                >
                  <SkipBack size={20} fill="currentColor" />
                </button>
                <button 
                  onClick={() => { 
                      if (mediaRef.current) {
                          const current = usePlayerStore.getState().currentTime;
                          const newTime = Math.max(0, current - 15);
                          performSeek(newTime);
                      }
                  }}
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                >
                  <RotateCcw size={18} />
                </button>
                <button 
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all"
                  style={{ 
                    backgroundColor: themeColor ? themeColor.replace('0.15', '1.0').replace('0.1', '1.0') : undefined,
                    boxShadow: themeColor ? `0 10px 15px -3px ${themeColor.replace('0.15', '0.3').replace('0.1', '0.3')}` : undefined
                  }}
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                </button>
                <button 
                  onClick={() => { 
                      if (mediaRef.current) {
                          const current = usePlayerStore.getState().currentTime;
                          const newTime = current + 15;
                          mediaRef.current.seekTo(newTime * 1000);
                          setCurrentTime(newTime);
                      }
                  }}
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                >
                  <RotateCw size={18} />
                </button>
                <button 
                  onClick={nextChapter} 
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
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
                  themeColor={themeColor}
                  onSeek={handleSeek}
                  onSeekStart={handleSeekStart}
                  onSeekEnd={handleSeekEnd}
                />
                <span className="text-[10px] text-slate-400 w-8">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Mobile Controls - Only visible on small screens */}
            <div className={`flex md:hidden items-center gap-2 sm:gap-3 flex-1 min-w-0 justify-end ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:justify-center max-[380px]:gap-6 max-[380px]:flex-none' : ''}`}>
              <div className="flex-1 min-w-0 h-2 block">
                <ProgressBar 
                  isMini={true} 
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
              <div className="flex items-center gap-1 shrink-0">
                {isWidgetMode && (
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => { 
                          if (mediaRef.current) {
                              const current = usePlayerStore.getState().currentTime;
                              const newTime = Math.max(0, current - 15);
                              performSeek(newTime);
                          }
                      }}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button 
                      onClick={prevChapter}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                    >
                      <SkipBack size={16} fill="currentColor" />
                    </button>
                  </div>
                )}
                <button 
                  onClick={togglePlay}
                  className="w-10 h-10 max-[380px]:w-8 max-[380px]:h-8 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition-transform"
                  style={{ backgroundColor: themeColor ? themeColor.replace('0.15', '1.0').replace('0.1', '1.0') : undefined }}
                >
                  {isPlaying ? <Pause size={20} className="max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" /> : <Play size={20} className="ml-1 max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" />}
                </button>
                {isWidgetMode && (
                  <div className="flex items-center gap-1">
                    {/* Always show Next button */}
                    <button 
                      onClick={nextChapter}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                    >
                      <SkipForward size={16} fill="currentColor" />
                    </button>
                    <button 
                      onClick={() => { 
                          if (mediaRef.current) {
                              const current = usePlayerStore.getState().currentTime;
                              const newTime = current + 15;
                              performSeek(newTime);
                          }
                      }}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                    >
                      <RotateCw size={16} />
                    </button>
                  </div>
                )}
                {!isWidgetMode && (
                  <button 
                    onClick={() => setIsCollapsed(true)}
                    className="p-2 text-slate-400 transition-colors"
                    style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                    title="收起播放器"
                  >
                    <ChevronLeft size={24} />
                  </button>
                )}
              </div>
            </div>

            {/* Desktop Extra Controls - Visible on Tablet and Desktop */}
            <div className="hidden md:flex items-center gap-4 lg:gap-6 min-w-[100px] lg:min-w-[140px] justify-end">
              <button 
                onClick={() => setPlaybackSpeed(playbackSpeed === 2 ? 1 : playbackSpeed + 0.25)} 
                className="text-[10px] font-bold px-2 py-1 rounded transition-colors"
                style={{ 
                  backgroundColor: themeColor ? themeColor.replace('0.15', '0.1').replace('0.1', '0.1') : undefined,
                  color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.8').replace('0.1', '0.8')) : undefined
                }}
              >
                {playbackSpeed}x
              </button>
              <button 
                onClick={() => setIsCollapsed(true)} 
                className="text-slate-400 transition-colors p-1 hover:scale-110"
                style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
                title="收起播放器"
              >
                <ChevronLeft size={20} />
              </button>
              <button 
                onClick={() => setIsExpanded(true)} 
                className="text-slate-400 transition-colors p-1 hover:scale-110"
                style={{ color: themeColor ? (isLight(themeColor) ? '#475569' : themeColor.replace('0.15', '0.6').replace('0.1', '0.6')) : undefined }}
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
          className="absolute inset-0 flex flex-col px-4 pt-[calc(3rem+env(safe-area-inset-top))] pb-40 sm:p-8 md:p-12 overflow-y-auto animate-in slide-in-from-bottom duration-500 xl:pb-12"
          style={{ backgroundColor: isWidgetMode ? (themeColor ? toSolidColor(themeColor) : '#1e293b') : (themeColor || '#F2EDE4') }}
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
                    const isExtra = !!currentChapter.isExtra || /番外|SP|Extra/i.test(currentChapter.title);
                    const targetTab = isExtra ? 'extra' : 'main';
                    if (activeTab !== targetTab) setActiveTab(targetTab);

                    const targetList = chapters.filter(c => {
                         const cIsExtra = !!c.isExtra || /番外|SP|Extra/i.test(c.title);
                         return cIsExtra === isExtra;
                    });

                    const index = targetList.findIndex(c => c.id === currentChapter.id);
                    if (index !== -1) {
                        const groupIndex = Math.floor(index / chaptersPerGroup);
                        if (currentGroupIndex !== groupIndex) {
                            setCurrentGroupIndex(groupIndex);
                        }
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
                src={coverUrl} 
                alt={currentBook?.title}
                crossOrigin="anonymous"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/logo.png';
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
                              usePlayerStore.getState().setVolume(parseFloat(e.target.value));
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
                      if (mediaRef.current) {
                          const current = usePlayerStore.getState().currentTime;
                          const newTime = Math.max(0, current - 15);
                          performSeek(newTime);
                      }
                  }}
                  className="text-[#4A3728] dark:text-slate-400 p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <div className="relative">
                    <RotateCcw size={24} className="sm:w-8 sm:h-8" />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] sm:text-[10px] font-bold mt-0.5">15</span>
                  </div>
                </button>
                <button 
                  onClick={prevChapter}
                  className="text-[#0F172A] dark:text-white p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <SkipBack size={28} className="sm:w-9 sm:h-9" fill="currentColor" />
                </button>
                
                <button 
                  onClick={togglePlay}
                  className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-[#2D1B10] dark:bg-primary-600 text-white flex items-center justify-center shadow-2xl transform hover:scale-105 active:scale-95 transition-all"
                  style={themeColor ? { backgroundColor: toSolidColor(themeColor) } : {}}
                >
                  {isPlaying ? <Pause size={32} className="sm:w-12 sm:h-12" fill="currentColor" /> : <Play size={32} className="sm:w-12 sm:h-12 ml-1 sm:ml-2" fill="currentColor" />}
                </button>

                <button 
                  onClick={nextChapter}
                  className="text-[#0F172A] dark:text-white p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <SkipForward size={28} className="sm:w-9 sm:h-9" fill="currentColor" />
                </button>
                <button 
                  onClick={() => { 
                      if (mediaRef.current) {
                          const current = usePlayerStore.getState().currentTime;
                          const newTime = current + 15;
                          performSeek(newTime);
                      }
                  }}
                  className="text-[#4A3728] dark:text-slate-400 p-1.5 sm:p-2 hover:scale-110 transition-transform"
                >
                  <div className="relative">
                    <RotateCw size={24} className="sm:w-8 sm:h-8" />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] sm:text-[10px] font-bold mt-0.5">15</span>
                  </div>
                </button>
              </div>

              {/* Bottom Row Controls */}
              <div className="flex justify-between items-center max-w-2xl mx-auto w-full px-2 sm:px-4 text-[#4A3728] dark:text-slate-400">
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
                              setSleepTimer(mins * 60);
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
                              setSleepTimer(mins * 60);
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
                    <h3 className="text-xl font-bold dark:text-white text-[#4A3728]">播放设置</h3>
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

                <ChapterList 
                  chapters={chapters}
                  currentChapter={currentChapter}
                  currentBook={currentBook}
                  isPlaying={isPlaying}
                  themeColor={themeColor}
                  currentGroupIndex={currentGroupIndex}
                  onGroupChange={setCurrentGroupIndex}
                  onPlayChapter={playChapter}
                  onClose={() => setShowChapters(false)}
                  activeTab={activeTab}
                  onTabChange={(tab) => {
                      setActiveTab(tab);
                      setCurrentGroupIndex(0);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Player;
