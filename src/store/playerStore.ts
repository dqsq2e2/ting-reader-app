import { create } from 'zustand';
import type { Book, Chapter } from '../types';

type ChapterProgressMeta = {
  progress_updated_at?: string;
  progress_position?: number;
};

const getProgressUpdatedAt = (chapter: Chapter) => (chapter as Chapter & ChapterProgressMeta).progress_updated_at;
const getProgressPosition = (chapter: Chapter) => {
  const value = (chapter as Chapter & ChapterProgressMeta).progress_position;
  return typeof value === 'number' ? value : 0;
};

interface PlayerState {
  currentBook: Book | null;
  currentChapter: Chapter | null;
  chapters: Chapter[];
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  playbackSpeed: number;
  volume: number;
  themeColor: string;
  isExpanded: boolean;
  chapterProgress: Record<string, number>;
  clientAutoDownload: boolean;
  
  // Actions
  playBook: (book: Book, chapters: Chapter[], startChapterId?: string) => void;
  togglePlay: () => void;
  setClientAutoDownload: (enabled: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setVolume: (volume: number) => void;
  setThemeColor: (color: string) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  playChapter: (book: Book, chapters: Chapter[], chapter: Chapter, resumePosition?: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsExpanded: (isExpanded: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentBook: null,
  currentChapter: null,
  chapters: [],
  isPlaying: false,
  duration: 0,
  currentTime: 0,
  playbackSpeed: 1.0,
  volume: 1.0,
  themeColor: '#F2EDE4', // Default background color
  isExpanded: false,
  chapterProgress: {},
  clientAutoDownload: false,

  setClientAutoDownload: (enabled) => set({ clientAutoDownload: enabled }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsExpanded: (isExpanded) => set({ isExpanded }),

  playBook: (book, chapters, startChapterId) => {
    // If no startChapterId is provided, find the most recently played chapter
    let chapter;
    const { chapterProgress } = get();
    
    if (startChapterId) {
      chapter = chapters.find(c => c.id === startChapterId) || chapters[0];
    } else {
      // Sort by progress_updated_at descending and take the first one that has progress
      const playedChapters = [...chapters].filter(c => !!getProgressUpdatedAt(c));
      if (playedChapters.length > 0) {
        playedChapters.sort((a, b) => {
          return new Date(getProgressUpdatedAt(b) || 0).getTime() - new Date(getProgressUpdatedAt(a) || 0).getTime();
        });
        chapter = playedChapters[0];
      } else {
        chapter = chapters[0];
      }
    }
    
    // Determine start time: local memory > server data > 0
    const progress = chapterProgress[chapter.id] ?? getProgressPosition(chapter);

    const newState: Partial<PlayerState> = { 
      currentBook: book, 
      chapters, 
      currentChapter: chapter,
      isPlaying: true,
      currentTime: progress,
      duration: chapter.duration || 0
    };

    if (book.theme_color) {
      newState.themeColor = book.theme_color;
    }

    set(newState);
  },

  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  
  setCurrentTime: (time) => set((state) => {
      // Update progress map efficiently
      // We only clone if we really need to write, but here we always write.
      // To avoid object thrashing, maybe only update if diff > 1s? 
      // But setCurrentTime is usually throttled by the caller (Player.tsx polling).
      
      const newProgress = { ...state.chapterProgress };
      if (state.currentChapter) {
          newProgress[state.currentChapter.id] = time;
      }
      return { currentTime: time, chapterProgress: newProgress };
  }),
  
  setDuration: (duration) => set({ duration }),
  
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  
  setVolume: (volume) => set({ volume }),

  setThemeColor: (color) => set({ themeColor: color }),

  nextChapter: () => {
    const { currentChapter, chapters, chapterProgress } = get();
    if (!currentChapter) return;
    const index = chapters.findIndex(c => c.id === currentChapter.id);
    if (index < chapters.length - 1) {
      const nextChapter = chapters[index + 1];
      
      // Get saved progress
      let progress = chapterProgress[nextChapter.id] ?? getProgressPosition(nextChapter);
      const duration = nextChapter.duration || 0;

      // Smart Resume Logic:
      // If the chapter was previously finished (e.g. < 5s remaining or > 99% complete), 
      // reset it to start to avoid "infinite loop" of auto-skipping.
      // Otherwise, resume from memory.
      if (duration > 0 && progress > 0) {
          const timeLeft = duration - progress;
          // Use a tighter threshold: 5 seconds or 99%
          if (timeLeft < 5 || (progress / duration) > 0.99) {
              console.log(`[PlayerStore] Chapter ${nextChapter.title} considered finished (progress: ${progress}/${duration}), restarting.`);
              progress = 0;
          }
      }

      set({ 
        currentChapter: nextChapter, 
        currentTime: progress,
        duration: nextChapter.duration || 0,
        isPlaying: true // Force play when manually skipping
      });
    }
  },

  prevChapter: () => {
    const { currentChapter, chapters, chapterProgress } = get();
    if (!currentChapter) return;
    const index = chapters.findIndex(c => c.id === currentChapter.id);
    if (index > 0) {
      const prevChapter = chapters[index - 1];
      
      // Get saved progress
      let progress = chapterProgress[prevChapter.id] ?? getProgressPosition(prevChapter);
      const duration = prevChapter.duration || 0;

      // Smart Resume Logic:
      // If the chapter was previously finished, reset it to start.
      if (duration > 0 && progress > 0) {
          const timeLeft = duration - progress;
          if (timeLeft < 5 || (progress / duration) > 0.99) {
              console.log(`[PlayerStore] Chapter ${prevChapter.title} considered finished (progress: ${progress}/${duration}), restarting.`);
              progress = 0;
          }
      }
      
      set({ 
        currentChapter: prevChapter, 
        currentTime: progress,
        duration: prevChapter.duration || 0,
        isPlaying: true // Force play when manually skipping
      });
    }
  },

  playChapter: (book, chapters, chapter, resumePosition) => {
    const { chapterProgress } = get();
    // Priority: Explicit resume > Local Memory > Server Data > 0
    let startTime = 0;
    if (resumePosition !== undefined) {
        startTime = resumePosition;
    } else {
        startTime = chapterProgress[chapter.id] ?? getProgressPosition(chapter);
        
        // Smart Resume for direct play as well
        const duration = chapter.duration || 0;
        if (duration > 0 && startTime > 0) {
             const timeLeft = duration - startTime;
             if (timeLeft < 5 || (startTime / duration) > 0.99) {
                 console.log(`[PlayerStore] Chapter ${chapter.title} considered finished, restarting.`);
                 startTime = 0;
             }
        }
    }

    const newState: Partial<PlayerState> = { 
      currentBook: book, 
      chapters, 
      currentChapter: chapter, 
      isPlaying: true, 
      currentTime: startTime,
      duration: chapter.duration || 0
    };

    if (book.theme_color) {
      newState.themeColor = book.theme_color;
    }

    set(newState);
  },
}));
