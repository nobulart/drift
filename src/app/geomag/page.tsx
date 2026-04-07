"use client";

import { useEffect, useState } from 'react';

export default function GeomagPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/geomag');
        const data = await response.json();
        setData(data);
      } catch (err) {
        console.error('Error loading geomag data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) return <div className="p-4">Loading geomagnetic data...</div>;
  if (data.length === 0) return <div className="p-4">No geomagnetic data available</div>;

  const kpValues = data.map((d) => d.kp).filter((k): k is number => typeof k === 'number');
  const apValues = data.map((d) => d.ap).filter((a): a is number => typeof a === 'number');

  const kpStats = {
    min: Math.min(...kpValues),
    max: Math.max(...kpValues),
    mean: kpValues.reduce((a, b) => a + b, 0) / kpValues.length
  };

  const apStats = {
    min: Math.min(...apValues),
    max: Math.max(...apValues),
    mean: apValues.reduce((a, b) => a + b, 0) / apValues.length
  };

  return (
    <div className="p-4">
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <h1 className="text-2xl font-bold mb-2">GFZ-KP Geomagnetic Indices</h1>
        <p className="text-gray-600 mb-4">
          Geomagnetic activity indices from GFZ German Research Centre for Geosciences.
          Kp index measures global geomagnetic activity (0-9), ap is the equivalent amplitude.
        </p>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-blue-50 p-3 rounded">
            <div className="text-sm text-gray-600">Time Range</div>
            <div className="font-semibold">{data[0].t} to {data[data.length - 1].t}</div>
          </div>
          <div className="bg-green-50 p-3 rounded">
            <div className="text-sm text-gray-600">Records</div>
            <div className="font-semibold">{data.length} 3-hourly</div>
          </div>
          <div className="bg-purple-50 p-3 rounded">
            <div className="text-sm text-gray-600">Source</div>
            <div className="font-semibold">GFZ KP Index</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-blue-100 p-4 rounded">
            <h3 className="font-semibold text-blue-800 mb-2">Kp Index Stats</h3>
            <div>Min: {kpStats.min.toFixed(2)}</div>
            <div>Max: {kpStats.max.toFixed(2)}</div>
            <div>Mean: {kpStats.mean.toFixed(2)}</div>
          </div>
          <div className="bg-green-100 p-4 rounded">
            <h3 className="font-semibold text-green-800 mb-2">ap Index Stats</h3>
            <div>Min: {apStats.min.toFixed(2)}</div>
            <div>Max: {apStats.max.toFixed(2)}</div>
            <div>Mean: {apStats.mean.toFixed(2)}</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Kp</th>
                <th className="p-2 text-left">ap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.slice(-30).map((d, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="p-2">{d.t}</td>
                  <td className="p-2">{d.kp !== undefined ? d.kp.toFixed(3) : '-'}</td>
                  <td className="p-2">{d.ap !== undefined ? d.ap : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
