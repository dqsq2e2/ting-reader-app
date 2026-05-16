import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import React, { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { useNativePlayer } from '../hooks/useNativePlayer';
import { useWebSocket } from '../hooks/useWebSocket';
import apiClient from '../api/client';
import { FastAverageColor } from 'fast-average-color';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward,
  ChevronLeft,
  ChevronUp,
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
import { setAlpha, toSolidColor, isLight, isTooLight } from '../utils/color';

interface ProgressBarProps {
  isMini?: boolean;
  isSeeking: boolean;
  seekTime: number;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  themeColor?: string | null;
  onSeek: (e: React.FormEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: (e: React.FormEvent<HTMLInputElement>) => void;
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
  
  const effectiveThemeColor = themeColor && !isTooLight(themeColor) ? themeColor : undefined;
  const barColor = effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined;
  const shadowColor = effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.4) : undefined;
  
  return (
    <div className={`relative group/progress ${isMini ? 'flex-1 w-full h-3 sm:h-2' : 'w-full h-4'} flex items-center select-none touch-none`}>
      <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 ${isMini ? 'h-1' : 'h-1.5'} bg-slate-300 dark:bg-slate-900 rounded-full overflow-hidden`}>
        <div className="absolute inset-y-0 left-0 bg-slate-400/30 dark:bg-slate-700/40 transition-all duration-300" style={{ width: `${bufferedPercent}%` }} />
        <div className={`absolute inset-y-0 left-0 z-10 ${!barColor ? 'bg-primary-600' : ''}`} style={{ width: `${playedPercent}%`, backgroundColor: barColor, boxShadow: shadowColor ? `0 0 10px ${shadowColor}` : undefined }} />
      </div>
      <div className={`absolute top-1/2 -translate-y-1/2 z-20 w-3 h-3 bg-white rounded-full shadow-md transition-transform duration-100 ease-out pointer-events-none ${isSeeking ? 'scale-150' : 'scale-100'}`} style={{ left: `${playedPercent}%`, marginLeft: '-6px', backgroundColor: isSeeking ? '#ffffff' : (barColor || '#ffffff'), border: `1px solid ${barColor || 'transparent'}` }} />
      <input type="range" min="0" max={Number.isFinite(duration) ? duration : 0} step="any" value={displayTime} onInput={onSeek} onMouseDown={onSeekStart} onTouchStart={onSeekStart} onMouseUp={onSeekEnd} onTouchEnd={onSeekEnd} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30" style={{ margin: 0, padding: 0, WebkitAppearance: 'none' }} />
    </div>
  );
};

const PlayerNative: React.FC = () => {
  const { token, activeUrl } = useAuthStore();
  const API_BASE_URL = activeUrl || import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
  const isNative = Capacitor.isNativePlatform();
  
  const { 
    currentBook, 
    currentChapter, 
    isPlaying, 
    currentTime, 
    duration, 
    setCurrentTime, 
    setDuration,
    playbackSpeed,
    setPlaybackSpeed,
    volume,
    setVolume,
    themeColor,
    setThemeColor,
    setIsPlaying,
    isExpanded,
    setIsExpanded,
    isCollapsed,
    setIsCollapsed,
    isSeriesEditing,
    ignoreAudioFocus
  } = usePlayerStore();

  const { sendProgress: wsSendProgress } = useWebSocket();

  const location = useLocation();
  const [showChapters, setShowChapters] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'main' | 'extra'>('main');
  const scrollRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const timerMenuRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [allChapters, setAllChapters] = useState<any[]>([]);
  
  const scrollGroups = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };
  const [customMinutes, setCustomMinutes] = useState('');
  const [editSkipIntro, setEditSkipIntro] = useState(0);
  const [editSkipOutro, setEditSkipOutro] = useState(0);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const bufferedTime = 0; // TODO: Implement buffering tracking

  // 转码重试相关
  const [shouldTranscode, setShouldTranscode] = useState(false);
  const transcodeRetryCountRef = useRef(0);
  const maxTranscodeRetries = 3;

  // 进度保存相关的 refs
  const lastSavedProgressRef = useRef<{ bookId: string; chapterId: string; position: number } | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<{ bookId: string; chapterId: string; position: number } | null>(null);

  const getStreamUrl = React.useCallback((chapterId: string, transcode: boolean = false) => {
    let url = `${API_BASE_URL}/api/stream/${chapterId}?token=${token}`;
    if (transcode || shouldTranscode) {
      url += '&transcode=mp3';
    }
    return url;
  }, [API_BASE_URL, token, shouldTranscode]);

  // 转码重试函数的 ref（解决与 useNativePlayer 的循环依赖）
  const retryWithTranscodeRef = useRef<() => Promise<void>>(async () => {});

  // 切换书籍时重置转码状态
  useEffect(() => {
    setShouldTranscode(false);
    transcodeRetryCountRef.current = 0;
  }, [currentBook?.id]);

  // 保存进度到服务器（原生平台由 Android 层接管，JS 仅用于 Web 平台）
  const saveProgressToServer = React.useCallback(async (bookId: string, chapterId: string, position: number, force: boolean = false) => {
    // 原生平台：进度同步由 PlayerNotificationService 原生层处理（HTTP + WebSocket）
    if (isNative) return;

    // 检查是否需要保存（避免重复保存相同的进度）
    const lastSaved = lastSavedProgressRef.current;
    if (!force && lastSaved &&
        lastSaved.bookId === bookId &&
        lastSaved.chapterId === chapterId &&
        Math.abs(lastSaved.position - position) < 3) {
      return; // 位置变化小于3秒，跳过保存
    }

    const pos = Math.floor(position);

    // Send via WebSocket for real-time sync
    wsSendProgress(bookId, chapterId, pos);

    try {
      await apiClient.post('/api/progress', {
        bookId,
        chapterId,
        position: pos
      });

      // 保存成功，更新最后保存的进度
      lastSavedProgressRef.current = { bookId, chapterId, position: pos };
      pendingProgressRef.current = null;
      console.log(`✓ 进度已保存: ${pos}s`);
    } catch (err) {
      console.error('✗ HTTP进度同步失败:', err);
      // 保存失败，记录待保存的进度（稍后重试）
      pendingProgressRef.current = { bookId, chapterId, position: pos };
    }
  }, [wsSendProgress]);

  // 节流保存进度（每5秒最多保存一次）
  const throttledSaveProgress = React.useCallback((bookId: string, chapterId: string, position: number) => {
    // 清除之前的定时器
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }

    // 设置新的定时器（5秒后保存）
    progressSaveTimerRef.current = setTimeout(() => {
      saveProgressToServer(bookId, chapterId, position, false);
    }, 5000);
  }, [saveProgressToServer]);

  // 强制立即保存进度（用于关键时刻）
  const forceSaveProgress = React.useCallback(async () => {
    if (currentBook && currentChapter) {
      const position = Math.floor(currentTime);
      console.log('🔒 强制保存进度:', position);
      await saveProgressToServer(currentBook.id, currentChapter.id, position, true);
    }
  }, [currentBook, currentChapter, currentTime, saveProgressToServer]);

  // 初始化原生播放器
  const nativePlayer = useNativePlayer({
    onPlayingUpdate: (playing) => {
      setIsPlaying(playing);
      
      // 暂停时立即保存进度
      if (!playing && currentBook && currentChapter) {
        console.log('⏸️ 暂停播放，立即保存进度');
        forceSaveProgress();
      }
    },
    onPositionUpdate: (position, dur) => {
      setCurrentTime(position);
      if (dur > 0 && dur !== duration) {
        setDuration(dur);
      }
      
      // 使用节流机制保存进度（每5秒一次）
      if (currentBook && currentChapter) {
        throttledSaveProgress(currentBook.id, currentChapter.id, position);
      }
    },
    onChapterChanged: async (chapterIndex) => {
      // 切换章节前，先保存当前章节的进度
      if (currentBook && currentChapter) {
        console.log('📖 章节切换，保存旧章节进度');
        await forceSaveProgress();
      }
      
      // 更新当前章节
      if (allChapters[chapterIndex]) {
        const newChapter = allChapters[chapterIndex];
        console.log(`原生播放器章节变化: ${newChapter.title} (index: ${chapterIndex})`);
        
        // 设置 prevChapterIdRef 防止循环同步
        prevChapterIdRef.current = newChapter.id;
        
        usePlayerStore.setState({ currentChapter: newChapter });
      }
    },
    onPlaybackEnded: () => {
      console.log('整本书播放完毕');
      setIsPlaying(false);
    },
    onPlaybackError: (error) => {
      console.warn('播放错误:', error);
      // 静默重试转码，不弹窗打扰用户
      retryWithTranscodeRef.current();
    },
  });

  // 静默重试：切换为转码流重新播放（定义在 useNativePlayer 之后，避免循环引用）
  const retryWithTranscode = React.useCallback(async () => {
    if (shouldTranscode || transcodeRetryCountRef.current >= maxTranscodeRetries) return;

    transcodeRetryCountRef.current += 1;
    console.log(`🔄 静默重试转码 (${transcodeRetryCountRef.current}/${maxTranscodeRetries})`);

    try {
      const currentIndex = await nativePlayer.getCurrentChapterIndex();
      const currentPos = await nativePlayer.getCurrentPosition();

      const chapterList = allChapters.map(ch => ({
        id: ch.id,
        title: ch.title,
        url: getStreamUrl(ch.id, true),
        duration: ch.duration || 0
      }));

      setShouldTranscode(true);

      await nativePlayer.preparePlaylist(
        chapterList,
        currentBook?.title || '',
        currentBook?.author || '',
        getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id),
        currentIndex >= 0 ? currentIndex : 0,
        currentPos > 0 ? currentPos : 0,
        true,
        currentBook?.skipIntro || 0,
        currentBook?.skipOutro || 0,
        usePlayerStore.getState().ignoreAudioFocus,
        currentBook?.id || '',
        API_BASE_URL,
        token || ''
      );

      console.log('✅ 已切换到转码流播放');
    } catch (e) {
      console.error('转码重试失败:', e);
    }
  }, [shouldTranscode, allChapters, currentBook, getStreamUrl, API_BASE_URL, token, nativePlayer]);

  // 将 retryWithTranscode 注入 ref，供 onPlaybackError 调用
  useEffect(() => {
    retryWithTranscodeRef.current = retryWithTranscode;
  }, [retryWithTranscode]);

  // 监听暗色模式变化
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // 监听应用生命周期，在进入后台时保存进度
  useEffect(() => {
    if (!isNative) return;

    // 应用状态变化监听（前台/后台切换）
    const appStateListener = CapacitorApp.addListener('appStateChange', async (state) => {
      console.log('📱 应用状态变化:', state.isActive ? '前台' : '后台');
      
      if (!state.isActive) {
        // 应用进入后台，立即保存进度
        console.log('🔄 应用进入后台，保存进度');
        await forceSaveProgress();
      }
    });

    // 应用即将被杀死时保存进度（Android 的 onDestroy）
    const pauseListener = CapacitorApp.addListener('pause', async () => {
      console.log('⏸️ 应用暂停（可能即将被杀死），保存进度');
      await forceSaveProgress();
    });

    // 应用恢复时同步原生播放器状态，防止 JS 层用冻结的旧数据覆盖正确进度
    const resumeListener = CapacitorApp.addListener('resume', async () => {
      console.log('▶️ 应用恢复，同步原生播放器状态');
      try {
        const currentIndex = await nativePlayer.getCurrentChapterIndex();
        const currentPos = await nativePlayer.getCurrentPosition();
        if (currentIndex >= 0 && allChapters[currentIndex]) {
          const syncedChapter = allChapters[currentIndex];
          console.log(`  同步章节: ${syncedChapter.title}, 位置: ${currentPos}s`);
          usePlayerStore.setState({
            currentChapter: syncedChapter,
            currentTime: currentPos
          });
          // 同步后立即保存一次正确进度
          if (currentBook) {
            saveProgressToServer(currentBook.id, syncedChapter.id, currentPos, true);
          }
        }
      } catch (e) {
        console.error('恢复时同步状态失败:', e);
      }
    });

    return () => {
      appStateListener.then(listener => listener.remove());
      pauseListener.then(listener => listener.remove());
      resumeListener.then(listener => listener.remove());
    };
  }, [isNative, forceSaveProgress]);

  // 组件卸载时保存进度
  useEffect(() => {
    return () => {
      if (currentBook && currentChapter && currentTime > 0) {
        console.log('🔚 播放器组件卸载，保存进度');
        // 使用同步方式尝试保存（虽然不保证成功）
        saveProgressToServer(currentBook.id, currentChapter.id, currentTime, true);
      }
    };
  }, [currentBook, currentChapter, currentTime, saveProgressToServer]);

  // 定期重试失败的进度保存（每30秒检查一次）
  useEffect(() => {
    const retryInterval = setInterval(() => {
      if (pendingProgressRef.current) {
        const pending = pendingProgressRef.current;
        console.log('🔄 重试保存失败的进度:', pending.position);
        saveProgressToServer(pending.bookId, pending.chapterId, pending.position, true);
      }
    }, 30000); // 30秒

    return () => clearInterval(retryInterval);
  }, [saveProgressToServer]);

  const effectiveThemeColor = themeColor && !isTooLight(themeColor) ? themeColor : undefined;
  const miniPlayerThemeColor = effectiveThemeColor;
  const useDarkControls = isDark;

  // 提取主题色
  useEffect(() => {
    const color = currentBook?.themeColor;
    if (color) {
      setThemeColor(color);
    } else if (currentBook?.coverUrl && currentBook?.libraryId && currentBook?.id) {
      const coverUrl = getCoverUrl(currentBook.coverUrl, currentBook.libraryId, currentBook.id);
      const fac = new FastAverageColor();
      fac.getColorAsync(coverUrl, { algorithm: 'dominant' })
        .then(color => {
          setThemeColor(color.hex);
          usePlayerStore.setState(state => ({
            currentBook: state.currentBook ? { ...state.currentBook, themeColor: color.hex } : null
          }));
        })
        .catch(e => console.warn('提取颜色失败', e));
    }
  }, [currentBook?.id, currentBook?.themeColor, currentBook?.coverUrl, currentBook?.libraryId, setThemeColor]);

  // 加载设置
  useEffect(() => {
    if (currentBook) {
      // Initialize settings from book data
      const skipIntro = currentBook.skipIntro || 0;
      const skipOutro = currentBook.skipOutro || 0;
      setEditSkipIntro(skipIntro);
      setEditSkipOutro(skipOutro);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.id]);

  // 获取章节列表
  useEffect(() => {
    if (currentBook?.id) {
      apiClient.get(`/api/books/${currentBook.id}/chapters`).then(res => {
        setAllChapters(res.data);
        setCurrentGroupIndex(0);
      }).catch(err => console.error('获取章节失败', err));
    }
  }, [currentBook?.id, currentBook]);

  // 准备原生播放列表（仅在书籍或章节列表变化时）
  useEffect(() => {
    if (!isNative || !currentBook || allChapters.length === 0) return;

    const prepareNativePlaylist = async () => {
      try {
        const chapterList = allChapters.map(ch => ({
          id: ch.id,
          title: ch.title,
          url: getStreamUrl(ch.id),
          duration: ch.duration || 0
        }));

        const currentIndex = allChapters.findIndex(ch => ch.id === currentChapter?.id);
        const startIndex = currentIndex >= 0 ? currentIndex : 0;

        await nativePlayer.preparePlaylist(
          chapterList,
          currentBook.title,
          currentBook.author || '',
          getCoverUrl(currentBook.coverUrl, currentBook.libraryId, currentBook.id),
          startIndex,
          currentTime,
          isPlaying,
          currentBook.skipIntro || 0,
          currentBook.skipOutro || 0,
          usePlayerStore.getState().ignoreAudioFocus,
          currentBook.id,  // ⭐ 传递 bookId
          API_BASE_URL,    // ⭐ 传递 API 地址
          token            // ⭐ 传递认证 token
        );

        console.log(`已准备播放列表: ${allChapters.length} 集，从第 ${startIndex} 集开始`);
      } catch (error) {
        console.error('准备播放列表失败:', error);
      }
    };

    prepareNativePlaylist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.id, allChapters.length, isNative, ignoreAudioFocus]);

  // 同步播放状态到原生播放器（响应 store 的 isPlaying 变化）
  const syncPlaybackStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isNative || allChapters.length === 0) return;
    
    // 清除之前的定时器
    if (syncPlaybackStateTimeoutRef.current) {
      clearTimeout(syncPlaybackStateTimeoutRef.current);
    }
    
    // 延迟同步，避免在缓冲/seek时误判
    syncPlaybackStateTimeoutRef.current = setTimeout(async () => {
      const nativeIsPlaying = await nativePlayer.isPlaying();
      if (isPlaying && !nativeIsPlaying) {
        console.log('Store 要求播放，但原生播放器已暂停，恢复播放');
        await nativePlayer.play();
      } else if (!isPlaying && nativeIsPlaying) {
        console.log('Store 要求暂停，但原生播放器在播放，暂停播放');
        await nativePlayer.pause();
      }
    }, 300); // 300ms 延迟，等待缓冲完成
    
    return () => {
      if (syncPlaybackStateTimeoutRef.current) {
        clearTimeout(syncPlaybackStateTimeoutRef.current);
      }
    };
  }, [isPlaying, isNative, allChapters.length, nativePlayer]);

  // 同步章节切换到原生播放器（响应 store 的 currentChapter 变化）
  const prevChapterIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isNative || !currentChapter || allChapters.length === 0) return;
    
    // 检查章节是否真的变化了
    if (prevChapterIdRef.current === currentChapter.id) {
      console.log(`章节未变化，跳过同步: ${currentChapter.title}`);
      return;
    }
    
    const syncChapterChange = async () => {
      const currentNativeIndex = await nativePlayer.getCurrentChapterIndex();
      const targetIndex = allChapters.findIndex(ch => ch.id === currentChapter.id);
      
      // 从 store 获取最新的 currentTime
      const latestCurrentTime = usePlayerStore.getState().currentTime;
      
      console.log(`同步章节: ${currentChapter.title}`);
      console.log(`  - 当前原生索引: ${currentNativeIndex}`);
      console.log(`  - 目标索引: ${targetIndex}`);
      console.log(`  - allChapters 长度: ${allChapters.length}`);
      console.log(`  - store currentTime: ${latestCurrentTime}`);
      
      if (targetIndex >= 0 && targetIndex !== currentNativeIndex) {
        console.log(`  → 执行同步: seekToChapter(${targetIndex}, ${latestCurrentTime})`);
        await nativePlayer.seekToChapter(targetIndex, latestCurrentTime);
      } else if (targetIndex < 0) {
        console.error(`  ✗ 错误: 在 allChapters 中找不到章节 ${currentChapter.id}`);
      } else {
        console.log(`  ✓ 已同步，无需操作`);
      }
      
      prevChapterIdRef.current = currentChapter.id;
    };
    
    syncChapterChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter?.id, isNative, allChapters.length]);



  // 播放控制
  const togglePlayback = async () => {
    if (isPlaying) {
      await nativePlayer.pause();
      setIsPlaying(false); // 立即更新状态，避免状态同步逻辑误判
    } else {
      await nativePlayer.play();
      setIsPlaying(true); // 立即更新状态，避免状态同步逻辑误判
    }
  };

  const nextChapter = async () => {
    if (!currentChapter) return;
    
    // Determine if current chapter is extra
    const isCurrentExtra = currentChapter.isExtra || /番外|SP|Extra/i.test(currentChapter.title);
    
    // Find current chapter in allChapters
    const currentGlobalIndex = allChapters.findIndex(ch => ch.id === currentChapter.id);
    if (currentGlobalIndex === -1) return;
    
    // Find next chapter of the same type (main or extra)
    for (let i = currentGlobalIndex + 1; i < allChapters.length; i++) {
      const ch = allChapters[i];
      const isExtra = ch.isExtra || /番外|SP|Extra/i.test(ch.title);
      if (isExtra === isCurrentExtra) {
        // Found next chapter of same type
        await nativePlayer.seekToChapter(i, 0);
        return;
      }
    }
    
    // No more chapters of this type
    console.log('已经是最后一章了');
  };

  const prevChapter = async () => {
    if (!currentChapter) return;
    
    // Determine if current chapter is extra
    const isCurrentExtra = currentChapter.isExtra || /番外|SP|Extra/i.test(currentChapter.title);
    
    // Find current chapter in allChapters
    const currentGlobalIndex = allChapters.findIndex(ch => ch.id === currentChapter.id);
    if (currentGlobalIndex === -1) return;
    
    // Find previous chapter of the same type (main or extra)
    for (let i = currentGlobalIndex - 1; i >= 0; i--) {
      const ch = allChapters[i];
      const isExtra = ch.isExtra || /番外|SP|Extra/i.test(ch.title);
      if (isExtra === isCurrentExtra) {
        // Found previous chapter of same type
        await nativePlayer.seekToChapter(i, 0);
        return;
      }
    }
    
    // No more chapters of this type
    console.log('已经是第一章了');
  };

  const handleSeek = (e: React.FormEvent<HTMLInputElement>) => {
    const time = parseFloat((e.target as HTMLInputElement).value);
    setSeekTime(time);
    if (!isSeeking) {
      nativePlayer.seekTo(time);
      setCurrentTime(time);
    }
  };

  const handleSeekStart = () => {
    setIsSeeking(true);
    setSeekTime(currentTime);
  };

  const handleSeekEnd = (e: React.FormEvent<HTMLInputElement>) => {
    const time = parseFloat((e.target as HTMLInputElement).value);
    setIsSeeking(false);
    nativePlayer.seekTo(time);
    setCurrentTime(time);
  };

  const handleSpeedChange = async (speed: number) => {
    await nativePlayer.setPlaybackSpeed(speed);
    setPlaybackSpeed(speed);
  };

  const handleSaveSettings = async () => {
    if (!currentBook) return;
    try {
      await apiClient.patch(`/api/books/${currentBook.id}`, {
        skipIntro: editSkipIntro,
        skipOutro: editSkipOutro
      });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getChapterProgressText = (chapter: any) => {
    if (!chapter.progressPosition || !chapter.duration) return null;
    
    const percent = Math.floor((chapter.progressPosition / chapter.duration) * 100);
    if (percent === 0) return null;
    if (percent >= 95) return '已播完';
    return `已播${percent}%`;
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

  const { mainChapters, extraChapters } = React.useMemo(() => {
    return {
      mainChapters: allChapters.filter(c => !c.isExtra),
      extraChapters: allChapters.filter(c => c.isExtra)
    };
  }, [allChapters]);

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

  // 原生睡眠定时器轮询
  useEffect(() => {
    if (!isNative) return;
    
    // 无论播放还是暂停，都持续轮询以更新UI
    // 但原生层在暂停时会暂停倒计时
    const pollInterval = setInterval(async () => {
      const remaining = await nativePlayer.getSleepTimer();
      setSleepTimer(remaining > 0 ? remaining : null);
    }, 1000);
    
    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);
  
  // Scroll to current chapter when chapter list opens
  useEffect(() => {
    if (showChapters && currentChapter) {
      // Determine which tab the current chapter belongs to
      const inMain = mainChapters.find(c => c.id === currentChapter.id);
      const inExtra = extraChapters.find(c => c.id === currentChapter.id);
      
      if (inMain && activeTab !== 'main') {
        setActiveTab('main');
      } else if (inExtra && activeTab !== 'extra') {
        setActiveTab('extra');
      }
      
      // Wait for tab switch and render, then scroll
      setTimeout(() => {
        const targetList = activeTab === 'main' ? mainChapters : extraChapters;
        const index = targetList.findIndex(c => c.id === currentChapter.id);
        
        if (index !== -1) {
          const groupIndex = Math.floor(index / chaptersPerGroup);
          if (currentGroupIndex !== groupIndex) {
            setCurrentGroupIndex(groupIndex);
          }
          
          // Wait for group switch, then scroll to element
          setTimeout(() => {
            const el = document.getElementById(`player-chapter-${currentChapter.id}`);
            if (el) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
            
            // Also scroll group tabs
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
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChapters]);

  const hiddenPaths = ['/admin', '/settings', '/downloads', '/cache'];
  const isHiddenPage = hiddenPaths.some(path => location.pathname.startsWith(path));
  const isWidgetMode = window.location.pathname.startsWith('/widget');

  useEffect(() => {
    if (isHiddenPage && isExpanded) {
      setTimeout(() => setIsExpanded(false), 0);
    }
  }, [location.pathname, isExpanded, isHiddenPage, setIsExpanded]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timerMenuRef.current && !timerMenuRef.current.contains(event.target as Node)) {
        setShowSleepTimer(false);
      }
      if (volumeControlRef.current && !volumeControlRef.current.contains(event.target as Node)) {
        // Volume control removed, keeping ref for future use
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!currentChapter) return null;

  const miniPlayerStyle = !isExpanded ? { 
    bottom: isWidgetMode ? '0' : 'var(--mini-player-offset)',
    height: isWidgetMode ? '100%' : (isCollapsed ? '64px' : 'var(--player-h)'),
    left: isWidgetMode ? '0' : undefined,
    right: isWidgetMode ? '0' : undefined,
  } : {};

  return (
    <div 
      className={`absolute transition-all duration-500 ease-in-out ${(isHiddenPage || isSeriesEditing) && !isExpanded ? 'translate-y-full opacity-0 pointer-events-none' : ''} ${isExpanded ? 'inset-0 z-[110] bg-white dark:bg-slate-950' : 'left-0 right-0 z-[30] bg-transparent pointer-events-none'}`}
      style={miniPlayerStyle}
    >
      {/* Mini Player */}
      {!isExpanded && (
        <div className={`h-full ${isWidgetMode ? 'px-0' : 'px-2 sm:px-4'} pointer-events-none`}>
          {isCollapsed ? (
            <div className="h-full flex items-end justify-start pointer-events-auto pb-2 pl-2" onClick={() => setIsCollapsed(false)}>
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden shadow-2xl cursor-pointer hover:scale-105 transition-transform border-2 border-white/50 dark:border-slate-700/50" style={{ borderColor: effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.3) : undefined }}>
                <img src={getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id)} alt={currentBook?.title} crossOrigin="anonymous" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover'; }} />
              </div>
            </div>
          ) : (
            <div className={`h-full ${isWidgetMode ? 'max-w-none rounded-none border-none shadow-none' : 'max-w-7xl mx-auto rounded-2xl sm:rounded-3xl shadow-2xl shadow-black/10 border border-slate-200/50 dark:border-slate-800/50'} bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-3 sm:gap-4 ${isWidgetMode ? 'px-3 max-[380px]:flex-col max-[380px]:justify-center max-[380px]:gap-1.5 max-[380px]:py-2' : 'px-3 sm:px-6'} pointer-events-auto transition-all duration-300`} style={{ backgroundColor: isWidgetMode ? undefined : (miniPlayerThemeColor ? setAlpha(miniPlayerThemeColor, 0.05) : undefined), borderColor: isWidgetMode ? undefined : (miniPlayerThemeColor ? setAlpha(miniPlayerThemeColor, 0.2) : undefined) }}>
              
              {/* 封面和信息 */}
              <div className={`flex items-center gap-2 sm:gap-3 min-w-0 ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:max-w-none' : ''} max-[500px]:max-w-[48px] max-[380px]:max-w-[40px] sm:max-w-[200px] md:max-w-[240px] lg:max-w-[320px] md:flex-none flex-1`}>
                <div className="w-12 h-12 max-[380px]:w-10 max-[380px]:h-10 sm:w-16 sm:h-16 rounded-lg sm:rounded-xl overflow-hidden shadow-md cursor-pointer shrink-0" onClick={() => setIsExpanded(true)}>
                  <img src={getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id)} alt={currentBook?.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover'; }} />
                </div>
                <div className="min-w-0 flex-1 hidden min-[500px]:block md:block max-[380px]:hidden">
                  <h4 className="font-bold dark:text-white truncate text-sm max-[380px]:text-xs">{currentBook?.title}</h4>
                  <p className="text-slate-500 truncate text-xs max-[380px]:text-[10px]">{currentChapter.title}</p>
                </div>
              </div>

              {/* 桌面控制 */}
              <div className="hidden md:flex flex-col items-center gap-1.5 flex-1 max-xl:max-w-xl px-4 lg:px-8">
                <div className="flex items-center gap-6">
                  <button onClick={prevChapter} className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}>
                    <SkipBack size={20} fill="currentColor" />
                  </button>
                  <button onClick={() => nativePlayer.seekTo(Math.max(0, currentTime - 15))} className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}>
                    <RotateCcw size={18} />
                  </button>
                  <button onClick={togglePlayback} className={`w-10 h-10 rounded-full text-white flex items-center justify-center shadow-lg hover:scale-105 transition-all ${!effectiveThemeColor ? 'bg-primary-600 dark:bg-primary-600' : ''}`} style={{ backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined, boxShadow: effectiveThemeColor ? `0 10px 15px -3px ${setAlpha(effectiveThemeColor, 0.3)}` : undefined, color: (effectiveThemeColor && isLight(effectiveThemeColor)) ? '#475569' : (effectiveThemeColor ? '#ffffff' : undefined) }}>
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                  </button>
                  <button onClick={() => nativePlayer.seekTo(currentTime + 30)} className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}>
                    <RotateCw size={18} />
                  </button>
                  <button onClick={nextChapter} className={`${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'} hover:scale-110 transition-all`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }}>
                    <SkipForward size={20} fill="currentColor" />
                  </button>
                </div>
                <div className="w-full flex items-center gap-3">
                  <span className="text-[10px] text-slate-400 w-8 text-right">{formatTime(currentTime)}</span>
                  <ProgressBar isMini={true} isSeeking={isSeeking} seekTime={seekTime} currentTime={currentTime} duration={duration} bufferedTime={bufferedTime} themeColor={miniPlayerThemeColor} onSeek={handleSeek} onSeekStart={handleSeekStart} onSeekEnd={handleSeekEnd} />
                  <span className="text-[10px] text-slate-400 w-8">{formatTime(duration)}</span>
                </div>
              </div>

              {/* 移动端控制 */}
              <div className={`flex md:hidden items-center gap-2 sm:gap-3 flex-1 min-w-0 justify-end ${isWidgetMode ? 'max-[380px]:w-full max-[380px]:justify-center max-[380px]:gap-6 max-[380px]:flex-none' : ''}`}>
                <div className={`flex-1 min-w-0 h-1.5 py-4 flex items-center w-full ${isWidgetMode ? 'max-[380px]:hidden' : ''}`}>
                  <ProgressBar isMini={true} isSeeking={isSeeking} seekTime={seekTime} currentTime={currentTime} duration={duration} bufferedTime={bufferedTime} themeColor={miniPlayerThemeColor} onSeek={handleSeek} onSeekStart={handleSeekStart} onSeekEnd={handleSeekEnd} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={togglePlayback} className={`w-10 h-10 max-[380px]:w-8 max-[380px]:h-8 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition-transform ${!effectiveThemeColor ? 'bg-primary-600 dark:bg-primary-600' : ''}`} style={{ backgroundColor: effectiveThemeColor ? toSolidColor(effectiveThemeColor) : undefined, color: (effectiveThemeColor && isLight(effectiveThemeColor)) ? '#475569' : (effectiveThemeColor ? '#ffffff' : undefined) }}>
                    {isPlaying ? <Pause size={20} className="max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" /> : <Play size={20} className="ml-1 max-[380px]:w-4 max-[380px]:h-4" fill="currentColor" />}
                  </button>
                  {!isWidgetMode && (
                    <button onClick={() => setIsCollapsed(true)} className={`p-2 transition-colors ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }} title="收起播放器">
                      <ChevronLeft size={24} />
                    </button>
                  )}
                </div>
              </div>

              {/* 桌面额外控制 */}
              <div className="hidden md:flex items-center gap-4 lg:gap-6 min-w-[100px] lg:min-w-[140px] justify-end">
                <button onClick={() => handleSpeedChange(playbackSpeed === 2 ? 1 : playbackSpeed + 0.25)} className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${useDarkControls ? 'text-slate-200 hover:text-white' : 'dark:text-slate-300'}`} style={{ backgroundColor: (miniPlayerThemeColor && !useDarkControls) ? setAlpha(miniPlayerThemeColor, 0.1) : undefined, color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.8)) : undefined }}>
                  {playbackSpeed}x
                </button>
                <button onClick={() => setIsCollapsed(true)} className={`transition-colors p-1 hover:scale-110 ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }} title="收起播放器">
                  <ChevronLeft size={20} />
                </button>
                <button onClick={() => setIsExpanded(true)} className={`transition-colors p-1 hover:scale-110 ${useDarkControls ? 'text-slate-200 hover:text-white' : 'text-slate-400 dark:text-slate-300'}`} style={{ color: (miniPlayerThemeColor && !useDarkControls) ? (isLight(miniPlayerThemeColor) ? '#475569' : setAlpha(miniPlayerThemeColor, 0.6)) : undefined }} title="展开播放器">
                  <Maximize2 size={20} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 展开播放器视图 - 这里可以复用原来的展开视图代码 */}
      {isExpanded && (
        <div className="absolute inset-0 flex flex-col px-4 pt-[calc(3rem+env(safe-area-inset-top))] pb-40 sm:p-8 md:p-12 overflow-y-auto animate-in slide-in-from-bottom duration-500 xl:pb-12 bg-white dark:bg-slate-950" style={{ backgroundColor: isWidgetMode ? (effectiveThemeColor ? toSolidColor(effectiveThemeColor) : '#1e293b') : (effectiveThemeColor ? setAlpha(effectiveThemeColor, 0.05) : undefined) }}>
          <div className="flex items-center justify-between w-full max-w-4xl mx-auto mb-4 sm:mb-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-2 sm:p-3 rounded-2xl shadow-sm border border-slate-200/30 dark:border-slate-800/30">
            {/* 左侧按钮组 */}
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button onClick={() => setIsExpanded(false)} className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors">
                <ArrowLeft size={20} className="sm:w-6 sm:h-6 dark:text-white text-[#4A3728]" />
              </button>
              
              {/* 音量控制 */}
              <div className="relative" ref={volumeControlRef}>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVolumeControl(!showVolumeControl);
                  }}
                  className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors"
                  title="音量"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX size={18} className="sm:w-5 sm:h-5 dark:text-white text-[#4A3728]" />
                  ) : (
                    <Volume2 size={18} className={`sm:w-5 sm:h-5 dark:text-white text-[#4A3728] ${showVolumeControl ? 'text-primary-600 dark:text-primary-600' : ''}`} />
                  )}
                </button>

                {showVolumeControl && (
                  <div 
                    className="absolute top-full mt-3 left-0 bg-white dark:bg-slate-800 shadow-xl rounded-full py-4 border border-slate-100 dark:border-slate-700 w-12 flex flex-col items-center gap-3 z-[220] animate-in zoom-in-95 duration-200 cursor-default"
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
                          const newVolume = parseFloat(e.target.value);
                          setVolume(newVolume);
                          nativePlayer.setVolume(newVolume);
                          if (isMuted && newVolume > 0) setIsMuted(false);
                        }}
                        className="absolute w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary-600 -rotate-90 hover:accent-primary-500"
                      />
                    </div>

                    <button
                      onClick={() => {
                        const newMuted = !isMuted;
                        setIsMuted(newMuted);
                        const newVolume = newMuted ? 0 : (volume === 0 ? 0.5 : volume);
                        if (!newMuted && volume === 0) setVolume(0.5);
                        nativePlayer.setVolume(newMuted ? 0 : newVolume);
                      }}
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
            
            {/* 标题居中 */}
            <div className="flex-1 text-center px-2 sm:px-4 min-w-0">
              <h2 className="text-sm sm:text-lg font-bold dark:text-white text-[#4A3728] truncate">{currentBook?.title}</h2>
              <p className="text-[10px] sm:text-xs text-slate-500 truncate">{currentChapter.title}</p>
            </div>
            
            {/* 右侧按钮组 */}
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button onClick={() => setShowChapters(true)} className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors" title="章节列表">
                <ListMusic size={18} className="sm:w-5 sm:h-5 dark:text-white text-[#4A3728]" />
              </button>
              <button onClick={() => setShowSettings(true)} className="p-1.5 sm:p-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-full transition-colors">
                <Settings size={18} className="sm:w-5 sm:h-5 dark:text-white text-[#4A3728]" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full gap-4 sm:gap-8">
            <div className="w-full max-w-[240px] sm:max-w-[320px] lg:max-w-[400px] aspect-square rounded-[32px] sm:rounded-[40px] overflow-hidden shadow-2xl border-4 sm:border-8 border-white dark:border-slate-800 transition-all duration-500">
              <img src={getCoverUrl(currentBook?.coverUrl, currentBook?.libraryId, currentBook?.id)} alt={currentBook?.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/300x400?text=No+Cover'; }} />
            </div>

            <div className="w-full space-y-8 sm:space-y-12">
              <div className="px-2 sm:px-4">
                <div className="flex items-center gap-3 sm:gap-6 justify-center">
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 min-w-[40px] text-right">{formatTime(currentTime)}</span>
                  <div className="flex-1 max-w-2xl">
                    <ProgressBar isSeeking={isSeeking} seekTime={seekTime} currentTime={currentTime} duration={duration} bufferedTime={bufferedTime} themeColor={themeColor} onSeek={handleSeek} onSeekStart={handleSeekStart} onSeekEnd={handleSeekEnd} />
                  </div>
                  <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 min-w-[40px]">{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4 sm:gap-10 md:gap-14">
                <button onClick={() => nativePlayer.seekTo(Math.max(0, currentTime - 15))} className="text-slate-600 dark:text-slate-400 p-1.5 sm:p-2 hover:scale-110 transition-transform">
                  <div className="relative">
                    <RotateCcw size={24} className="sm:w-8 sm:h-8" />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] sm:text-[10px] font-bold mt-0.5">15</span>
                  </div>
                </button>
                <button onClick={prevChapter} className="text-slate-900 dark:text-white p-1.5 sm:p-2 hover:scale-110 transition-transform">
                  <SkipBack size={28} className="sm:w-9 sm:h-9" fill="currentColor" />
                </button>
                <button onClick={togglePlayback} className={`w-16 h-16 sm:w-24 sm:h-24 rounded-full text-white flex items-center justify-center shadow-2xl transform hover:scale-105 active:scale-95 transition-all ${!effectiveThemeColor ? 'bg-primary-600' : ''}`} style={effectiveThemeColor ? { backgroundColor: toSolidColor(effectiveThemeColor), color: isLight(effectiveThemeColor) ? '#475569' : '#ffffff' } : {}}>
                  {isPlaying ? <Pause size={32} className="sm:w-12 sm:h-12" fill="currentColor" /> : <Play size={32} className="sm:w-12 sm:h-12 ml-1 sm:ml-2" fill="currentColor" />}
                </button>
                <button onClick={nextChapter} className="text-slate-900 dark:text-white p-1.5 sm:p-2 hover:scale-110 transition-transform">
                  <SkipForward size={28} className="sm:w-9 sm:h-9" fill="currentColor" />
                </button>
                <button onClick={() => nativePlayer.seekTo(currentTime + 15)} className="text-slate-600 dark:text-slate-400 p-1.5 sm:p-2 hover:scale-110 transition-transform">
                  <div className="relative">
                    <RotateCw size={24} className="sm:w-8 sm:h-8" />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] sm:text-[10px] font-bold mt-0.5">15</span>
                  </div>
                </button>
              </div>

              <div className="flex justify-between items-center max-w-2xl mx-auto w-full px-2 sm:px-4 text-slate-600 dark:text-slate-400">
                <button onClick={() => handleSpeedChange(playbackSpeed >= 2 ? 0.5 : playbackSpeed + 0.25)} className="flex flex-col items-center gap-1 sm:gap-1.5 transition-all active:scale-95 group relative">
                  <div className="p-2 rounded-xl group-hover:bg-white/40 dark:group-hover:bg-slate-800/40 transition-colors">
                    <Zap size={18} className={`sm:w-5 sm:h-5 ${playbackSpeed !== 1 ? 'text-primary-600 animate-pulse' : ''}`} />
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold">{playbackSpeed}x</span>
                </button>
                
                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  <div className="p-2"><SkipBack size={18} className="sm:w-5 sm:h-5" /></div>
                  <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">片头 {currentBook?.skipIntro || 0}s</span>
                </div>
                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  <div className="p-2"><SkipForward size={18} className="sm:w-5 sm:h-5" /></div>
                  <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">片尾 {currentBook?.skipOutro || 0}s</span>
                </div>
                <button onClick={() => setShowSleepTimer(!showSleepTimer)} className="flex flex-col items-center gap-1 sm:gap-1.5 transition-all active:scale-95 group">
                  <div className="p-2 rounded-xl group-hover:bg-white/40 dark:group-hover:bg-slate-800/40 transition-colors">
                    <Clock size={18} className={`sm:w-5 sm:h-5 ${sleepTimer ? 'text-primary-600 animate-pulse' : ''}`} />
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold">{sleepTimer ? `${Math.floor(sleepTimer / 60)}:${(sleepTimer % 60).toString().padStart(2, '0')}` : '定时'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Sleep Timer Menu */}
          {showSleepTimer && (
            <div className="fixed bottom-32 right-4 z-[220] bg-white dark:bg-slate-800 shadow-2xl rounded-2xl p-3 sm:p-4 border border-slate-100 dark:border-slate-700 min-w-[180px] sm:min-w-[200px] flex flex-col gap-2 animate-in zoom-in-95 duration-200">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700 mb-1 text-center">
                睡眠定时
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[15, 30, 45, 60].map(mins => (
                  <button
                    key={mins}
                    onClick={async () => {
                      await nativePlayer.setSleepTimer(mins);
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
                  onClick={async () => {
                    const mins = parseInt(customMinutes);
                    if (mins > 0) {
                      await nativePlayer.setSleepTimer(mins);
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
                onClick={async () => {
                  await nativePlayer.setSleepTimer(0);
                  setShowSleepTimer(false);
                }}
                className="mt-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 transition-colors"
              >
                取消定时
              </button>
            </div>
          )}

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
                    const globalIndex = allChapters.findIndex(ch => ch.id === chapter.id);
                    
                    return (
                      <div 
                        key={chapter.id}
                        id={`player-chapter-${chapter.id}`}
                        onClick={async () => {
                          if (globalIndex >= 0) {
                            await nativePlayer.seekToChapter(globalIndex, 0);
                            // State will be updated by onChapterChanged callback
                            setShowChapters(false);
                          }
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

export default PlayerNative;
