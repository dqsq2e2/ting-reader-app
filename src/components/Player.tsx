import { Capacitor } from '@capacitor/core';
import React, { useRef, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import apiClient from '../api/client';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  FastForward, 
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
import { toSolidColor } from '../utils/color';
import { getCachedFile, downloadToCache, removeCachedFile } from '../utils/mobileCacheManager';
import { CapacitorMusicControls as MusicControls } from 'capacitor-music-controls-plugin';

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
    setVolume,
    themeColor,
    setThemeColor,
    playChapter,
    setIsPlaying,
    isExpanded,
    setIsExpanded
  } = usePlayerStore();

  const { token, activeUrl } = useAuthStore();
  const API_BASE_URL = activeUrl || import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
  
  const [cachedUri, setCachedUri] = useState<{id: string, path: string} | null>(null);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadingFileRef = useRef<string | null>(null);

  // Combined Effect: Handle Chapter Change, Cache Check, and Media Init (Native Only)
  useEffect(() => {
    if (!currentChapter) return;
    if ((window as any).electronAPI) return;

    // 1. Cleanup old timers
    if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
        downloadTimeoutRef.current = null;
    }

    let isMounted = true;
    const chapterId = currentChapter.id;
    
    const loadAndPlay = async () => {
        // Determine URL - Default to network
        let url = `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
        
        try {
            const fileName = `${chapterId}.mp3`;
            const cachedPath = await getCachedFile(fileName);
            
            if (!isMounted) return;
            if (currentChapter.id !== chapterId) return; // Stale

            if (cachedPath) {
                console.log('Using cached file:', cachedPath);
                url = cachedPath;
                // Update state for UI debugging (optional, but good for consistency)
                setCachedUri({ id: chapterId, path: cachedPath });
            } else {
                console.log('File not in cache, streaming from server...');
                // Reset cache state
                setCachedUri(null);
                
                // Schedule background download (Debounced)
                downloadTimeoutRef.current = setTimeout(() => {
                    downloadInBackground(chapterId);
                }, 5000);
            }
        } catch (e) {
            console.warn('Cache check failed', e);
        }

        // Init Media with final URL
        initMedia(url);
    };

    loadAndPlay();

    return () => {
        isMounted = false;
        if (downloadTimeoutRef.current) {
            clearTimeout(downloadTimeoutRef.current);
        }
        if (mediaRef.current) {
            // Nullify ref before releasing to prevent stale callbacks from triggering logic
            const media = mediaRef.current;
            mediaRef.current = null;
            media.release();
        }
        if (mediaTimerRef.current) {
            clearInterval(mediaTimerRef.current);
        }
    };
  }, [currentChapter?.id]);

  const downloadInBackground = async (chapterId: string) => {
       const fileName = `${chapterId}.mp3`;
       
       try {
         const streamUrl = `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
         
         // If file exists, do nothing
         if (await getCachedFile(fileName)) return;
 
         console.log('Starting atomic download for', chapterId);
         downloadingFileRef.current = fileName;
         
         await downloadToCache(streamUrl, fileName);
         console.log('Background download complete for', chapterId);
         
         if (currentChapter?.id === chapterId) {
              const newCached = await getCachedFile(fileName);
              if (newCached) {
                  console.log('Cache ready for next playback');
              }
         }
       } catch (e) {
           console.error('Background download failed or cancelled', e);
       } finally {
           if (downloadingFileRef.current === fileName) {
               downloadingFileRef.current = null;
           }
       }
  };

  const getStreamUrl = (chapterId: string) => {
    if ((window as any).electronAPI) {
      const remote = encodeURIComponent(API_BASE_URL);
      return `ting://stream/${chapterId}?token=${token}&remote=${remote}`;
    }
    
    // App mode
    // If we have a cachedUri AND it matches the current chapter, use it.
    // For Native Media, we want the raw file:// URI, NOT the capacitor http one.
    if (cachedUri && cachedUri.id === chapterId) {
        return cachedUri.path;
    }
    return `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
  };

  // Helper to init media
  const initMedia = (url: string) => {
      // Release old media
      if (mediaRef.current) {
          mediaRef.current.release();
          mediaRef.current = null;
      }
      
      // Stop timer
      if (mediaTimerRef.current) {
          clearInterval(mediaTimerRef.current);
          mediaTimerRef.current = null;
      }

      console.log('Initializing Native Media:', url);
      
      // Check if Media is available (Cordova plugin)
      if (typeof (window as any).Media === 'undefined') {
          console.error('Cordova Media plugin not found!');
          return;
      }
      
      // Special handling for file:// URLs to avoid -38 errors
      // Sometimes file:// needs to be encoded or decoded differently depending on Android version
      let finalUrl = url;
      if (finalUrl.startsWith('file://')) {
          // Ensure spaces are encoded if any
          // finalUrl = encodeURI(finalUrl); 
          // Actually, cordova-plugin-media expects raw paths usually, but let's be careful.
          // If the file doesn't exist, it throws -38 immediately.
          // We rely on getCachedFile returning a valid URI.
      }

      // Create new Media
      // new Media(src, mediaSuccess, mediaError, mediaStatus)
      const media = new (window as any).Media(
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
          (err: any) => {
              console.error('Media Error', err);
              
              // Prevent stale callbacks
              if (!mediaRef.current || mediaRef.current !== media) {
                  console.log('Ignoring stale media error callback');
                  return;
              }

              // Fallback logic if file error
              // Check if we are currently trying to play a cached file
              // We compare url with cachedUri, or check if url starts with file://
              if ((cachedUri && url === cachedUri.path) || url.startsWith('file://')) {
                  console.log('Cached file failed, removing corrupt file and falling back to network');
                  
                  // Try to remove the file if it's corrupt (Error -38 or others)
                  if (currentChapter) {
                      const fileName = `${currentChapter.id}.mp3`;
                      // Async remove, don't wait
                      removeCachedFile(fileName).catch(e => console.warn('Failed to remove bad file', e));
                  }

                  // IMPORTANT: Force state update to null to trigger re-render (UI only)
                  setCachedUri(null); 
                  
                  // Manually trigger fallback to network since we removed the effect dependency
                  if (currentChapter) {
                      const networkUrl = `${API_BASE_URL}/api/stream/${currentChapter.id}?token=${token}`;
                      console.log('Triggering fallback to network url:', networkUrl);
                      initMedia(networkUrl);
                  }
              } else {
                  // Only show error if not -38 (since we handle it by fallback)
                  // and not a known benign error
                  if (err.code !== 0) { // 0 is sometimes used for generic or non-critical
                      setError(`播放出错: ${err.message || err.code || JSON.stringify(err)}`);
                  }
              }
          },
          (status: number) => {
              // Media.MEDIA_NONE = 0;
              // Media.MEDIA_STARTING = 1;
              // Media.MEDIA_RUNNING = 2;
              // Media.MEDIA_PAUSED = 3;
              // Media.MEDIA_STOPPED = 4;
              console.log('Media Status:', status);

              // Prevent stale callbacks affecting state
              if (mediaRef.current !== media) {
                  console.log('Ignoring stale media status callback');
                  return;
              }

              // Update ref state
              if (mediaRef.current) {
                  mediaRef.current._status = status;
              }
              
              if (status === 2) { // Running
                  setIsPlaying(true);
                  
                  // Perform initial seek if needed
                  if (media._resumeTime > 0 && !media._initialSeekDone) {
                      console.log(`Performing initial seek to ${media._resumeTime}s`);
                      media.seekTo(media._resumeTime * 1000);
                      media._initialSeekDone = true;
                  }

                  // Ensure notification state is synced
                  MusicControls.updateIsPlaying({
                      isPlaying: true,
                      elapsed: usePlayerStore.getState().currentTime
                  });
              } else if (status === 3 || status === 4) { // Paused or Stopped
                  setIsPlaying(false);
                  
                  // Ensure notification state is synced
                  MusicControls.updateIsPlaying({
                      isPlaying: false,
                      elapsed: usePlayerStore.getState().currentTime
                  });
              }
          }
      );
      
      // Monkey patch or attach status to object for checking
      media._status = 0; // Initial status
      
      // Handle Initial Seek (Resume)
      const resumeTime = usePlayerStore.getState().currentTime;
      media._resumeTime = resumeTime;
      media._initialSeekDone = resumeTime <= 0; // If 0, no seek needed

      mediaRef.current = media;
      
      // If we are supposed to be playing, play
      if (usePlayerStore.getState().isPlaying) {
          media.play();
      } else {
           // If paused, we might still want to seek so the position is correct
           // But seekTo might not work if stopped.
      }
      
      // Start polling for position
      mediaTimerRef.current = setInterval(() => {
          if (mediaRef.current) {
              // getCurrentPosition(success, fail)
              mediaRef.current.getCurrentPosition(
                  (position: number) => {
                      if (position > -1) {
                          // Prevent polling from overwriting store before initial seek is complete
                          if (mediaRef.current._resumeTime > 0 && !mediaRef.current._initialSeekDone) {
                              // Check if we are close enough? No, just wait for status callback to seek.
                              // Or if position is already close (maybe plugin seeked internally?), mark done.
                              if (Math.abs(position - mediaRef.current._resumeTime) < 2) {
                                  mediaRef.current._initialSeekDone = true;
                              } else {
                                  return;
                              }
                          }

                          setCurrentTime(position);
                          
                          // Also update duration if available
                          const d = mediaRef.current.getDuration();
                          if (d > 0 && d !== duration) {
                              setDuration(d);
                          }

                          // Update notification progress
                          // Use store state to get latest isPlaying value to avoid stale closure
                          const currentIsPlaying = usePlayerStore.getState().isPlaying;
                          // Only update if playing to reduce bridge traffic? 
                          // No, we want to update even if paused if position changed (e.g. seek)
                          // But we throttle in another effect. 
                          // Actually, doing it here is better for "live" updates during playback.
                          // Let's throttle it here manually: only every 1s is fine.
                          MusicControls.updateElapsed({
                              elapsed: position,
                              isPlaying: currentIsPlaying
                          });
                      }
                  },
                  (e: any) => {
                      // Suppress generic errors during polling
                  }
              );
          }
      }, 1000);
  };

  const audioRef = useRef<HTMLAudioElement>(null); // Keep for Electron fallback? No, let's remove usage for App.

  const location = useLocation();
  const [isMuted, setIsMuted] = useState(false);
  // const [isExpanded, setIsExpanded] = useState(false); // Moved to store
  const [showChapters, setShowChapters] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  
  // Ref for Native Media
  const mediaRef = useRef<any>(null); // Use any for Cordova Media
  const mediaTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollGroups = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };
  const [chapters, setChapters] = useState<any[]>([]);
  const [customMinutes, setCustomMinutes] = useState('');
  const [editSkipIntro, setEditSkipIntro] = useState(0);
  const [editSkipOutro, setEditSkipOutro] = useState(0);

  // Use stored theme color from book to avoid flash
  useEffect(() => {
    if (currentBook?.theme_color) {
      setThemeColor(currentBook.theme_color);
    }
  }, [currentBook?.id, currentBook?.theme_color]);

  useEffect(() => {
    if (currentBook) {
      setEditSkipIntro(currentBook.skip_intro || 0);
      setEditSkipOutro(currentBook.skip_outro || 0);
    }
  }, [currentBook?.id]);

  const handleSaveSettings = async () => {
    if (!currentBook) return;
    try {
      await apiClient.patch(`/api/books/${currentBook.id}`, {
        skip_intro: editSkipIntro,
        skip_outro: editSkipOutro
      });
      // Update local store state if necessary, but currentBook is in store
      usePlayerStore.setState(state => ({
        currentBook: state.currentBook ? {
          ...state.currentBook,
          skip_intro: editSkipIntro,
          skip_outro: editSkipOutro
        } : null
      }));
      setShowSettings(false);
    } catch (err) {
      console.error('Failed to save settings', err);
    }
  };

  const chaptersPerGroup = 100;
  const groups = React.useMemo(() => {
    const g = [];
    for (let i = 0; i < chapters.length; i += chaptersPerGroup) {
      const slice = chapters.slice(i, i + chaptersPerGroup);
      g.push({
        start: slice[0]?.chapter_index || (i + 1),
        end: slice[slice.length - 1]?.chapter_index || (i + slice.length),
        chapters: slice
      });
    }
    return g;
  }, [chapters]);

  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerMenuRef = useRef<HTMLDivElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [autoPreload, setAutoPreload] = useState(false);
  const isInitialLoadRef = useRef(true);
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch settings for auto_preload
  useEffect(() => {
    apiClient.get('/api/settings').then(res => {
      setAutoPreload(!!res.data.auto_preload);
    }).catch(err => console.error('Failed to fetch settings', err));
  }, []);

  // Fetch chapters for the current book
  useEffect(() => {
    if (currentBook?.id) {
      apiClient.get(`/api/books/${currentBook.id}/chapters`).then(res => {
        setChapters(res.data);
        setCurrentGroupIndex(0); // Reset group index when book changes
      }).catch(err => console.error('Failed to fetch chapters', err));
    }
  }, [currentBook?.id]);

  // Close timer menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timerMenuRef.current && !timerMenuRef.current.contains(event.target as Node)) {
        setShowSleepTimer(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset initial load ref when chapter changes
  useEffect(() => {
    isInitialLoadRef.current = true;
    setBufferedTime(0);
  }, [currentChapter?.id]);



  // Handle Play/Pause Toggle
  useEffect(() => {
    if ((window as any).electronAPI) return;
    
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
  
  // Handle Volume
  useEffect(() => {
    if (mediaRef.current) {
        mediaRef.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);
  
  // Handle Speed - Cordova Media doesn't support setRate easily on all platforms?
  // Android supports setRate since API 23.
  useEffect(() => {
      if (mediaRef.current && typeof mediaRef.current.setRate === 'function') {
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
  }, []);

  // Update Controls: Create/Update Metadata when Chapter Changes
  useEffect(() => {
    if (!currentBook || !currentChapter) return;
    
    // Check if we already have controls for this book to avoid full rebuild flicker?
    // But track name changes, so we must call create/update.
    // The plugin implementation updates the notification if ID matches.
    // Ensure we don't pass nulls.
    
    MusicControls.create({
        track: currentChapter.title || '',
        artist: currentBook.title || '',
        cover: getCoverUrl(currentBook.cover_url, currentBook.library_id, currentBook.id) || '',
        isPlaying: isPlaying, // Initial state
        dismissable: true,
        hasPrev: true,
        hasNext: true,
        hasClose: true,
        hasScrubbing: true,
        duration: duration,
        elapsed: currentTime,
        ticker: `正在播放: ${currentChapter.title || ''}`,
        playIcon: '',
        pauseIcon: '',
        prevIcon: '',
        nextIcon: '',
        closeIcon: '',
        notificationIcon: ''
    }).catch(console.error);

  }, [currentChapter?.id, currentBook?.id]); // Only recreate if book/chapter identity changes

  // Update Controls: Play/Pause State
  useEffect(() => {
      // Pass elapsed time to prevent progress bar jumping to 0
      MusicControls.updateIsPlaying({
          isPlaying: isPlaying,
          elapsed: currentTime
      });
  }, [isPlaying]);
  
  // Update Controls: Duration (if loaded late)
   useEffect(() => {
       if (duration > 0 && currentChapter) {
            // Re-create controls to update duration if it wasn't available initially
            // This is necessary because updateElapsed doesn't update the total duration on all platforms
            MusicControls.create({
                track: currentChapter.title || '',
                artist: currentBook?.title || '',
                cover: getCoverUrl(currentBook?.cover_url, currentBook?.library_id, currentBook?.id) || '',
                isPlaying: isPlaying,
                dismissable: true,
                hasPrev: true,
                hasNext: true,
                hasClose: true,
                hasScrubbing: true,
                duration: duration,
                elapsed: currentTime,
                ticker: `正在播放: ${currentChapter.title || ''}`,
                playIcon: '',
                pauseIcon: '',
                prevIcon: '',
                nextIcon: '',
                closeIcon: '',
                notificationIcon: ''
            }).catch(console.error);
       }
   }, [duration]);

  // Preload next chapter logic (Auto-cache)
  useEffect(() => {
    if (!autoPreload || !currentChapter || !currentBook) return;
    
    // Find next chapter index
    apiClient.get(`/api/books/${currentBook.id}/chapters`).then(res => {
      const chapters = res.data;
      const currentIndex = chapters.findIndex((c: any) => c.id === currentChapter.id);
      if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
        const nextChapterId = chapters[currentIndex + 1].id;
        
        // Use downloadInBackground to cache the file for offline use
        console.log('Auto-caching next chapter:', chapters[currentIndex + 1].title);
        downloadInBackground(nextChapterId);
      }
    }).catch(err => console.error('Preload failed', err));
  }, [currentChapter?.id, autoPreload, currentBook?.id]);

  // Handle Skip Intro and Outro
  // Replaced handleTimeUpdate with polling in initMedia
  
  // Logic to handle skip intro/outro inside polling or effect?
  useEffect(() => {
     // Check for skip intro/outro every second using currentTime
     if (isPlaying) {
        // Handle Skip Intro (only once per chapter load ideally, but here simple check)
        if (isInitialLoadRef.current && currentBook?.skip_intro) {
            if (currentTime < currentBook.skip_intro) {
                // Seek
                if (mediaRef.current) {
                    mediaRef.current.seekTo(currentBook.skip_intro * 1000); // ms
                    setCurrentTime(currentBook.skip_intro);
                }
            }
            isInitialLoadRef.current = false;
        }

        // Handle Skip Outro
        if (currentBook?.skip_outro && duration > 0) {
            const minChapterDuration = (currentBook.skip_intro || 0) + currentBook.skip_outro + 10;
            if (duration > minChapterDuration && (duration - currentTime) <= currentBook.skip_outro) {
                nextChapter();
            }
        }
     }
  }, [currentTime, isPlaying]);

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
    if (isInitialLoadRef.current && currentBook?.skip_intro) {
      if (time < currentBook.skip_intro) {
        audioRef.current.currentTime = currentBook.skip_intro;
        setCurrentTime(currentBook.skip_intro);
      }
      isInitialLoadRef.current = false;
    }

    // Handle Skip Outro
    if (currentBook?.skip_outro && duration > 0) {
      // Only skip if the chapter is long enough to actually have an outro
      // and we've played at least some of it
      const minChapterDuration = (currentBook.skip_intro || 0) + currentBook.skip_outro + 10;
      if (duration > minChapterDuration && (duration - time) <= currentBook.skip_outro) {
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
  }, [sleepTimer === null, isPlaying]);

  // Handle Sleep Timer Expiration
  useEffect(() => {
    if (sleepTimer === 0) {
      if (isPlaying) {
        togglePlay();
      }
      setSleepTimer(null);
    }
  }, [sleepTimer, isPlaying]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

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
  }, [isPlaying, currentBook?.id, currentChapter?.id]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const browserDuration = audioRef.current.duration;
      setDuration(browserDuration);

      // Sync duration back to server if it's significantly different
      if (currentChapter && browserDuration > 0) {
        const diff = Math.abs(browserDuration - (currentChapter.duration || 0));
        if (diff > 2) {
          console.log(`Syncing accurate duration for ${currentChapter.title}: ${browserDuration}s`);
          apiClient.patch(`/api/chapters/${currentChapter.id}`, { duration: browserDuration })
            .catch(err => console.error('Failed to sync duration', err));
        }
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    // Seek Native Media
    if (mediaRef.current) {
        mediaRef.current.seekTo(time * 1000); // ms
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

  const getChapterProgressText = (chapter: any) => {
    if (!chapter.progress_position || !chapter.duration) return null;
    
    const percent = Math.floor((chapter.progress_position / chapter.duration) * 100);
    if (percent === 0) return null;
    if (percent >= 95) return '已播完';
    return `已播${percent}%`;
  };

  const hiddenPaths = ['/admin', '/settings'];
  const isHiddenPage = hiddenPaths.some(path => location.pathname.startsWith(path));
  const isWidgetMode = window.location.pathname.startsWith('/widget');

  // Auto collapse player when navigating to hidden pages
  useEffect(() => {
    if (isHiddenPage && isExpanded) {
      setIsExpanded(false);
    }
  }, [location.pathname, isExpanded, isHiddenPage]);

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
  }, [isWidgetMode]);

  if (!currentChapter) return null;

  const miniPlayerStyle = !isExpanded ? { 
    bottom: isWidgetMode ? '0' : 'var(--mini-player-offset)',
    height: isWidgetMode ? '100%' : 'var(--player-h)',
    left: isWidgetMode ? '0' : undefined,
    right: isWidgetMode ? '0' : undefined,
  } : {};

  const ProgressBar = ({ isMini = false }) => {
    const playedPercent = (currentTime / (duration || 1)) * 100;
    const bufferedPercent = (bufferedTime / (duration || 1)) * 100;
    
    // Safety check for themeColor
    const safeThemeColor = themeColor || 'rgba(0,0,0,0.15)';
    
    return (
      <div className={`relative group/progress ${isMini ? 'flex-1 h-2 sm:h-1.5' : 'w-full h-2.5'} bg-slate-300 dark:bg-slate-900 rounded-full overflow-hidden`}>
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
            backgroundColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0'),
            boxShadow: `0 0 10px ${safeThemeColor.replace('0.15', '0.4').replace('0.1', '0.4')}`
          }}
        />
        {/* Range Input for Seeking */}
        <input 
          type="range" 
          min="0" 
          max={duration || 0} 
          value={currentTime} 
          onChange={handleSeek}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
        />
      </div>
    );
  };

  const handleEnded = () => {
    if (currentBook && currentChapter) {
      apiClient.post('/api/progress', {
        bookId: currentBook.id,
        chapterId: currentChapter.id,
        position: Math.floor(duration)
      }).catch(err => console.error('Failed to sync final progress', err));
    }
    nextChapter();
  };

  return (
    <div 
      className={`
        absolute transition-all duration-500 ease-in-out
        ${isHiddenPage && !isExpanded ? 'translate-y-full opacity-0 pointer-events-none' : ''}
        ${isExpanded 
          ? 'inset-0 z-[110] bg-white dark:bg-slate-950' 
          : 'left-0 right-0 z-[30] bg-transparent pointer-events-none'
        }
      `}
      style={miniPlayerStyle}
    >
      {/* Audio Element - Only for Web/Electron */}
      {!Capacitor.isNativePlatform() && (
        <audio
          ref={audioRef}
          src={getStreamUrl(currentChapter.id)}
          preload="auto"
          crossOrigin="anonymous"
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={(e) => {
            const audio = audioRef.current;
            if (audio && audio.error) {
              // Ignore aborted errors (code 4)
              if (audio.error.code === 4) {
                console.log('Playback aborted (normal)');
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
          <div 
            className={`
              h-full ${isWidgetMode ? 'max-w-none rounded-none border-none shadow-none' : 'max-w-7xl mx-auto rounded-2xl sm:rounded-3xl shadow-2xl shadow-black/10 border border-slate-200/50 dark:border-slate-800/50'}
              bg-white/95 dark:bg-slate-900/95 backdrop-blur-md 
              flex items-center justify-between ${isWidgetMode ? 'px-3 max-[380px]:flex-col max-[380px]:justify-center max-[380px]:gap-1.5 max-[380px]:py-2' : 'px-3 sm:px-6'} pointer-events-auto
              transition-all duration-300
            `}
            style={{ 
              backgroundColor: isWidgetMode ? undefined : (themeColor ? `${themeColor.replace('0.15', '0.05').replace('0.1', '0.05')}` : undefined),
              borderColor: isWidgetMode ? undefined : (themeColor ? `${themeColor.replace('0.15', '0.2').replace('0.1', '0.2')}` : undefined)
            }}
          >
            {/* Info */}
            <div className={`flex items-center gap-2 sm:gap-3 min-w-0 ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:max-w-none' : ''} max-w-[100px] max-[380px]:max-w-[140px] sm:max-w-[200px] md:max-w-[240px] lg:max-w-[320px] md:flex-none flex-1`}>
              <div 
                className="w-12 h-12 max-[380px]:w-10 max-[380px]:h-10 sm:w-16 sm:h-16 rounded-lg sm:rounded-xl overflow-hidden shadow-md cursor-pointer shrink-0"
                onClick={toggleFullscreen}
              >
                <img 
                  src={getCoverUrl(currentBook?.cover_url, currentBook?.library_id, currentBook?.id)} 
                  alt={currentBook?.title}
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover';
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-bold dark:text-white truncate text-sm max-[380px]:text-xs">{currentBook?.title}</h4>
                <p className="text-slate-500 truncate text-xs max-[380px]:text-[10px]">{currentChapter.title}</p>
              </div>
            </div>

            {/* Widget Vertical Layout: Progress Bar (Visible only on small widget) */}
            {isWidgetMode && (
              <div className="hidden max-[380px]:block w-full px-1 py-1">
                 <ProgressBar isMini={true} />
              </div>
            )}

            {/* Controls (Desktop) */}
            <div className="hidden md:flex flex-col items-center gap-1.5 flex-1 max-xl:max-w-xl px-4 lg:px-8">
              <div className="flex items-center gap-6">
                <button 
                  onClick={prevChapter} 
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                >
                  <SkipBack size={20} fill="currentColor" />
                </button>
                <button 
                  onClick={() => { 
                      if (mediaRef.current) {
                          // Seek relative
                          mediaRef.current.getCurrentPosition((pos: number) => {
                              if (pos > -1) mediaRef.current.seekTo(Math.max(0, pos * 1000 - 15000));
                          });
                      }
                  }}
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                >
                  <RotateCcw size={18} />
                </button>
                <button 
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all"
                  style={{ 
                    backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0'),
                    boxShadow: `0 10px 15px -3px ${themeColor.replace('0.15', '0.3').replace('0.1', '0.3')}`
                  }}
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                </button>
                <button 
                  onClick={() => { 
                      if (mediaRef.current) {
                          // Seek relative
                          mediaRef.current.getCurrentPosition((pos: number) => {
                              if (pos > -1) mediaRef.current.seekTo(pos * 1000 + 30000);
                          });
                      }
                  }}
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                >
                  <RotateCw size={18} />
                </button>
                <button 
                  onClick={nextChapter} 
                  className="text-slate-400 hover:scale-110 transition-all"
                  style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                >
                  <SkipForward size={20} fill="currentColor" />
                </button>
              </div>

              <div className="w-full flex items-center gap-3">
                <span className="text-[10px] text-slate-400 w-8 text-right">{formatTime(currentTime)}</span>
                <ProgressBar isMini={true} />
                <span className="text-[10px] text-slate-400 w-8">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Mobile Controls - Only visible on small screens */}
            <div className={`flex md:hidden items-center gap-2 sm:gap-3 flex-1 min-w-0 justify-end ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:justify-center max-[380px]:gap-6 max-[380px]:flex-none' : ''}`}>
              <div className="flex-1 min-w-0 h-2 block">
                <ProgressBar isMini={true} />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isWidgetMode && (
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => { 
                          if (mediaRef.current) {
                              mediaRef.current.getCurrentPosition((pos: number) => {
                                  if (pos > -1) mediaRef.current.seekTo(Math.max(0, pos * 1000 - 15000));
                              });
                          }
                      }}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button 
                      onClick={prevChapter}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                    >
                      <SkipBack size={16} fill="currentColor" />
                    </button>
                  </div>
                )}
                <button 
                  onClick={togglePlay}
                  className="w-10 h-10 max-[380px]:w-8 max-[380px]:h-8 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition-transform"
                  style={{ backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}
                >
                  {isPlaying ? <Pause size={20} className="max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" /> : <Play size={20} className="ml-1 max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" />}
                </button>
                {isWidgetMode && (
                  <div className="flex items-center gap-1">
                    {/* Always show Next button */}
                    <button 
                      onClick={nextChapter}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                    >
                      <SkipForward size={16} fill="currentColor" />
                    </button>
                    <button 
                      onClick={() => { 
                          if (mediaRef.current) {
                              mediaRef.current.getCurrentPosition((pos: number) => {
                                  if (pos > -1) mediaRef.current.seekTo(pos * 1000 + 30000);
                              });
                          }
                      }}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary-500"
                      style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                    >
                      <RotateCw size={16} />
                    </button>
                  </div>
                )}
                {!isWidgetMode && (
                  <button 
                    onClick={() => setIsExpanded(true)}
                    className="p-2 text-slate-400 transition-colors"
                    style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                  >
                    <ChevronUp size={24} />
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
                  backgroundColor: themeColor.replace('0.15', '0.1').replace('0.1', '0.1'),
                  color: themeColor.replace('0.15', '0.8').replace('0.1', '0.8')
                }}
              >
                {playbackSpeed}x
              </button>
              <button 
                onClick={() => setIsExpanded(true)} 
                className="text-slate-400 transition-colors p-1 hover:scale-110"
                style={{ color: themeColor ? themeColor.replace('0.15', '0.6').replace('0.1', '0.6') : undefined }}
                title="展开播放器"
              >
                <Maximize2 size={20} />
              </button>
            </div>
          </div>
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
                onClick={() => setShowChapters(true)}
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
                src={getCoverUrl(currentBook?.cover_url, currentBook?.library_id, currentBook?.id)} 
                alt={currentBook?.title}
                crossOrigin="anonymous"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover';
                }}
              />
            </div>

            <div className="w-full space-y-8 sm:space-y-12">
              {/* Progress Bar Section */}
              <div className="relative group/progress px-2 sm:px-4">
                <div className="flex items-center gap-2 sm:gap-4">
                  <button onClick={prevChapter} className="text-[#4A3728] dark:text-slate-400 opacity-60 hover:opacity-100 transition-opacity">
                    <SkipBack size={20} className="sm:w-6 sm:h-6" fill="currentColor" />
                  </button>
                  <div className="flex-1 relative h-10 sm:h-12 flex items-center">
                    <div className="absolute inset-x-0 h-1.5 sm:h-2.5 bg-slate-300/40 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="absolute inset-y-0 left-0 bg-[#4A3728] dark:bg-primary-600 shadow-[0_0_8px_rgba(74,55,40,0.3)]" 
                        style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                      />
                    </div>
                    <div 
                      className="absolute bg-[#2D1B10]/90 dark:bg-primary-600/90 backdrop-blur-sm text-white px-2.5 sm:px-4 py-1 rounded-full text-[10px] sm:text-xs font-medium z-10 whitespace-nowrap shadow-lg transition-all duration-150 ease-out"
                      style={{ 
                        left: `${(currentTime / (duration || 1)) * 100}%`,
                        transform: 'translateX(-50%)'
                      }}
                    >
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max={duration || 0} 
                      value={currentTime} 
                      onChange={handleSeek}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    />
                  </div>
                  <button onClick={nextChapter} className="text-[#4A3728] dark:text-slate-400 opacity-30 hover:opacity-60 transition-opacity">
                    <SkipForward size={20} className="sm:w-6 sm:h-6" fill="currentColor" />
                  </button>
                </div>
              </div>

              {/* Main Controls */}
              <div className="flex items-center justify-center gap-4 sm:gap-10 md:gap-14">
                <button 
                  onClick={() => { 
                      if (mediaRef.current) {
                          mediaRef.current.getCurrentPosition((pos: number) => {
                              if (pos > -1) mediaRef.current.seekTo(Math.max(0, pos * 1000 - 15000));
                          });
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
                          mediaRef.current.getCurrentPosition((pos: number) => {
                              if (pos > -1) mediaRef.current.seekTo(pos * 1000 + 15000);
                          });
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
                  <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">片头 {currentBook?.skip_intro || 0}s</span>
                </div>

                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  <div className="p-2">
                    <SkipForward size={18} className="sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">片尾 {currentBook?.skip_outro || 0}s</span>
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
                  <h3 className="text-lg sm:text-xl font-bold dark:text-white flex items-center gap-2">
                    <ListMusic size={24} className="text-primary-600" />
                    章节列表
                  </h3>
                  <button 
                    onClick={() => setShowChapters(false)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                  >
                    <ChevronUp className="rotate-180" size={24} />
                  </button>
                </div>

                {/* Chapter Groups Selector */}
                {groups.length > 0 && (
                  <div className="relative group/nav border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <button 
                      onClick={() => scrollGroups('left')}
                      className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white/80 dark:bg-slate-800/80 backdrop-blur shadow-md rounded-r-xl opacity-0 group-hover/nav:opacity-100 transition-opacity hidden sm:block"
                    >
                      <ChevronLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div 
                      ref={scrollRef}
                      className="flex gap-2 p-4 overflow-x-auto no-scrollbar scroll-smooth snap-x"
                    >
                      {groups.map((group, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentGroupIndex(index)}
                          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border shrink-0 snap-start ${
                            currentGroupIndex === index
                              ? 'text-white shadow-lg shadow-primary-500/30'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                          }`}
                          style={currentGroupIndex === index ? { 
                            backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0'),
                            borderColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0')
                          } : {}}
                        >
                          第 {group.start}-{group.end} 章
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={() => scrollGroups('right')}
                      className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-white/80 dark:bg-slate-800/80 backdrop-blur shadow-md rounded-l-xl opacity-0 group-hover/nav:opacity-100 transition-opacity hidden sm:block"
                    >
                      <ChevronLeft size={20} className="rotate-180 text-slate-600 dark:text-slate-400" />
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(groups[currentGroupIndex]?.chapters || chapters).map((chapter, index) => {
                    const actualIndex = currentGroupIndex * chaptersPerGroup + index;
                    const isCurrent = currentChapter?.id === chapter.id;
                    
                    return (
                      <div 
                        key={chapter.id}
                        onClick={() => {
                          playChapter(currentBook!, chapters, chapter);
                          setShowChapters(false);
                        }}
                        className={`group flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border ${
                          isCurrent 
                            ? 'bg-opacity-10 border-opacity-20' 
                            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-primary-200 dark:hover:border-primary-800'
                        }`}
                        style={isCurrent ? { 
                          backgroundColor: themeColor.replace('0.15', '0.1').replace('0.1', '0.1'),
                          borderColor: themeColor.replace('0.15', '0.3').replace('0.1', '0.3'),
                        } : {}}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div 
                            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center font-bold text-base sm:text-lg shrink-0 ${
                              isCurrent ? 'text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                            style={isCurrent ? { backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0') } : {}}
                          >
                            {chapter.chapter_index || (actualIndex + 1)}
                          </div>
                          <div className="min-w-0">
                            <p 
                              className={`text-sm sm:text-base font-bold truncate ${isCurrent ? '' : 'text-slate-900 dark:text-white'}`}
                              style={isCurrent ? { color: themeColor.replace('0.15', '1.0').replace('0.1', '1.0') } : {}}
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
                            <div className="w-1 animate-music-bar-1 rounded-full" style={{ backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}></div>
                            <div className="w-1 animate-music-bar-2 rounded-full" style={{ backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}></div>
                            <div className="w-1 animate-music-bar-3 rounded-full" style={{ backgroundColor: themeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}></div>
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
