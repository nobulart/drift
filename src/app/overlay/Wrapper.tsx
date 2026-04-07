"use client";

import dynamic from 'next/dynamic';

export default dynamic(() => import('./OverlayPlot'), {
  ssr: false,
  loading: () => <div className="p-6">Loading...</div>
});
