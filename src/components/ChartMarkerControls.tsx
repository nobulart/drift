"use client";

import { MARKER_EMOJI_OPTIONS } from '@/lib/chartMarkers';
import { useStore } from '@/store/useStore';

interface ChartMarkerControlsProps {
  minDate: string;
  maxDate: string;
  compact?: boolean;
}

export default function ChartMarkerControls({ minDate, maxDate, compact = false }: ChartMarkerControlsProps) {
  const chartMarkers = useStore((state) => state.chartMarkers);
  const selectedMarkerEmoji = useStore((state) => state.selectedMarkerEmoji);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const setSelectedMarkerEmoji = useStore((state) => state.setSelectedMarkerEmoji);
  const setMarkerPlacementEnabled = useStore((state) => state.setMarkerPlacementEnabled);
  const updateChartMarker = useStore((state) => state.updateChartMarker);
  const deleteChartMarker = useStore((state) => state.deleteChartMarker);
  const clearChartMarkers = useStore((state) => state.clearChartMarkers);

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
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Marker emoji</p>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Saved markers</p>
          <button
            type="button"
            onClick={clearChartMarkers}
            disabled={chartMarkers.length === 0}
            className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#ef4444] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
        {chartMarkers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#374151] px-3 py-2 text-xs text-[#9ca3af]">
            Enable click-to-add, then click a timeline chart. Right-click near a marker to delete it.
          </p>
        ) : (
          <div className={`${compact ? 'max-h-56' : 'max-h-72'} space-y-2 overflow-y-auto pr-1`}>
            {chartMarkers.map((marker) => (
              <div key={marker.id} className="rounded-lg border border-[#1f2937] bg-[#111827] p-2">
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
                    value={marker.date}
                    min={minDate}
                    max={maxDate}
                    onChange={(event) => updateChartMarker(marker.id, { date: event.target.value })}
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
                  value={marker.label || ''}
                  onChange={(event) => updateChartMarker(marker.id, { label: event.target.value })}
                  placeholder="Optional label"
                  className="mt-2 w-full rounded-md border border-[#374151] bg-[#0b1220] px-2 py-2 text-xs text-white placeholder:text-[#6b7280]"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
