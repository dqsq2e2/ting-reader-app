import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book, Chapter } from '../types';
import { isTooLight } from '../utils/color';

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
  isCollapsed: boolean;
  isSeriesEditing: boolean;
  ignoreAudioFocus: boolean;
  
  // Actions
  playBook: (book: Book, chapters: Chapter[], startChapterId?: string) => void;
  togglePlay: () => void;
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
  setIsCollapsed: (isCollapsed: boolean) => void;
  setIsSeriesEditing: (isSeriesEditing: boolean) => void;
  setIgnoreAudioFocus: (ignore: boolean) => void;
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
      themeColor: '#F2EDE4', // Default background color
      isExpanded: false,
      isCollapsed: false,
      isSeriesEditing: false,
      ignoreAudioFocus: false,

      setIgnoreAudioFocus: (ignore) => set({ ignoreAudioFocus: ignore }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setIsExpanded: (isExpanded) => set({ isExpanded }),
      setIsCollapsed: (isCollapsed) => set({ isCollapsed }),
      setIsSeriesEditing: (isSeriesEditing) => set({ isSeriesEditing }),

      playBook: (book, chapters, startChapterId) => {
        // If no startChapterId is provided, find the most recently played chapter
        let chapter;
        if (startChapterId) {
          chapter = chapters.find(c => c.id === startChapterId) || chapters[0];
        } else {
          // Sort by progressUpdatedAt descending and take the first one that has progress
          const playedChapters = [...chapters].filter(c => c.progressUpdatedAt);
          if (playedChapters.length > 0) {
            playedChapters.sort((a, b) => {
              return new Date(b.progressUpdatedAt!).getTime() - new Date(a.progressUpdatedAt!).getTime();
            });
            chapter = playedChapters[0];
          } else {
            chapter = chapters[0];
          }
        }
        
        const newState: Partial<PlayerState> = { 
          currentBook: book, 
          chapters, 
          currentChapter: chapter,
          isPlaying: true,
          currentTime: chapter.progressPosition || 0,
          duration: chapter.duration || 0
        };

        if (book.themeColor && !isTooLight(book.themeColor)) {
          newState.themeColor = book.themeColor;
        } else {
          newState.themeColor = '#F2EDE4'; // Reset to default
        }

        set(newState);
      },

      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
      
      setCurrentTime: (time) => set({ currentTime: time }),
      
      setDuration: (duration) => set({ duration }),
      
      setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
      
      setVolume: (volume) => set({ volume }),

      setThemeColor: (color) => set({ themeColor: color }),

      nextChapter: () => {
        const { currentChapter, chapters, currentBook } = get();
        if (!currentChapter || !currentBook) return;
        
        // 确保 chapters 数组不为空且包含当前章节
        if (chapters.length === 0 || !chapters.some(c => c.id === currentChapter.id)) {
          console.warn('Chapters array is empty or does not contain current chapter, cannot proceed to next chapter');
          return;
        }
        
        const index = chapters.findIndex(c => c.id === currentChapter.id);
        if (index !== -1 && index < chapters.length - 1) {
          const nextChapter = chapters[index + 1];
          get().playChapter(currentBook, chapters, nextChapter);
        }
      },

      prevChapter: () => {
        const { currentChapter, chapters, currentBook } = get();
        if (!currentChapter || !currentBook) return;
        const index = chapters.findIndex(c => c.id === currentChapter.id);
        if (index > 0) {
          const prevChapter = chapters[index - 1];
          get().playChapter(currentBook, chapters, prevChapter);
        }
      },

      playChapter: (book, chapters, chapter, resumePosition) => {
        const newState: Partial<PlayerState> = { 
          currentBook: book, 
          chapters, 
          currentChapter: chapter, 
          isPlaying: true, 
          currentTime: resumePosition ?? (chapter.progressPosition || 0),
          duration: chapter.duration || 0
        };
        
        if (book.themeColor && !isTooLight(book.themeColor)) {
          newState.themeColor = book.themeColor;
        } else {
          newState.themeColor = '#F2EDE4'; // Reset to default
        }

        set(newState);
      }
    }),
    {
      name: 'player-storage',
      partialize: (state) => ({
        ignoreAudioFocus: state.ignoreAudioFocus,
        chapterProgress: state.chapterProgress
      })
    }
  )
);
