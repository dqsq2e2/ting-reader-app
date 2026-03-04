import React, { useMemo, useRef, useEffect } from 'react';
import { 
  Clock, 
  Check, 
  Download, 
  Loader2, 
  ChevronLeft,
} from 'lucide-react';
import { type Chapter, type Book } from '../types';
import { type DownloadTask } from '../store/downloadStore';

interface ChapterListProps {
  chapters: Chapter[];
  currentChapter: Chapter | null;
  currentBook: Book | null;
  isPlaying: boolean;
  themeColor: string | null;
  currentGroupIndex: number;
  onGroupChange: (index: number) => void;
  onPlayChapter: (book: Book, chapters: Chapter[], chapter: Chapter) => void;
  onClose: () => void;
  downloadTasks: DownloadTask[];
  cachedChapters: Map<string, string>;
  addTask: (task: DownloadTask) => void;
  activeTab: 'main' | 'extra';
  onTabChange: (tab: 'main' | 'extra') => void;
}

const chaptersPerGroup = 100;

const ChapterList: React.FC<ChapterListProps> = React.memo(({
  chapters,
  currentChapter,
  currentBook,
  isPlaying,
  themeColor,
  currentGroupIndex,
  onGroupChange,
  onPlayChapter,
  onClose,
  downloadTasks,
  cachedChapters,
  addTask,
  activeTab,
  onTabChange
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);

  const { mainChapters, extraChapters } = useMemo(() => {
    // Sort chapters first by their original index to ensure correct order
    const sorted = [...chapters].sort((a, b) => {
        if (a.chapterIndex && b.chapterIndex) return a.chapterIndex - b.chapterIndex;
        return 0;
    });

    const main: Chapter[] = [];
    const extra: Chapter[] = [];
    
    sorted.forEach(c => {
        const isExtra = !!c.isExtra || /番外|SP|Extra/i.test(c.title);
        if (isExtra) {
            extra.push(c);
        } else {
            main.push(c);
        }
    });
    return { mainChapters: main, extraChapters: extra };
  }, [chapters]);

  const currentList = activeTab === 'main' ? mainChapters : extraChapters;

  const groups = useMemo(() => {
    const g = [];
    for (let i = 0; i < currentList.length; i += chaptersPerGroup) {
      const slice = currentList.slice(i, i + chaptersPerGroup);
      const start = i + 1;
      const end = i + slice.length;
      
      let label = '';
      if (activeTab === 'extra') {
          label = `番外 ${start}-${end}`;
      } else {
          label = `第 ${start} - ${end} 章`;
      }

      g.push({
        label,
        start,
        end,
        chapters: slice
      });
    }
    return g;
  }, [currentList, activeTab]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [activeTab]);

  const scrollGroups = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
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

  const getChapterProgressText = (chapter: Chapter) => {
    if (!chapter.progressPosition || !chapter.duration) return null;
    
    const percent = Math.floor((chapter.progressPosition / chapter.duration) * 100);
    if (percent === 0) return null;
    if (percent >= 95) return '已播完';
    return `已播${percent}%`;
  };

  // Auto-scroll logic handled here to avoid Player re-renders
  useEffect(() => {
    if (currentChapter && !hasAutoScrolledRef.current && groups.length > 0) {
        // Scroll group tab into view
        const groupTab = document.getElementById(`player-group-tab-${currentGroupIndex}`);
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

        // Scroll chapter into view
        // We use a small timeout to ensure DOM is ready
        setTimeout(() => {
            const chapterEl = document.getElementById(`player-chapter-${currentChapter.id}`);
            if (chapterEl) {
                chapterEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }, 100);
        hasAutoScrolledRef.current = true;
    }
  }, [currentChapter, currentGroupIndex, groups.length]);

  // Safe theme color for styles
  const safeThemeColor = themeColor || 'rgba(0,0,0,0.15)';

  return (
    <>
      {/* Main/Extra Tab Switcher */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
          <button 
             onClick={() => onTabChange('main')}
             className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
                 activeTab === 'main' 
                 ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20' 
                 : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
             }`}
          >
             正文 ({mainChapters.length})
          </button>
          {extraChapters.length > 0 && (
              <button 
                 onClick={() => onTabChange('extra')}
                 className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
                     activeTab === 'extra' 
                     ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20' 
                     : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                 }`}
              >
                 番外 ({extraChapters.length})
              </button>
          )}
      </div>

      {/* Chapter Groups Selector */}
      {groups.length > 1 && (
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
                id={`player-group-tab-${index}`}
                onClick={() => onGroupChange(index)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border shrink-0 snap-start ${
                  currentGroupIndex === index
                    ? 'text-white shadow-lg shadow-primary-500/30'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                }`}
                style={currentGroupIndex === index ? { 
                  backgroundColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0'),
                  borderColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0')
                } : {}}
              >
                {group.label}
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

      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {(groups[currentGroupIndex]?.chapters || currentList).map((chapter, index) => {
          const actualIndex = currentGroupIndex * chaptersPerGroup + index;
          const displayIndex = actualIndex + 1;
          
          const isCurrent = currentChapter?.id === chapter.id;
          const isCached = cachedChapters.has(chapter.id);
          const downloadTask = downloadTasks.find(t => t.id === chapter.id);
          const isDownloading = downloadTask?.status === 'pending' || downloadTask?.status === 'downloading';
          const isFailed = downloadTask?.status === 'error';
          
          return (
            <div 
              key={chapter.id}
              id={`player-chapter-${chapter.id}`}
              className={`group flex items-center justify-between p-4 rounded-2xl transition-all border ${
                isCurrent 
                  ? 'bg-opacity-10 border-opacity-20' 
                  : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-primary-200 dark:hover:border-primary-800'
              }`}
              style={isCurrent ? { 
                backgroundColor: safeThemeColor.replace('0.15', '0.1').replace('0.1', '0.1'),
                borderColor: safeThemeColor.replace('0.15', '0.3').replace('0.1', '0.3'),
              } : {}}
            >
              <div 
                className="flex items-center gap-4 min-w-0 flex-1 cursor-pointer"
                onClick={() => {
                  onPlayChapter(currentBook!, chapters, chapter);
                  onClose();
                }}
              >
                <div 
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center font-bold text-base sm:text-lg shrink-0 ${
                    isCurrent ? 'text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                  style={isCurrent ? { backgroundColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0') } : {}}
                >
                  {displayIndex}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p 
                      className={`text-sm sm:text-base font-bold truncate ${isCurrent ? '' : 'text-slate-900 dark:text-white'}`}
                      style={isCurrent ? { color: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0') } : {}}
                    >
                      {chapter.title}
                    </p>
                    {isFailed && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-md">失败</span>
                    )}
                  </div>
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
                    {isCached && (
                      <div className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                         <Check size={10} />
                         已缓存
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4 pl-4 border-l border-slate-100 dark:border-slate-800 ml-4">
                {!isCached && !isDownloading && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      addTask({
                        id: chapter.id,
                        bookId: currentBook!.id,
                        bookTitle: currentBook!.title,
                        themeColor: currentBook!.themeColor,
                        chapterId: chapter.id,
                          title: chapter.title,
                          chapterNum: displayIndex,
                          duration: chapter.duration,
                          coverUrl: currentBook!.coverUrl
                      });
                    }}
                    className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-full transition-all"
                    title="下载缓存"
                  >
                    <Download size={18} />
                  </button>
                )}
                {isDownloading && (
                   <div className="p-2">
                      <Loader2 size={18} className="text-primary-500 animate-spin" />
                   </div>
                )}

                {isCurrent && isPlaying && (
                  <div className="flex gap-1 items-end h-5">
                    <div className="w-1 animate-music-bar-1 rounded-full" style={{ backgroundColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}></div>
                    <div className="w-1 animate-music-bar-2 rounded-full" style={{ backgroundColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}></div>
                    <div className="w-1 animate-music-bar-3 rounded-full" style={{ backgroundColor: safeThemeColor.replace('0.15', '1.0').replace('0.1', '1.0') }}></div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
});

ChapterList.displayName = 'ChapterList';

export default ChapterList;
