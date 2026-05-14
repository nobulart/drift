"use client";

import { memo, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { MARKER_EMOJI_OPTIONS } from '@/lib/chartMarkers';
import { ChartMarker, useStore } from '@/store/useStore';

interface ChartMarkerControlsProps {
  minDate: string;
  maxDate: string;
  compact?: boolean;
}

interface ChartMarkerRowProps {
  marker: ChartMarker;
  minDate: string;
  maxDate: string;
  updateChartMarker: (id: string, updates: Partial<Pick<ChartMarker, 'date' | 'emoji' | 'label'>>) => void;
  deleteChartMarker: (id: string) => void;
}

interface PendingMarkerImport {
  markers: unknown[];
  source: string;
}

function extractMarkerArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { chartMarkers?: unknown; markers?: unknown };
  if (Array.isArray(candidate.chartMarkers)) {
    return candidate.chartMarkers;
  }

  if (Array.isArray(candidate.markers)) {
    return candidate.markers;
  }

  return null;
}

function markerDate(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const date = (value as { date?: unknown }).date;
  return typeof date === 'string' && date ? date : null;
}

const ChartMarkerRow = memo(function ChartMarkerRow({
  marker,
  minDate,
  maxDate,
  updateChartMarker,
  deleteChartMarker,
}: ChartMarkerRowProps) {
  const [draftDate, setDraftDate] = useState(marker.date);
  const [draftLabel, setDraftLabel] = useState(marker.label || '');

  useEffect(() => {
    setDraftDate(marker.date);
    setDraftLabel(marker.label || '');
  }, [marker.date, marker.label]);

  const commitDate = () => {
    if (draftDate && draftDate !== marker.date) {
      updateChartMarker(marker.id, { date: draftDate });
    }
  };

  const commitLabel = () => {
    const nextLabel = draftLabel.trim();
    if (nextLabel !== (marker.label || '')) {
      updateChartMarker(marker.id, { label: nextLabel || undefined });
    }
  };

  const handleCommitKey = (event: KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (event.key === 'Enter') {
      commit();
      event.currentTarget.blur();
    }
  };

  return (
    <div className="rounded-lg border border-[#1f2937] bg-[#111827] p-2">
      <div className="flex items-center gap-2">
        <select
          value={marker.emoji}
          onChange={(event) => updateChartMarker(marker.id, { emoji: event.target.value })}
          className="h-9 rounded-md border border-[#374151] bg-[#0b1220] px-2 text-base text-white"
          aria-label="Marker emoji"
        >
          {MARKER_EMOJI_OPTIONS.map((emoji) => (
            <option key={emoji} value={emoji}>{emoji}</option>
          ))}
        </select>
        <input
          type="date"
          value={draftDate}
          min={minDate}
          max={maxDate}
          onChange={(event) => setDraftDate(event.target.value)}
          onBlur={commitDate}
          onKeyDown={(event) => handleCommitKey(event, commitDate)}
          className="min-w-0 flex-1 rounded-md border border-[#374151] bg-[#0b1220] px-2 py-2 text-xs text-white"
        />
        <button
          type="button"
          onClick={() => deleteChartMarker(marker.id)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-[#374151] text-[#fca5a5] transition-colors hover:border-[#ef4444] hover:bg-[#7f1d1d]/30 hover:text-white"
          aria-label={`Delete marker on ${marker.date}`}
          title="Delete marker"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        value={draftLabel}
        onChange={(event) => setDraftLabel(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => handleCommitKey(event, commitLabel)}
        placeholder="Optional label"
        className="mt-2 w-full rounded-md border border-[#374151] bg-[#0b1220] px-2 py-2 text-xs text-white placeholder:text-[#6b7280]"
      />
    </div>
  );
});

export default function ChartMarkerControls({ minDate, maxDate, compact = false }: ChartMarkerControlsProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const chartMarkers = useStore((state) => state.chartMarkers);
  const selectedMarkerEmoji = useStore((state) => state.selectedMarkerEmoji);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const chartMarkerSize = useStore((state) => state.chartMarkerSize);
  const visibleMarkerEmojis = useStore((state) => state.visibleMarkerEmojis);
  const setSelectedMarkerEmoji = useStore((state) => state.setSelectedMarkerEmoji);
  const setMarkerPlacementEnabled = useStore((state) => state.setMarkerPlacementEnabled);
  const setChartMarkerSize = useStore((state) => state.setChartMarkerSize);
  const toggleMarkerCategoryVisibility = useStore((state) => state.toggleMarkerCategoryVisibility);
  const setVisibleMarkerEmojis = useStore((state) => state.setVisibleMarkerEmojis);
  const updateChartMarker = useStore((state) => state.updateChartMarker);
  const setChartMarkers = useStore((state) => state.setChartMarkers);
  const deleteChartMarker = useStore((state) => state.deleteChartMarker);
  const clearChartMarkers = useStore((state) => state.clearChartMarkers);
  const [fileStatus, setFileStatus] = useState('');
  const [pendingMarkerImport, setPendingMarkerImport] = useState<PendingMarkerImport | null>(null);

  const handleSaveMarkers = () => {
    const payload = {
      schema: 'drift-chart-markers-v1',
      exportedAt: new Date().toISOString(),
      chartMarkers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drift-markers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFileStatus(`Saved ${chartMarkers.length} marker${chartMarkers.length === 1 ? '' : 's'}.`);
  };

  const handleLoadMarkers = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const markerSource = extractMarkerArray(parsed);

      if (!markerSource) {
        throw new Error('Marker JSON must contain a chartMarkers array.');
      }

      setPendingMarkerImport({
        markers: markerSource,
        source: file.name || 'selected JSON file',
      });
    } catch {
      setFileStatus('Could not load marker JSON.');
    }
  };

  const handleDefaultMarkers = async () => {
    try {
      const response = await fetch('/api/markers', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Default markers request failed.');
      }

      const markerSource = extractMarkerArray(await response.json());
      if (!markerSource) {
        throw new Error('Default marker payload is invalid.');
      }

      setPendingMarkerImport({
        markers: markerSource,
        source: 'data/markers.json',
      });
    } catch {
      setFileStatus('Could not load default markers.');
    }
  };

  const replacePendingMarkers = () => {
    if (!pendingMarkerImport) {
      return;
    }

    setChartMarkers(pendingMarkerImport.markers);
    setFileStatus(`Loaded ${pendingMarkerImport.markers.length} marker${pendingMarkerImport.markers.length === 1 ? '' : 's'}.`);
    setPendingMarkerImport(null);
  };

  const mergePendingMarkers = () => {
    if (!pendingMarkerImport) {
      return;
    }

    const existingDates = new Set(chartMarkers.map((marker) => marker.date));
    const missingMarkers = pendingMarkerImport.markers.filter((marker) => {
      const date = markerDate(marker);
      if (!date || existingDates.has(date)) {
        return false;
      }
      existingDates.add(date);
      return true;
    });
    setChartMarkers([...chartMarkers, ...missingMarkers]);
    setFileStatus(`Merged ${missingMarkers.length} marker${missingMarkers.length === 1 ? '' : 's'}.`);
    setPendingMarkerImport(null);
  };

  return (
    <div className={`${compact ? 'space-y-2' : 'space-y-3 rounded-xl border border-[#374151] bg-[#0b1220]/60 p-3'} text-[#d1d5db]`}>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Click to add</span>
        <input
          type="checkbox"
          checked={markerPlacementEnabled}
          onChange={(event) => setMarkerPlacementEnabled(event.target.checked)}
          className="h-4 w-4 rounded border-gray-500 text-blue-600 focus:ring-blue-500"
        />
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Marker emoji</p>
          <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af]">
            Size
            <select
              value={chartMarkerSize}
              onChange={(event) => setChartMarkerSize(Number(event.target.value))}
              className="h-7 rounded-md border border-[#374151] bg-[#111827] px-2 text-xs text-white"
            >
              {[14, 16, 18, 20, 24, 28].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        <div className={`grid gap-2 ${compact ? 'grid-cols-8 sm:grid-cols-4' : 'grid-cols-4'}`}>
          {MARKER_EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setSelectedMarkerEmoji(emoji)}
              className={`flex h-10 items-center justify-center rounded-lg border text-lg transition-colors ${
                selectedMarkerEmoji === emoji
                  ? 'border-[#facc15] bg-[#facc15]/15'
                  : 'border-[#374151] bg-[#111827] hover:border-[#60a5fa]'
              }`}
              aria-label={`Use ${emoji} marker`}
              title={`Use ${emoji} marker`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Visible categories</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVisibleMarkerEmojis([...MARKER_EMOJI_OPTIONS])}
              className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#60a5fa] hover:text-white"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setVisibleMarkerEmojis([])}
              className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#60a5fa] hover:text-white"
            >
              None
            </button>
          </div>
        </div>
        <div className={`grid gap-2 ${compact ? 'grid-cols-8 sm:grid-cols-4' : 'grid-cols-4'}`}>
          {MARKER_EMOJI_OPTIONS.map((emoji) => {
            const visible = visibleMarkerEmojis.includes(emoji);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleMarkerCategoryVisibility(emoji)}
                className={`flex h-9 items-center justify-center rounded-lg border text-lg transition-colors ${
                  visible
                    ? 'border-[#38bdf8] bg-[#0ea5e9]/15 text-white'
                    : 'border-[#1f2937] bg-[#111827] text-[#6b7280] hover:border-[#60a5fa] hover:text-white'
                }`}
                aria-pressed={visible}
                aria-label={`${visible ? 'Hide' : 'Show'} ${emoji} markers`}
                title={`${visible ? 'Hide' : 'Show'} ${emoji} markers`}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Saved markers</p>
          <div className="flex flex-wrap items-center gap-1">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleLoadMarkers}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleDefaultMarkers}
              className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#60a5fa] hover:text-white"
            >
              Default
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#60a5fa] hover:text-white"
            >
              Load
            </button>
            <button
              type="button"
              onClick={handleSaveMarkers}
              disabled={chartMarkers.length === 0}
              className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#60a5fa] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={clearChartMarkers}
              disabled={chartMarkers.length === 0}
              className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#ef4444] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
        {fileStatus && (
          <p className="rounded-md border border-[#1f2937] bg-[#111827] px-2 py-1 text-[11px] text-[#9ca3af]">
            {fileStatus}
          </p>
        )}
        {chartMarkers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#374151] px-3 py-2 text-xs text-[#9ca3af]">
            Enable click-to-add, then click a timeline chart. Right-click near a marker to delete it.
          </p>
        ) : (
          <div className={`${compact ? 'max-h-56' : 'max-h-72'} space-y-2 overflow-y-auto pr-1`}>
            {chartMarkers.map((marker) => (
              <ChartMarkerRow
                key={marker.id}
                marker={marker}
                minDate={minDate}
                maxDate={maxDate}
                updateChartMarker={updateChartMarker}
                deleteChartMarker={deleteChartMarker}
              />
            ))}
          </div>
        )}
      </div>
      {pendingMarkerImport && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-[#020617]/80 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-[#334155] bg-[#0b1220] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.55)]">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#e5e7eb]">Load markers</h3>
            <p className="mt-3 text-sm leading-6 text-[#cbd5e1]">
              Load {pendingMarkerImport.markers.length} marker{pendingMarkerImport.markers.length === 1 ? '' : 's'} from {pendingMarkerImport.source}?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingMarkerImport(null)}
                className="rounded-md border border-[#374151] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#9ca3af] transition-colors hover:border-[#94a3b8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={mergePendingMarkers}
                className="rounded-md border border-[#2563eb] bg-[#1d4ed8]/30 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#bfdbfe] transition-colors hover:border-[#60a5fa] hover:text-white"
              >
                Merge
              </button>
              <button
                type="button"
                onClick={replacePendingMarkers}
                className="rounded-md border border-[#f97316] bg-[#7c2d12]/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#fed7aa] transition-colors hover:border-[#fb923c] hover:text-white"
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
