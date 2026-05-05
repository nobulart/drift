"use client";

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';

interface EOPData {
  t: string;
  xp: number;
  yp: number;
}

export default function EOPDataLoader({ onDataLoaded }: { onDataLoaded: (data: EOPData[]) => void }) {
  const [data, setData] = useState<EOPData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eopDataset = useStore((state) => state.eopDataset);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/eop?dataset=${eopDataset}`);
        if (!response.ok) {
          throw new Error('Failed to fetch EOP data');
        }
        const json = await response.json();
        setData(json);
        onDataLoaded(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Error loading EOP data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [eopDataset, onDataLoaded]);

  if (loading) return <div className="p-4">Loading EOP data...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (data.length === 0) return <div className="p-4">No data available</div>;

  return null;
}
