import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  ChevronLeft,
  ChevronRight,
  Lock,
  Maximize,
  Minimize,
  Moon,
  Search,
  Sun,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { SeoHead } from '../components/SeoHead';
import type { Book, Bookmark, ReadingProgress } from '../shared/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type FitMode = 'custom' | 'width' | 'page';

export const ReaderPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const { user, theme, toggleTheme, t } = useApp();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [book, setBook] = useState<Book | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.25);
  const [fitMode, setFitMode] = useState<FitMode>('width');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState('');
  const [panelError, setPanelError] = useState<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchHits, setSearchHits] = useState<Array<{ page: number; snippet: string }>>([]);
  const [searching, setSearching] = useState(false);

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize reader session and load PDF via short-lived signed URL
  useEffect(() => {
    let active = true;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    async function init() {
      if (!bookId) return;
      setLoading(true);
      setAccessDenied(false);
      setErrorMsg(null);
      try {
        const detail = await apiFetch<{
          book: Book;
          access?: { canRead: boolean };
          readerState: { progress: ReadingProgress | null; bookmarks: Bookmark[] } | null;
        }>(`/api/books/${bookId}`);

        if (!active) return;
        setBook(detail.book);
        if (detail.readerState?.bookmarks) {
          setBookmarks(detail.readerState.bookmarks);
        }

        const session = await apiFetch<{ signedUrl: string }>(`/api/books/${detail.book.id}/pdf-session`, {
          method: 'POST',
        });

        loadingTask = pdfjsLib.getDocument({ url: session.signedUrl, withCredentials: true });
        const doc = await loadingTask.promise;
        if (!active) {
          void loadingTask.destroy();
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        const resumePage = detail.readerState?.progress?.currentPage || 1;
        setCurrentPage(Math.min(Math.max(1, resumePage), doc.numPages));
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          setAccessDenied(true);
          setErrorMsg(err.message);
        } else {
          setErrorMsg(err instanceof Error ? err.message : t('errorLoading'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();
    return () => {
      active = false;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [bookId, t]);

  // Render active page on canvas
  const renderPage = useCallback(
    async (isCancelled: () => boolean) => {
      if (!pdfDoc || !canvasRef.current || !canvasWrapperRef.current) return;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      try {
        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled() || !canvasRef.current || !canvasWrapperRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const wrapperWidth = Math.max(260, canvasWrapperRef.current.clientWidth - 24);
        const wrapperHeight = Math.max(360, window.innerHeight - 160);

        let computedScale = scale;
        if (fitMode === 'width') {
          computedScale = Math.min(2.2, wrapperWidth / baseViewport.width);
        } else if (fitMode === 'page') {
          computedScale = Math.min(wrapperWidth / baseViewport.width, wrapperHeight / baseViewport.height);
        }

        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: computedScale });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const task = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err) {
        if (isCancelled()) return;
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : t('errorLoading'));
      }
    },
    [pdfDoc, currentPage, scale, fitMode, t]
  );

  useEffect(() => {
    let cancelled = false;
    void renderPage(() => cancelled);
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [renderPage]);

  // Save reading progress whenever page changes
  useEffect(() => {
    if (!user || !book || !pdfDoc) return;
    const timer = setTimeout(() => {
      void apiFetch(`/api/reader/${book.id}/progress`, {
        method: 'PUT',
        body: JSON.stringify({ currentPage, totalPages: numPages }),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [user, book, pdfDoc, currentPage, numPages]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!pdfDoc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const isRtl = document.documentElement.dir === 'rtl';
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentPage((p) => (isRtl ? Math.max(1, p - 1) : Math.min(numPages, p + 1)));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentPage((p) => (isRtl ? Math.min(numPages, p + 1) : Math.max(1, p - 1)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pdfDoc, numPages]);

  const handleJumpToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const target = Number.parseInt(pageInput, 10);
    if (Number.isFinite(target)) {
      const clamped = Math.min(Math.max(1, target), numPages);
      setCurrentPage(clamped);
      setPageInput(String(clamped));
    } else {
      setPageInput(String(currentPage));
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setPanelError(null);
    if (!pdfDoc || !searchTerm.trim()) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    try {
      const term = searchTerm.trim().toLowerCase();
      const hits: Array<{ page: number; snippet: string }> = [];
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        const page = await pdfDoc.getPage(p);
        const textContent = await page.getTextContent();
        const joined = textContent.items
          .map((it) => ('str' in it ? it.str : ''))
          .join(' ');
        const idx = joined.toLowerCase().indexOf(term);
        if (idx >= 0) {
          const start = Math.max(0, idx - 35);
          const end = Math.min(joined.length, idx + term.length + 55);
          hits.push({ page: p, snippet: `...${joined.slice(start, end)}...` });
        }
      }
      setSearchHits(hits);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : t('errorLoading'));
    } finally {
      setSearching(false);
    }
  };

  const handleAddBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !book) return;
    setPanelError(null);
    try {
      const res = await apiFetch<{ bookmarks: Bookmark[] }>(`/api/reader/${book.id}/bookmarks`, {
        method: 'POST',
        body: JSON.stringify({ pageNumber: currentPage, label: bookmarkNote.trim() || `Page ${currentPage}` }),
      });
      setBookmarks(res.bookmarks);
      setBookmarkNote('');
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Unable to save bookmark');
    }
  };

  const handleDeleteBookmark = async (id: string) => {
    if (!user || !book) return;
    setPanelError(null);
    try {
      const res = await apiFetch<{ bookmarks: Bookmark[] }>(`/api/reader/${book.id}/bookmarks/${id}`, {
        method: 'DELETE',
      });
      setBookmarks(res.bookmarks);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Unable to delete bookmark');
    }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen rejection if blocked by browser
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E1DCC5] dark:bg-slate-950 text-sm text-slate-600 dark:text-slate-400">
        {t('loading')}
      </div>
    );
  }

  if (accessDenied) {
    return (
      <>
        <SeoHead title={`${t('readerAccessDenied')} – ${t('brandName')}`} description={t('readerAccessDeniedDesc')} noIndex />
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full p-8 rounded-md bg-white dark:bg-slate-900 border border-[#D4CEB8] dark:border-slate-800 space-y-5 text-center shadow-xs">
            <Lock className="w-10 h-10 mx-auto text-[#02598B] dark:text-sky-400" />
            <h1 className="text-2xl font-semibold text-[#02598B] dark:text-sky-400">{t('readerAccessDenied')}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">{errorMsg || t('readerAccessDeniedDesc')}</p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              {book && (
                <Link
                  to={user ? `/checkout?bookId=${book.id}` : `/login?next=${encodeURIComponent(`/books/${book.slug}`)}`}
                  className="px-5 py-2.5 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950"
                >
                  {user ? t('buyNow') : t('signInBtn')}
                </Link>
              )}
              <Link
                to={book ? `/books/${book.slug}` : '/catalog'}
                className="px-5 py-2.5 text-sm font-medium rounded border border-[#D4CEB8] dark:border-slate-700 hover:bg-[#F3F0E6] dark:hover:bg-slate-800"
              >
                {t('readerBack')}
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (errorMsg || !book || !pdfDoc) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4 p-8 rounded-md bg-white dark:bg-slate-900 border border-[#D4CEB8] dark:border-slate-800">
          <p className="text-sm text-red-600">{errorMsg || t('errorLoading')}</p>
          <Link to="/catalog" className="text-sm text-[#0376B8] dark:text-sky-400 underline">
            {t('navCatalog')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-h-screen flex flex-col bg-[#E1DCC5] dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <SeoHead title={`${book.title} – Reader`} description={book.title} noIndex />

      {/* Reader Toolbar */}
      <header className="sticky top-0 z-30 border-b border-[#CFC8AC] dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-2.5 sm:px-6 h-14 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Link
            to={`/books/${book.slug}`}
            className="inline-flex items-center justify-center sm:justify-start gap-1.5 min-w-9 min-h-9 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white shrink-0"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            <span className="hidden sm:inline">{t('readerBack')}</span>
          </Link>
          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">|</span>
          <h1 className="font-display text-sm sm:text-lg font-semibold truncate">{book.title}</h1>
        </div>

        {/* Desktop Page Navigation (Mobile uses bottom thumb-zone bar) */}
        <form onSubmit={handleJumpToPage} className="hidden sm:flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <span className="text-xs font-mono-tabular whitespace-nowrap">{t('readerPage')}</span>
          <input
            type="number"
            min={1}
            max={numPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={handleJumpToPage}
            aria-label={t('readerJumpPage')}
            className="w-14 h-7 px-1.5 text-center text-xs font-mono-tabular rounded border border-[#D4CEB8] dark:border-slate-700 bg-transparent"
          />
          <span className="text-xs font-mono-tabular whitespace-nowrap">
            {t('readerOf')} {numPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= numPages}
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            aria-label="Next page"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </form>

        {/* Zoom, Fit, Search, Bookmarks, Theme, Fullscreen */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setFitMode('custom');
              setScale((s) => Math.max(0.6, Number((s - 0.15).toFixed(2))));
            }}
            aria-label={t('readerZoomOut')}
            className="hidden md:inline-flex p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('custom');
              setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))));
            }}
            aria-label={t('readerZoomIn')}
            className="hidden md:inline-flex p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setFitMode((m) => (m === 'width' ? 'page' : 'width'))}
            className="hidden lg:inline-flex px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {fitMode === 'width' ? t('readerFitPage') : t('readerFitWidth')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen((v) => !v);
              setBookmarkOpen(false);
            }}
            aria-label={t('searchAction')}
            className={`min-w-9 min-h-9 flex items-center justify-center rounded ${searchOpen ? 'bg-[#0376B8] text-white dark:bg-sky-500 dark:text-slate-950' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          >
            <Search className="w-4 h-4" />
          </button>
          {user && (
            <button
              type="button"
              onClick={() => {
                setBookmarkOpen((v) => !v);
                setSearchOpen(false);
              }}
              aria-label={t('readerBookmarks')}
              className={`min-w-9 min-h-9 flex items-center justify-center rounded ${bookmarkOpen ? 'bg-[#0376B8] text-white dark:bg-sky-500 dark:text-slate-950' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <BookmarkIcon className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={t('readerFullscreen')}
            className="hidden sm:inline-flex p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative min-w-0">
        {/* PDF Canvas Viewport */}
        <div ref={canvasWrapperRef} className="flex-1 min-w-0 overflow-auto py-3 px-2 sm:py-6 sm:px-4 flex justify-center">
          <div className="bg-white shadow-md border border-[#D4CEB8] dark:border-slate-700 h-fit max-w-full overflow-x-auto">
            <canvas ref={canvasRef} className="block max-w-full" />
          </div>
        </div>

        {/* Search Drawer (Overlay on mobile, side panel on desktop) */}
        {searchOpen && (
          <aside className="fixed inset-x-0 bottom-0 top-14 sm:static sm:inset-auto sm:w-80 z-40 border-s border-[#D4CEB8] dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#02598B] dark:text-sky-400">{t('searchAction')}</h2>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label={t('cancelBtn')}
                className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 sm:hidden"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('readerSearchPlaceholder')}
                className="flex-1 min-w-0 min-h-[40px] px-2.5 py-1.5 text-xs rounded border border-[#D4CEB8] dark:border-slate-700 bg-transparent"
              />
              <button
                type="submit"
                disabled={searching}
                className="min-h-[40px] px-3 py-1.5 text-xs font-medium rounded bg-[#0376B8] text-white dark:bg-sky-500 dark:text-slate-950 shrink-0"
              >
                {t('searchAction')}
              </button>
            </form>
            {panelError && <p className="text-xs text-red-600 dark:text-red-400">{panelError}</p>}
            <div className="space-y-2">
              {searchHits.map((hit, idx) => (
                <button
                  key={`${hit.page}-${idx}`}
                  type="button"
                  onClick={() => {
                    setCurrentPage(hit.page);
                    if (window.innerWidth < 640) setSearchOpen(false);
                  }}
                  className="w-full text-start p-2.5 rounded border border-[#E5E0CE] dark:border-slate-800 hover:bg-[#F3F0E6] dark:hover:bg-slate-800/70 space-y-1"
                >
                  <div className="text-xs font-mono-tabular font-semibold text-[#02598B] dark:text-sky-400">
                    {t('readerPage')} {hit.page}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{hit.snippet}</div>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Bookmarks Drawer (Overlay on mobile, side panel on desktop) */}
        {bookmarkOpen && user && (
          <aside className="fixed inset-x-0 bottom-0 top-14 sm:static sm:inset-auto sm:w-80 z-40 border-s border-[#D4CEB8] dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#02598B] dark:text-sky-400">{t('readerBookmarks')}</h2>
              <button
                type="button"
                onClick={() => setBookmarkOpen(false)}
                aria-label={t('cancelBtn')}
                className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 sm:hidden"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddBookmark} className="space-y-2">
              <input
                type="text"
                value={bookmarkNote}
                onChange={(e) => setBookmarkNote(e.target.value)}
                placeholder={t('readerBookmarkNote')}
                className="w-full min-h-[40px] px-2.5 py-1.5 text-xs rounded border border-[#D4CEB8] dark:border-slate-700 bg-transparent"
              />
              <button
                type="submit"
                className="w-full min-h-[40px] py-1.5 text-xs font-medium rounded bg-[#0376B8] text-white dark:bg-sky-500 dark:text-slate-950"
              >
                {t('readerAddBookmark')} ({currentPage})
              </button>
            </form>
            {panelError && <p className="text-xs text-red-600 dark:text-red-400">{panelError}</p>}
            <div className="space-y-2">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="p-2.5 rounded border border-[#E5E0CE] dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPage(bm.pageNumber);
                      if (window.innerWidth < 640) setBookmarkOpen(false);
                    }}
                    className="text-start flex-1 min-w-0"
                  >
                    <div className="text-xs font-mono-tabular font-semibold text-[#02598B] dark:text-sky-400">
                      {t('readerPage')} {bm.pageNumber}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 truncate">{bm.label}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteBookmark(bm.id)}
                    aria-label="Delete bookmark"
                    className="min-w-9 min-h-9 flex items-center justify-center text-slate-400 hover:text-red-600 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* Compact Mobile Thumb-Zone Bottom Page/Zoom Controls */}
      <footer className="sm:hidden sticky bottom-0 z-30 h-12 border-t border-[#CFC8AC] dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setFitMode('custom');
              setScale((s) => Math.max(0.6, Number((s - 0.15).toFixed(2))));
            }}
            aria-label={t('readerZoomOut')}
            className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('custom');
              setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))));
            }}
            aria-label={t('readerZoomIn')}
            className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleJumpToPage} className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
            className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <input
            type="number"
            min={1}
            max={numPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={handleJumpToPage}
            aria-label={t('readerJumpPage')}
            className="w-12 h-7 px-1 text-center text-xs font-mono-tabular rounded border border-[#D4CEB8] dark:border-slate-700 bg-transparent"
          />
          <span className="text-xs font-mono-tabular whitespace-nowrap">/ {numPages}</span>
          <button
            type="button"
            disabled={currentPage >= numPages}
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            aria-label="Next page"
            className="min-w-9 min-h-9 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </form>
      </footer>
    </div>
  );
};
