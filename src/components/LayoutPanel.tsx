"use client";

import { createContext, useEffect, useRef, useState } from 'react';

export const PanelFullscreenContext = createContext(false);

interface PanelProps {
  title: string;
  children: React.ReactNode;
  panelId: string;
  guide?: string;
  className?: string;
  style?: React.CSSProperties;
  visible?: boolean;
  collapsed?: boolean;
  onToggleVisibility?: () => void;
  onToggleCollapse?: () => void;
  onFullscreen?: () => void;
}

export default function Panel({
  title,
  children,
  panelId,
  guide,
  className,
  style,
  visible = true,
  collapsed = false,
  onToggleVisibility,
  onToggleCollapse,
  onFullscreen
}: PanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [shouldRenderContent, setShouldRenderContent] = useState(false);

  useEffect(() => {
    if (!visible || collapsed || shouldRenderContent || typeof window === 'undefined') {
      return;
    }

    const node = panelRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRenderContent(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '300px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed, shouldRenderContent, visible]);

  useEffect(() => {
    if (isModalOpen) {
      setShouldRenderContent(true);
    }
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen || typeof document === 'undefined') {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const effectiveCollapsed = collapsed && !isModalOpen;

  useEffect(() => {
    if (!shouldRenderContent || effectiveCollapsed || typeof window === 'undefined') {
      return;
    }

    const node = panelRef.current;
    const contentNode = contentRef.current;

    if (!node || !contentNode) {
      return;
    }

    let animationFrame = 0;
    let secondAnimationFrame = 0;

    const forceRelayout = () => {
      void node.offsetHeight;
      window.dispatchEvent(new Event('resize'));
    };

    animationFrame = window.requestAnimationFrame(() => {
      secondAnimationFrame = window.requestAnimationFrame(forceRelayout);
    });

    const observer = new ResizeObserver(() => {
      forceRelayout();
    });

    observer.observe(contentNode);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(secondAnimationFrame);
      observer.disconnect();
    };
  }, [effectiveCollapsed, isModalOpen, shouldRenderContent]);

  const toggleFullscreen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsModalOpen(open => {
      if (!open) {
        onFullscreen?.();
      }
      return !open;
    });
  };

  if (!visible) return null;

  return (
     <>
      {isModalOpen && (
        <div
          className="fixed inset-0 z-[9998] bg-[#0b1220]/95 animate-in fade-in duration-200"
          onClick={() => setIsModalOpen(false)}
        />
      )}
       <div
         ref={panelRef}
         className={`bg-[#111827] p-4 rounded-xl shadow-lg border border-[#374151] flex flex-col transition-all duration-300 ${
           isModalOpen
             ? 'fixed left-1/2 top-1/2 z-[9999] max-h-[90vh] w-[min(85vw,1920px)] -translate-x-1/2 -translate-y-1/2 animate-in zoom-in-95 duration-200'
             : 'h-full'
         } ${className || ''}`}
         style={{ ...(isModalOpen ? {} : { minHeight: effectiveCollapsed ? 'auto' : '500px' }), ...style }}
       >
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#e5e7eb] uppercase tracking-wider truncate pr-2">
            {isModalOpen ? `${title} Fullscreen` : title}
          </h3>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onToggleCollapse && !isModalOpen && (
              <button
                onClick={onToggleCollapse}
                className="p-1.5 text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#374151] rounded transition-colors"
                title={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                )}
              </button>
            )}
            {onToggleVisibility && (
              <button
                onClick={onToggleVisibility}
                className="p-1.5 text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#374151] rounded transition-colors"
                title="Toggle Visibility"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#374151] rounded transition-colors"
              title={isModalOpen ? 'Close Fullscreen' : 'View Fullscreen'}
            >
              {isModalOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              )}
            </button>
          </div>
        </div>

        {!effectiveCollapsed && guide && (
          <div className="mb-4 rounded-lg border border-[#243041] bg-[#0b1220] px-3 py-2 text-xs leading-5 text-[#9fb0c6]">
            <span className="mr-2 font-semibold uppercase tracking-[0.18em] text-[#60a5fa]">Guide</span>
            {guide}
          </div>
        )}
        
        <div ref={contentRef} className={`flex-1 min-h-0 ${isModalOpen ? 'overflow-auto' : 'overflow-hidden'} ${effectiveCollapsed ? 'hidden' : ''}`}>
          {shouldRenderContent || isModalOpen ? (
            <PanelFullscreenContext.Provider value={isModalOpen}>
              {children}
            </PanelFullscreenContext.Provider>
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[#243041] bg-[#0b1220]/50 px-4 text-center text-sm text-[#6b7280]">
              Panel content will load as you scroll.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
