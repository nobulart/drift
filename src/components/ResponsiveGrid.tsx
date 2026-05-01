"use client";

import { useState, useEffect, useMemo, ReactNode, isValidElement, cloneElement } from 'react';

interface PanelLayout {
  [key: string]: {
    rowSpan?: number;
    colSpan?: number;
    className?: string;
  };
}

interface ResponsiveGridProps {
  children: ReactNode;
}

export default function ResponsiveGrid({ 
  children
}: ResponsiveGridProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isUHD, setIsUHD] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      const uhd = window.innerWidth >= 1920;
      setIsMobile(mobile);
      setIsUHD(uhd);
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const gridTemplate = useMemo(() => {
    if (isMobile) {
      return 'grid-cols-1';
    }
    if (isUHD) {
      return 'grid-cols-3';
    }
    return 'grid-cols-2';
  }, [isMobile, isUHD]);

  const panelLayout = useMemo(() => {
    if (isMobile) {
      return {
        phaseEscape: { colSpan: 1 },
        forecast: { colSpan: 1 },
        sphere: { colSpan: 1 },
        polar: { colSpan: 1 },
        drift: { colSpan: 1 },
        angle: { colSpan: 1 },
        coupling: { colSpan: 1 },
        phase: { colSpan: 1 },
        phaseDiag: { colSpan: 1 },
        ortho: { colSpan: 1 },
        overlay: { colSpan: 1 },
        lagModel: { colSpan: 1 },
        conditionalLag: { colSpan: 1 },
      } as PanelLayout;
    }
    if (isUHD) {
      return {
        phaseEscape: { colSpan: 3 },
        forecast: { colSpan: 1 },
        sphere: { colSpan: 2 },
        polar: { colSpan: 1 },
        drift: { colSpan: 1 },
        angle: { colSpan: 1 },
        coupling: { colSpan: 1 },
        phase: { colSpan: 1 },
        phaseDiag: { colSpan: 1 },
        ortho: { colSpan: 1 },
        overlay: { colSpan: 2 },
        lagModel: { colSpan: 1 },
        conditionalLag: { colSpan: 1 },
      } as PanelLayout;
    }
    return {
      phaseEscape: { colSpan: 2 },
      forecast: { colSpan: 2 },
      sphere: { colSpan: 2 },
      polar: { colSpan: 1 },
      drift: { colSpan: 1 },
      angle: { colSpan: 1 },
      coupling: { colSpan: 1 },
      phase: { colSpan: 1 },
      phaseDiag: { colSpan: 1 },
      ortho: { colSpan: 1 },
      overlay: { colSpan: 2 },
      lagModel: { colSpan: 1 },
      conditionalLag: { colSpan: 1 },
    } as PanelLayout;
  }, [isMobile, isUHD]);

  const renderChildren = () => {
    const result: ReactNode[] = [];
    (children as ReactNode[]).forEach((child, index) => {
      if (isValidElement(child)) {
        const panelId = child.props.panelId;
        const additionalProps = panelLayout[panelId] || {};
        
        result.push(cloneElement(child, {
          key: panelId || index,
          ...child.props,
          className: `${child.props.className || ''} ${additionalProps.className || ''}`.trim(),
          style: {
            ...(child.props.style || {}),
            gridRow: additionalProps.rowSpan ? `span ${String(additionalProps.rowSpan)}` : undefined,
            gridColumn: additionalProps.colSpan ? `span ${String(additionalProps.colSpan)}` : undefined
          }
        }));
      } else if (child) {
        const key = typeof child === 'object' && child !== null && 'props' in child && 'panelId' in (child as any).props 
          ? (child as any).props.panelId 
          : index;
        result.push(<div key={key}>{child}</div>);
      }
    });
    return result;
  };

  return (
    <div 
      className={`grid ${gridTemplate} auto-rows-max gap-6 content-start w-full`}
      style={{ 
        width: '100%'
      }}
    >
      {renderChildren()}
    </div>
  );
}
