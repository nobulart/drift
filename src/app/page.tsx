"use client";

import { useEffect, useState, useRef, ReactNode, useMemo, isValidElement, cloneElement } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useStore } from '@/store/useStore';
import { loadEOPData, loadGeomagGFZData, loadGRACEData, loadInertiaData, mergeDataSources } from '@/lib/dataLoader';
import { PANEL_GUIDES } from '@/lib/documentation';
import { TimeSample } from '@/lib/types';
import { PANEL_OPTIONS } from '@/lib/panels';
import { resetOverlaySignals } from '@/lib/overlayPreferences';

const Controls = dynamic(() => import('@/components/Controls'), { ssr: false });
const PolarPlot = dynamic(() => import('@/components/PolarPlot'), { ssr: false });
const DriftDirectionPlot = dynamic(() => import('@/components/DriftDirectionPlot'), { ssr: false });
const SphereView = dynamic(() => import('@/components/SphereView'), { ssr: false });
const PhasePortrait = dynamic(() => import('@/components/PhasePortrait'), { ssr: false });
const ResidualPolarMotionPlot = dynamic(() => import('@/components/ResidualPolarMotionPlot'), { ssr: false });
const PolarMotionTrajectoryPlot = dynamic(() => import('@/components/PolarMotionTrajectoryPlot'), { ssr: false });
const LoopCenterAngularVelocityPlot = dynamic(() => import('@/components/LoopCenterAngularVelocityPlot'), { ssr: false });
const ThetaOmegaPlots = dynamic(() => import('@/components/ThetaOmegaPlots'), { ssr: false });
const OrthogonalDeviationPlot = dynamic(() => import('@/components/OrthogonalDeviationPlot'), { ssr: false });
const OverlayPlot = dynamic(() => import('@/components/OverlayPlot'), { ssr: false });
const LagModelPlot = dynamic(() => import('@/components/LagModelPlot'), { ssr: false });
const ConditionalLagPlot = dynamic(() => import('@/components/ConditionalLagPlot'), { ssr: false });
const TransitionForecastPanel = dynamic(() => import('@/components/TransitionForecastPanel'), { ssr: false });
const PhaseEscapeModelPanel = dynamic(() => import('@/components/PhaseEscapeModelPanel'), { ssr: false });
const ResponsiveGrid = dynamic(() => import('@/components/ResponsiveGrid'), { ssr: false });
const Panel = dynamic(() => import('@/components/LayoutPanel'), { ssr: false });

const WELCOME_MODAL_STORAGE_KEY = 'drift.dashboard.welcomeAcknowledged.v1';
const SOURCE_PAPER_URL = 'https://www.academia.edu/165465085/Earth_Fixed_Geometric_Structure_Bistable_Dynamics_and_Phase_Locked_Planetary_Torque_Coupling_in_Polar_Motion';

function LoadingScreen({ progress }: { progress: number }) {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black px-6">
      <div className="relative w-full max-w-md rounded-3xl border border-cyan-500/20 bg-slate-950/90 p-8 shadow-[0_0_60px_rgba(34,211,238,0.08)]">
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_55%)]" />
        <div className="relative">
          <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.34em] text-cyan-300/80">
            <span>Initializing Drift</span>
            <span>{progress}%</span>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-500 transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mb-5 flex items-center justify-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-400" />
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400 [animation-delay:180ms]" />
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-400 [animation-delay:360ms]" />
          </div>
          <p className="text-center text-sm text-slate-300">
            Loading observational series, merging frames, and preparing diagnostics.
          </p>
        </div>
      </div>
    </div>
  );
}

function WelcomeModal({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[#020617]/85 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drift-welcome-title"
    >
      <div className="max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#334155] bg-[#0b1220] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="border-b border-[#1f2937] px-6 py-5 sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#60a5fa]">First visit context</p>
          <h2 id="drift-welcome-title" className="mt-2 text-2xl font-bold text-white">
            DRIFT Dashboard
          </h2>
        </div>
        <div className="space-y-4 px-6 py-6 text-sm leading-6 text-[#d1d5db] sm:px-8 sm:text-[15px]">
          <p>
            DRIFT is a live monitoring platform for Earth’s polar motion, the gradual movement of the planet’s rotation axis relative to its surface.
          </p>
          <p>
            Rather than attributing this motion to assumed causes, DRIFT adopts a different approach: it determines the geometric structure that the data itself necessitates. This results in a constraint-first perspective of a system that is surprisingly organised. It is confined to a low-dimensional shape in mathematical space with two preferred states and coupled fast and slow dynamics.
          </p>
          <p>
            The dashboard is updated daily from IERS Earth orientation data. Panels are arranged from most to least certain, beginning with geometric views and progressing to dynamical and planetary diagnostics.
          </p>
          <p>
            Some panels are marked experimental. These explore concepts that extend beyond the data’s current capacity to prove. They are included as honest scientific work-in-progress, not as forecasts or predictions.
          </p>
          <p>
            For the full scientific context, the source paper is available{' '}
            <a
              href={SOURCE_PAPER_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#93c5fd] underline decoration-[#60a5fa]/60 underline-offset-4 transition-colors hover:text-white"
            >
              here
            </a>
            .
          </p>
        </div>
        <div className="flex justify-end border-t border-[#1f2937] bg-[#111827]/65 px-6 py-4 sm:px-8">
          <button
            type="button"
            onClick={onAcknowledge}
            className="rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-[#0b1220]"
            autoFocus
          >
            Enter Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const defaultBasis = {
    e1: [1, 0, 0] as [number, number, number],
    e2: [0, 1, 0] as [number, number, number],
    e3: [0, 0, 1] as [number, number, number],
  };
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const sidebarOpen = true;
  const [rollingStatsLoaded, setRollingStatsLoaded] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    windowSize,
    frame,
    setWindowSize,
    togglePanelVisibility,
    togglePanelCollapse,
    hiddenPanels,
    collapsedPanels,
    rollingStats,
    panelOrder,
    movePanel,
    resetPanelPreferences,
  } = useStore();
  const data = useStore((state) => state.data as TimeSample[]);
  const [showDrift, setShowDrift] = useState(true);
  const [showE1, setShowE1] = useState(true);
  const [showE2, setShowE2] = useState(true);
  const [showE3, setShowE3] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      setShowWelcomeModal(window.localStorage.getItem(WELCOME_MODAL_STORAGE_KEY) !== 'true');
    } catch {
      setShowWelcomeModal(true);
    }
  }, []);

  const acknowledgeWelcomeModal = () => {
    try {
      window.localStorage.setItem(WELCOME_MODAL_STORAGE_KEY, 'true');
    } catch {
      // If storage is unavailable, still let the visitor enter this session.
    }

    setShowWelcomeModal(false);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [eopData, geomagData, graceData, inertiaData] = await Promise.all([
          loadEOPData(),
          loadGeomagGFZData(),
          loadGRACEData(),
          loadInertiaData()
        ]);

        const mergedData = mergeDataSources(eopData, geomagData, graceData, inertiaData);

        useStore.getState().setData(mergedData as TimeSample[]);
        useStore.setState({ lastUpdated: new Date().toISOString() });
        useStore.getState().computeDrift();
        await useStore.getState().computeRollingStats();
        setRollingStatsLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingProgress(100);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingProgress((current) => {
        if (current >= 92) {
          return current;
        }

        const next = current + Math.max(1, Math.round((96 - current) / 7));
        return Math.min(next, 92);
      });
    }, 180);

    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setSidebarVisible(window.innerWidth >= 768);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const xpData = data.map((d) => d.xp);
  const ypData = data.map((d) => d.yp);
  
  const driftAxis = useStore((state) => state.driftAxis);
  const driftAxisTimeSeries = useStore((state) => state.driftAxisTimeSeries);
  const currentSample: TimeSample = data[data.length - 1] || {
    t: new Date().toISOString().split('T')[0],
    xp: 0,
    yp: 0,
    kp: 0,
    ap: 0,
    e1: [1, 0, 0],
    e2: [0, 1, 0],
    e3: [0, 0, 1]
  };

  const datesStr = data.map((d) => d.t.slice(0, 10));

  if (loading) return <LoadingScreen progress={loadingProgress} />;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (data.length === 0) return <div className="p-4">No data available</div>;

  const panelMap: Record<string, ReactNode | null> = {
    forecast: (
      <Panel
        panelId="forecast"
        title="Transition Probability"
        guide={PANEL_GUIDES.forecast}
        experimental
        visible={!hiddenPanels.has('forecast')}
        collapsed={collapsedPanels.has('forecast')}
        onToggleVisibility={() => togglePanelVisibility('forecast')}
        onToggleCollapse={() => togglePanelCollapse('forecast')}
      >
        <TransitionForecastPanel />
      </Panel>
    ),
    phaseEscape: rollingStatsLoaded && rollingStats ? (
      <Panel
        panelId="phaseEscape"
        title="Phase-Locked Escape Model"
        guide={PANEL_GUIDES.phaseEscape}
        experimental
        visible={!hiddenPanels.has('phaseEscape')}
        collapsed={collapsedPanels.has('phaseEscape')}
        onToggleVisibility={() => togglePanelVisibility('phaseEscape')}
        onToggleCollapse={() => togglePanelCollapse('phaseEscape')}
      >
        <PhaseEscapeModelPanel />
      </Panel>
    ) : null,
    sphere: (
      <Panel
        panelId="sphere"
        title="3D Vector View"
        guide={PANEL_GUIDES.sphere}
        fullscreenAspect="square"
        visible={!hiddenPanels.has('sphere')}
        collapsed={collapsedPanels.has('sphere')}
        onToggleVisibility={() => togglePanelVisibility('sphere')}
        onToggleCollapse={() => togglePanelCollapse('sphere')}
      >
        <SphereView
          driftAxis={driftAxis}
          e1={currentSample.e1 ?? defaultBasis.e1}
          e2={currentSample.e2 ?? defaultBasis.e2}
          e3={currentSample.e3 ?? defaultBasis.e3}
          frame={frame}
          showDrift={showDrift}
          showE1={showE1}
          showE2={showE2}
          showE3={showE3}
          autoRotate={autoRotate}
        />
      </Panel>
    ),
    polar: (
      <Panel
        panelId="polar"
        title="Polar Motion (xp, yp)"
        guide={PANEL_GUIDES.polar}
        visible={!hiddenPanels.has('polar')}
        collapsed={collapsedPanels.has('polar')}
        onToggleVisibility={() => togglePanelVisibility('polar')}
        onToggleCollapse={() => togglePanelCollapse('polar')}
      >
        <div className="h-full w-full">
          <PolarPlot xpData={xpData} ypData={ypData} dates={datesStr} rollingStats={rollingStats} />
        </div>
      </Panel>
    ),
    residualPolar: (
      <Panel
        panelId="residualPolar"
        title="Residual Polar Motion (XY)"
        guide={PANEL_GUIDES.residualPolar}
        fullscreenAspect="square"
        visible={!hiddenPanels.has('residualPolar')}
        collapsed={collapsedPanels.has('residualPolar')}
        onToggleVisibility={() => togglePanelVisibility('residualPolar')}
        onToggleCollapse={() => togglePanelCollapse('residualPolar')}
      >
        <div className="h-full w-full">
          <ResidualPolarMotionPlot xpData={xpData} ypData={ypData} dates={datesStr} rollingStats={rollingStats} />
        </div>
      </Panel>
    ),
    polarTrajectory: (
      <Panel
        panelId="polarTrajectory"
        title="Polar Motion Trajectory"
        guide={PANEL_GUIDES.polarTrajectory}
        fullscreenAspect="square"
        visible={!hiddenPanels.has('polarTrajectory')}
        collapsed={collapsedPanels.has('polarTrajectory')}
        onToggleVisibility={() => togglePanelVisibility('polarTrajectory')}
        onToggleCollapse={() => togglePanelCollapse('polarTrajectory')}
      >
        <div className="h-full w-full">
          <PolarMotionTrajectoryPlot xpData={xpData} ypData={ypData} dates={datesStr} rollingStats={rollingStats} />
        </div>
      </Panel>
    ),
    loopAngularVelocity: (
      <Panel
        panelId="loopAngularVelocity"
        title="Loop-Center Angular Velocity"
        guide={PANEL_GUIDES.loopAngularVelocity}
        visible={!hiddenPanels.has('loopAngularVelocity')}
        collapsed={collapsedPanels.has('loopAngularVelocity')}
        onToggleVisibility={() => togglePanelVisibility('loopAngularVelocity')}
        onToggleCollapse={() => togglePanelCollapse('loopAngularVelocity')}
      >
        <LoopCenterAngularVelocityPlot xpData={xpData} ypData={ypData} dates={datesStr} />
      </Panel>
    ),
    drift: (
      <Panel
        panelId="drift"
        title="Drift Direction"
        guide={PANEL_GUIDES.drift}
        visible={!hiddenPanels.has('drift')}
        collapsed={collapsedPanels.has('drift')}
        onToggleVisibility={() => togglePanelVisibility('drift')}
        onToggleCollapse={() => togglePanelCollapse('drift')}
      >
        <DriftDirectionPlot dates={datesStr} driftAxisTimeSeries={driftAxisTimeSeries} e1={currentSample.e1 ?? defaultBasis.e1} e2={currentSample.e2 ?? defaultBasis.e2} windowSize={windowSize} />
      </Panel>
    ),
    phase: rollingStatsLoaded && rollingStats ? (
      <Panel
        panelId="phase"
        title="Phase Portrait"
        guide={PANEL_GUIDES.phase}
        visible={!hiddenPanels.has('phase')}
        collapsed={collapsedPanels.has('phase')}
        onToggleVisibility={() => togglePanelVisibility('phase')}
        onToggleCollapse={() => togglePanelCollapse('phase')}
      >
        <PhasePortrait dates={datesStr} theta={rollingStats.theta || []} omega={rollingStats.omega || []} turningPoints={rollingStats.turningPoints} />
      </Panel>
    ) : null,
    phaseDiag: rollingStatsLoaded && rollingStats ? (
      <Panel
        panelId="phaseDiag"
        title="Phase Diagnostics: θ(t) and ω(t)"
        guide={PANEL_GUIDES.phaseDiag}
        visible={!hiddenPanels.has('phaseDiag')}
        collapsed={collapsedPanels.has('phaseDiag')}
        onToggleVisibility={() => togglePanelVisibility('phaseDiag')}
        onToggleCollapse={() => togglePanelCollapse('phaseDiag')}
      >
        <ThetaOmegaPlots dates={datesStr} theta={rollingStats.theta || []} omega={rollingStats.omega || []} turningPoints={rollingStats.turningPoints} />
      </Panel>
    ) : null,
    ortho: rollingStatsLoaded && rollingStats ? (
      <Panel
        panelId="ortho"
        title="R(t): Orthogonal Deviation Ratio"
        guide={PANEL_GUIDES.ortho}
        visible={!hiddenPanels.has('ortho')}
        collapsed={collapsedPanels.has('ortho')}
        onToggleVisibility={() => togglePanelVisibility('ortho')}
        onToggleCollapse={() => togglePanelCollapse('ortho')}
      >
        <OrthogonalDeviationPlot dates={datesStr} rRatio={rollingStats.rRatio || []} turningPoints={rollingStats.turningPoints} windowSize={windowSize} />
      </Panel>
    ) : null,
    overlay: (
      <Panel
        panelId="overlay"
        title="Overlay Plot"
        guide={PANEL_GUIDES.overlay}
        visible={!hiddenPanels.has('overlay')}
        collapsed={collapsedPanels.has('overlay')}
        onToggleVisibility={() => togglePanelVisibility('overlay')}
        onToggleCollapse={() => togglePanelCollapse('overlay')}
      >
        <OverlayPlot />
      </Panel>
    ),
    lagModel: (
      <Panel
        panelId="lagModel"
        title="Lag Model"
        guide={PANEL_GUIDES.lagModel}
        visible={!hiddenPanels.has('lagModel')}
        collapsed={collapsedPanels.has('lagModel')}
        onToggleVisibility={() => togglePanelVisibility('lagModel')}
        onToggleCollapse={() => togglePanelCollapse('lagModel')}
      >
        <LagModelPlot />
      </Panel>
    ),
    conditionalLag: (
      <Panel
        panelId="conditionalLag"
        title="Conditional Lag Response"
        guide={PANEL_GUIDES.conditionalLag}
        visible={!hiddenPanels.has('conditionalLag')}
        collapsed={collapsedPanels.has('conditionalLag')}
        onToggleVisibility={() => togglePanelVisibility('conditionalLag')}
        onToggleCollapse={() => togglePanelCollapse('conditionalLag')}
      >
        <ConditionalLagPlot />
      </Panel>
    ),
  };

  const orderedPanels = panelOrder
    .map((id) => {
      const panel = panelMap[id];
      return isValidElement(panel) ? cloneElement(panel, { key: id }) : panel;
    })
    .filter(Boolean);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b1220] text-[#e5e7eb]">
      {showWelcomeModal && <WelcomeModal onAcknowledge={acknowledgeWelcomeModal} />}
      <div className={`bg-[#111827] border-r border-[#374151] flex flex-col h-full transition-all duration-300 overflow-hidden ${sidebarOpen && sidebarVisible ? 'w-72 opacity-100' : 'w-0 opacity-0 border-none'}`}>
        <div className="p-6 border-b border-[#374151] bg-[#0b1220]/50 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-[#3b82f6]">DRIFT Dashboard</h1>
              <p className="text-xs text-[#9ca3af] uppercase tracking-widest font-medium">
                Polar Motion Geometry and Context
              </p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#cbd5e1]">
                Version v1.5.1
              </p>
            </div>
            <Link
              href="/docs"
              className="rounded-lg border border-[#374151] bg-[#111827] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cbd5e1] transition-colors hover:border-[#60a5fa] hover:text-white"
            >
              Docs
            </Link>
          </div>
        </div>
        <div className="h-full overflow-y-auto p-6">
           <Controls
             windowSize={windowSize}
             onWindowSizeChange={setWindowSize}
             minDate={datesStr[0]}
             maxDate={datesStr[datesStr.length - 1]}
             dataPointCount={data.length}
           />
           <div className="mt-6 shrink-0 border-t border-[#374151] pt-6">
             <button
               type="button"
               onClick={() => setPanelsOpen((open) => !open)}
               className="flex items-center justify-between rounded-lg border border-[#374151] bg-[#0b1220]/40 px-3 py-2 text-left transition-colors hover:border-[#60a5fa]"
             >
               <span className="text-xs font-bold uppercase tracking-wider text-[#9ca3af]">Panels</span>
               <span className="text-[#9ca3af]">
                 {panelsOpen ? (
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                 ) : (
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                 )}
               </span>
             </button>
             {panelsOpen && (
               <>
                 <div className="mb-3 mt-3 flex items-center justify-end gap-3">
                   <button
                     onClick={() => {
                       resetPanelPreferences();
                       resetOverlaySignals();
                     }}
                     className="rounded-md border border-[#374151] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9ca3af] transition-colors hover:border-[#60a5fa] hover:text-white"
                   >
                     Reset Defaults
                   </button>
                 </div>
                 <div className="space-y-2 pr-2 pb-6">
                   {PANEL_OPTIONS.map((option) => {
                     const orderIndex = panelOrder.indexOf(option.id);
                     return (
                       <div key={option.id} className="rounded-lg border border-[#1f2937] bg-[#0b1220]/60 px-3 py-2">
                         <div className="flex items-center gap-2">
                           <input
                             type="checkbox"
                             checked={!hiddenPanels.has(option.id)}
                             onChange={() => togglePanelVisibility(option.id)}
                             className="h-4 w-4 rounded border-gray-500 text-blue-600 focus:ring-blue-500"
                           />
                           <span className="flex-1 text-sm text-gray-300">{option.label}</span>
                           <span className="text-[10px] text-[#6b7280]">{orderIndex + 1}</span>
                           <div className="ml-1 flex items-center gap-1">
                           <button
                             onClick={() => movePanel(option.id, 'up')}
                             disabled={orderIndex <= 0}
                             className="rounded p-1 text-[#9ca3af] transition-colors hover:bg-[#1f2937] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                             aria-label={`Move ${option.label} up`}
                           >
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                           </button>
                           <button
                             onClick={() => movePanel(option.id, 'down')}
                             disabled={orderIndex === -1 || orderIndex >= panelOrder.length - 1}
                             className="rounded p-1 text-[#9ca3af] transition-colors hover:bg-[#1f2937] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                             aria-label={`Move ${option.label} down`}
                           >
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                           </button>
                           </div>
                         </div>
                       </div>
                     );
                   })}
                 </div>
               </>
             )}
           </div>
         </div>
       </div>

      <main className="flex-1 h-full overflow-y-auto p-6 bg-[#0b1220]" ref={containerRef}>
        <ResponsiveGrid>
          {orderedPanels}
        </ResponsiveGrid>
      </main>
    </div>
  );
}
