"use client";

import { useEffect, useRef, useState } from 'react';

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

interface PlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function PlotModal({ isOpen, onClose, children }: PlotModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-[#0b1220]/95 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-6xl max-h-[90vh] flex flex-col bg-[#111827] rounded-xl shadow-2xl border border-[#374151] animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-[#374151]">
          <h3 className="text-lg font-bold text-[#e5e7eb] uppercase tracking-wider">
            Fullscreen View
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#374151] rounded-lg transition-colors"
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
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
    if (!shouldRenderContent || collapsed || typeof window === 'undefined') {
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
  }, [collapsed, shouldRenderContent]);

  const toggleFullscreen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsModalOpen(true);
  };

  const closeFullscreen = () => {
    setIsModalOpen(false);
  };

  if (!visible) return null;

  return (
     <>
       <div
         ref={panelRef}
         className={`bg-[#111827] p-4 rounded-xl shadow-lg border border-[#374151] flex flex-col transition-all duration-300 h-full ${className || ''}`}
         style={{ minHeight: collapsed ? 'auto' : '500px', ...style }}
       >
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 className="text-sm font-bold text-[#e5e7eb] uppercase tracking-wider truncate pr-2">
            {title}
          </h3>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onToggleCollapse && (
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
              title="View Fullscreen"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            </button>
          </div>
        </div>

        {!collapsed && guide && (
          <div className="mb-4 rounded-lg border border-[#243041] bg-[#0b1220] px-3 py-2 text-xs leading-5 text-[#9fb0c6]">
            <span className="mr-2 font-semibold uppercase tracking-[0.18em] text-[#60a5fa]">Guide</span>
            {guide}
          </div>
        )}
        
        <div ref={contentRef} className={`flex-1 overflow-hidden ${collapsed ? 'hidden' : ''}`}>
          {shouldRenderContent || isModalOpen ? (
            children
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-[#243041] bg-[#0b1220]/50 px-4 text-center text-sm text-[#6b7280]">
              Panel content will load as you scroll.
            </div>
          )}
        </div>
      </div>
      <PlotModal isOpen={isModalOpen} onClose={closeFullscreen}>
        {children}
      </PlotModal>
    </>
  );
}
