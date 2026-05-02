"use client";

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useTimeStore } from '@/store/timeStore';

interface ControlsProps {
  windowSize: number;
  onWindowSizeChange: (size: number) => void;
  minDate: string;
  maxDate: string;
  dataPointCount: number;
}

interface SidebarSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}

function SidebarSection({ title, open, onToggle, children, className = '' }: SidebarSectionProps) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between rounded-lg border border-[#374151] bg-[#0b1220]/40 px-3 py-2 text-left transition-colors hover:border-[#60a5fa]"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</span>
        <span className="text-[#9ca3af]">
          {open ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          )}
        </span>
      </button>
      {open && children}
    </section>
  );
}

export default function Controls({
  windowSize,
  onWindowSizeChange,
  minDate,
  maxDate,
  dataPointCount,
}: ControlsProps) {
  const sourceLinks = [
    {
      name: 'IERS EOP',
      description: 'polar motion and Earth orientation data.',
      href: 'https://datacenter.iers.org/productMetadata.php?id=221',
    },
    {
      name: 'GFZ Kp',
      description: 'geomagnetic activity indices and dipole-strength proxy context.',
      href: 'https://kp.gfz-potsdam.de/en/data',
    },
    {
      name: 'GRACE / GRACE-FO',
      description: 'mass-distribution context and derived structural products.',
      href: 'https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4',
    },
    {
      name: 'JPL DE442',
      description: 'Earth-geocentric planetary ephemerides used for overlay comparisons and torque-screening context.',
      href: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/',
    },
    {
      name: 'Framework Paper',
      description: 'constraint-first interpretation basis for the dashboard.',
      href: 'https://www.academia.edu/165465085/Earth_Fixed_Geometric_Structure_Bistable_Dynamics_and_Phase_Locked_Planetary_Torque_Coupling_in_Polar_Motion',
    },
  ];

  const windowPresets = [180, 365, 730];
  const refetchData = useStore((state) => state.refetchData);
  const lastUpdated = useStore((state) => state.lastUpdated);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState({
    currentState: true,
    dataSettings: true,
    dateRange: true,
  });
  
  const { timeRange, timeLockEnabled, setTimeLock, setTimeRange } = useTimeStore();
  const [startDate, setStartDate] = useState(minDate);
  const [endDate, setEndDate] = useState(maxDate);

  useEffect(() => {
    setStartDate(minDate);
    setEndDate(maxDate);
  }, [minDate, maxDate]);

  useEffect(() => {
    if (!timeRange) {
      setStartDate(minDate);
      setEndDate(maxDate);
      return;
    }

    setStartDate(new Date(timeRange[0]).toISOString().slice(0, 10));
    setEndDate(new Date(timeRange[1]).toISOString().slice(0, 10));
  }, [timeRange, minDate, maxDate]);

  const normalizedStart = startDate || minDate;
  const normalizedEnd = endDate || maxDate;
  const selectedRangeDays = Math.max(
    1,
    Math.round(
      (new Date(`${normalizedEnd}T00:00:00Z`).getTime() - new Date(`${normalizedStart}T00:00:00Z`).getTime()) /
        86400000
    ) + 1
  );
  const rangeLabel = timeRange ? 'Locked range' : 'Full record';

  const formatLastUpdated = () => {
    if (!lastUpdated) return 'Never';
    const date = new Date(lastUpdated);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const handleUpdateData = async () => {
    setIsUpdating(true);
    setUpdateMessage(null);
    setUpdateError(null);

    try {
      const response = await fetch('/api/update-data', {
        method: 'POST',
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'Data update failed.');
      }

      await refetchData();
      setUpdateMessage('Data files updated and dashboard reloaded.');
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Data update failed.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleResetTimeRange = () => {
    setTimeRange(null);
    setStartDate(minDate);
    setEndDate(maxDate);
  };

  const applyDateRange = () => {
    const start = new Date(`${normalizedStart}T00:00:00Z`).getTime();
    const end = new Date(`${normalizedEnd}T23:59:59Z`).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }

    setTimeLock(true);
    setTimeRange(start <= end ? [start, end] : [end, start]);
  };

  const toggleSection = (key: keyof typeof sectionOpen) => {
    setSectionOpen((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  return (
    <div className="shrink-0 space-y-5 text-gray-900">
      <SidebarSection title="Current State" open={sectionOpen.currentState} onToggle={() => toggleSection('currentState')}>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9ca3af]">Window</p>
            <p className="mt-1 text-sm font-semibold text-white">{windowSize} days</p>
          </div>
          <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9ca3af]">Points</p>
            <p className="mt-1 text-sm font-semibold text-white">{dataPointCount.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9ca3af]">{rangeLabel}</p>
            <p className="mt-1 text-sm font-semibold text-white">{selectedRangeDays.toLocaleString()} days</p>
          </div>
          <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9ca3af]">Latest sample</p>
            <p className="mt-1 text-sm font-semibold text-white">{maxDate}</p>
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Data Settings" open={sectionOpen.dataSettings} onToggle={() => toggleSection('dataSettings')}>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Window Size (days)</label>
          <p className="rounded-lg border border-[#374151] bg-[#0b1220]/60 px-3 py-2 text-xs leading-relaxed text-[#9ca3af]">
            Use shorter windows to make the diagnostics more sensitive to recent directional changes. Use longer windows to smooth short-term noise and emphasize slower structural drift.
          </p>
          
          <div className="grid grid-cols-3 gap-2">
            {windowPresets.map(preset => (
              <button
                key={preset}
                onClick={() => onWindowSizeChange(preset)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                  windowSize === preset 
                    ? 'bg-blue-600 text-white shadow-sm' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {preset}d
              </button>
            ))}
          </div>
          
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">Custom: {windowSize}d</span>
          </div>
          <input
            type="range"
            min="365"
            max="3650"
            step="365"
            value={windowSize}
            onChange={(e) => onWindowSizeChange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Date Range" open={sectionOpen.dateRange} onToggle={() => toggleSection('dateRange')} className="pt-4 border-t border-gray-200">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Start</span>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={normalizedStart}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">End</span>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={normalizedEnd}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={applyDateRange}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Apply Range
          </button>
          <button
            onClick={handleResetTimeRange}
            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300"
          >
            Full Record
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Chart zoom updates this range, and enabling time lock synchronizes the selected window across time-based panels.
        </p>
        <p className="text-xs text-gray-500">
          Update Data runs the local refresh pipeline and skips upstream retrievals while cached source files are still fresh.
        </p>

        <button
          onClick={handleUpdateData}
          disabled={isUpdating}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            isUpdating
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
          }`}
        >
          {isUpdating ? (
            <>
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Updating...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Update Data
            </>
          )}
        </button>
        
        <p className="text-xs text-gray-500">
          Last updated: {formatLastUpdated()}
        </p>
        {(updateMessage || updateError) && (
          <p className={`text-xs ${updateError ? 'text-red-400' : 'text-green-400'}`}>
            {updateError || updateMessage}
          </p>
        )}
        <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer group">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-white transition-colors">
                Time Lock
              </span>
              <span className="text-xs text-[#9ca3af]">
                Synchronize zoom across time-based charts
              </span>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={timeLockEnabled}
                onChange={(e) => setTimeLock(e.target.checked)}
                className="sr-only peer"
              />
              <div className="h-6 w-11 rounded-full bg-gray-200 peer-focus:outline-none peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-['']" />
            </div>
          </label>
        </div>

        {timeLockEnabled && (
          <button
            onClick={handleResetTimeRange}
            className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-700 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset Time Window
          </button>
        )}
      </SidebarSection>

      <div className="border-t border-gray-200 pt-4">
        <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3 text-xs leading-relaxed text-[#9ca3af]">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">Sources</p>
          <div className="flex flex-col gap-3">
            {sourceLinks.map((source) => (
              <p key={source.name}>
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-white underline decoration-[#60a5fa]/50 underline-offset-2 transition-colors hover:text-[#93c5fd]"
                >
                  {source.name}
                </a>
                {' '}{source.description}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
