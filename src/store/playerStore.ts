import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book, Chapter } from '../types';
import { isTooLight } from '../utils/color';

/** Check if a chapter's progress indicates it has been fully played (>= 95%) */
function isChapterFinished(chapter: Chapter): boolean {
  if (!chapter.progressPosition || !chapter.duration || chapter.duration <= 0) return false;
  return chapter.progressPosition / chapter.duration >= 0.95;
}

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
      themeColor: '#F2EDE4',
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
        let chapter;
        if (startChapterId) {
          chapter = chapters.find(c => c.id === startChapterId) || chapters[0];
        } else {
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

        // If chapter is finished, restart from beginning
        const startPos = isChapterFinished(chapter) ? 0 : (chapter.progressPosition || 0);

        const newState: Partial<PlayerState> = {
          currentBook: book,
          chapters,
          currentChapter: chapter,
          isPlaying: true,
          currentTime: startPos,
          duration: chapter.duration || 0
        };

        if (book.themeColor && !isTooLight(book.themeColor)) {
          newState.themeColor = book.themeColor;
        } else {
          newState.themeColor = '#F2EDE4';
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

        if (chapters.length === 0 || !chapters.some(c => c.id === currentChapter.id)) {
          return;
        }

        const index = chapters.findIndex(c => c.id === currentChapter.id);
        if (index !== -1 && index < chapters.length - 1) {
          const nextChapter = chapters[index + 1];
          set({
            currentChapter: nextChapter,
            currentTime: nextChapter.progressPosition || 0,
            duration: nextChapter.duration || 0
          });
        }
      },

      prevChapter: () => {
        const { currentChapter, chapters, currentBook } = get();
        if (!currentChapter || !currentBook) return;
        const index = chapters.findIndex(c => c.id === currentChapter.id);
        if (index > 0) {
          const prevChapter = chapters[index - 1];
          set({
            currentChapter: prevChapter,
            currentTime: prevChapter.progressPosition || 0,
            duration: prevChapter.duration || 0
          });
        }
      },

      playChapter: (book, chapters, chapter, resumePosition) => {
        let startPos: number;
        if (resumePosition !== undefined) {
          startPos = resumePosition;
        } else if (isChapterFinished(chapter)) {
          // Clicking a finished chapter clears its progress and restarts from beginning
          startPos = 0;
        } else {
          startPos = chapter.progressPosition || 0;
        }

        const newState: Partial<PlayerState> = {
          currentBook: book,
          chapters,
          currentChapter: chapter,
          isPlaying: true,
          currentTime: startPos,
          duration: chapter.duration || 0
        };

        if (book.themeColor && !isTooLight(book.themeColor)) {
          newState.themeColor = book.themeColor;
        } else {
          newState.themeColor = '#F2EDE4';
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
