'use client';

import { useContext } from 'react';
import { PanelFullscreenContext } from '@/components/LayoutPanel';

export function usePlotDisplayHeight(baseHeight: number, fullscreenHeight: number) {
  const isFullscreen = useContext(PanelFullscreenContext);
  return isFullscreen ? fullscreenHeight : baseHeight;
}
