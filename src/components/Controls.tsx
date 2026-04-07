"use client";

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useTimeStore } from '@/store/timeStore';

interface ControlsProps {
  windowSize: number;
  onWindowSizeChange: (size: number) => void;
  minDate: string;
  maxDate: string;
}

export default function Controls({
  windowSize,
  onWindowSizeChange,
  minDate,
  maxDate,
}: ControlsProps) {
  const windowPresets = [180, 365, 730];
  const refetchData = useStore((state) => state.refetchData);
  const lastUpdated = useStore((state) => state.lastUpdated);
  const [isRefetching, setIsRefetching] = useState(false);
  
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

  const formatLastUpdated = () => {
    if (!lastUpdated) return 'Never';
    const date = new Date(lastUpdated);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const handleRefetch = async () => {
    setIsRefetching(true);
    await refetchData();
    setIsRefetching(false);
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

  return (
    <div className="flex flex-col gap-6 h-full text-gray-900">
      <section className="flex flex-col gap-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Data Settings</h3>
        
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Window Size (days)</label>
          <p className="rounded-lg border border-[#374151] bg-[#0b1220]/60 px-3 py-2 text-xs leading-relaxed text-[#9ca3af]">
            Use shorter windows to make the diagnostics more sensitive to recent directional changes. Use longer windows to smooth short-term noise and emphasize slower structural drift.
          </p>
          
          <div className="flex flex-col gap-2">
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
      </section>

      <section className="flex flex-col gap-4 pt-4 border-t border-gray-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Date Range</h3>

        <div className="grid grid-cols-1 gap-3">
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
      </section>

      <section className="flex flex-col gap-4 pt-4 border-t border-gray-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Data Updates</h3>
        
        <button
          onClick={handleRefetch}
          disabled={isRefetching}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            isRefetching
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
          }`}
        >
          {isRefetching ? (
            <>
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Refetching...
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
      </section>

      <section className="flex flex-col gap-4 pt-4 border-t border-gray-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Time Lock</h3>
        
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={timeLockEnabled}
              onChange={(e) => setTimeLock(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
              Lock Time Range
            </span>
            <span className="text-xs text-gray-500">
              Synchronize zoom across all time-based charts
            </span>
          </div>
        </label>
        
        {timeLockEnabled && (
          <button
            onClick={handleResetTimeRange}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-red-600 text-white hover:bg-red-700 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset Time Window
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3 pt-4 border-t border-gray-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Sources</h3>
        <div className="rounded-xl border border-[#374151] bg-[#0b1220]/60 px-3 py-3 text-xs leading-relaxed text-[#9ca3af]">
          <p>
            <span className="font-semibold text-white">IERS EOP</span>
            {' '}polar motion and Earth orientation data.
          </p>
          <p>
            <span className="font-semibold text-white">GFZ Kp</span>
            {' '}geomagnetic activity indices and dipole-strength proxy context.
          </p>
          <p>
            <span className="font-semibold text-white">GRACE / GRACE-FO</span>
            {' '}mass-distribution context and derived structural products.
          </p>
        </div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">
          Version v1.1b
        </p>
      </section>
    </div>
  );
}
