import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentBook: null,
      currentChapter: null,
      chapters: [],
      isPlaying: false,
      duration: 0,
      currentTime: 0,
      playbackSpeed: 1.0,
      volume: 1.0,
      themeColor: '#F2EDE4',
      isExpanded: false,
      chapterProgress: {},
      clientAutoDownload: false,

      setClientAutoDownload: (enabled) => set({ clientAutoDownload: enabled }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setIsExpanded: (isExpanded) => set({ isExpanded }),

      playBook: (book, chapters, startChapterId) => {
        const isOffline = typeof window !== 'undefined' && (!navigator.onLine || window.location.hash.includes('/offline'));
        let chapter;
        const { chapterProgress } = get();
        
        if (startChapterId) {
          chapter = chapters.find(c => c.id === startChapterId) || chapters[0];
        } else {
          const playedChapters = [...chapters].filter(c => !!getProgressUpdatedAt(c));
          if (playedChapters.length > 0) {
            playedChapters.sort((a, b) => {
              const dateA = new Date(getProgressUpdatedAt(a)!);
              const dateB = new Date(getProgressUpdatedAt(b)!);
              return dateB.getTime() - dateA.getTime();
            });
            chapter = playedChapters[0];
          } else {
            chapter = chapters[0];
          }
        }
        
        const progress = isOffline ? (chapterProgress[chapter.id] ?? getProgressPosition(chapter)) : getProgressPosition(chapter);

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
        const isOffline = typeof window !== 'undefined' && (!navigator.onLine || window.location.hash.includes('/offline'));
        if (!isOffline || !state.currentChapter) return { currentTime: time };
        return { currentTime: time, chapterProgress: { ...state.chapterProgress, [state.currentChapter.id]: time } };
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
          const isOffline = typeof window !== 'undefined' && (!navigator.onLine || window.location.hash.includes('/offline'));
          let progress = isOffline ? (chapterProgress[nextChapter.id] ?? getProgressPosition(nextChapter)) : getProgressPosition(nextChapter);
          const duration = nextChapter.duration || 0;

          if (duration > 0 && progress > 0) {
              const timeLeft = duration - progress;
              if (timeLeft < 5 || (progress / duration) > 0.99) {
                  progress = 0;
              }
          }

          set({ 
            currentChapter: nextChapter, 
            currentTime: progress,
            duration: nextChapter.duration || 0,
            isPlaying: true
          });
        }
      },

      prevChapter: () => {
        const { currentChapter, chapters, chapterProgress } = get();
        if (!currentChapter) return;
        const index = chapters.findIndex(c => c.id === currentChapter.id);
        if (index > 0) {
          const prevChapter = chapters[index - 1];
          const isOffline = typeof window !== 'undefined' && (!navigator.onLine || window.location.hash.includes('/offline'));
          let progress = isOffline ? (chapterProgress[prevChapter.id] ?? getProgressPosition(prevChapter)) : getProgressPosition(prevChapter);
          const duration = prevChapter.duration || 0;

          if (duration > 0 && progress > 0) {
              const timeLeft = duration - progress;
              if (timeLeft < 5 || (progress / duration) > 0.99) {
                  progress = 0;
              }
          }
          
          set({ 
            currentChapter: prevChapter, 
            currentTime: progress,
            duration: prevChapter.duration || 0,
            isPlaying: true
          });
        }
      },

      playChapter: (book, chapters, chapter, resumePosition) => {
        const { chapterProgress } = get();
        const isOffline = typeof window !== 'undefined' && (!navigator.onLine || window.location.hash.includes('/offline'));
        let startTime = 0;
        if (resumePosition !== undefined) {
            startTime = resumePosition;
        } else {
            startTime = isOffline ? (chapterProgress[chapter.id] ?? getProgressPosition(chapter)) : getProgressPosition(chapter);
            
            const duration = chapter.duration || 0;
            if (duration > 0 && startTime > 0) {
                 const timeLeft = duration - startTime;
                 if (timeLeft < 5 || (startTime / duration) > 0.99) {
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
    }),
    {
      name: 'offline-progress-storage',
      partialize: (state) => ({ chapterProgress: state.chapterProgress })
    }
  )
);
