import Link from 'next/link';
import {
  DOCS_LIMITATIONS,
  DOCS_OUTPUTS,
  DOCS_PANEL_GUIDES,
  DOCS_PRINCIPLES,
} from '@/lib/documentation';

const sourceRows = [
  {
    name: 'IERS EOP',
    cadence: 'Daily / rapid updates',
    latency: 'Typically 2-4 days for final values',
    role: 'Polar motion and Earth orientation baseline',
    href: 'https://datacenter.iers.org/productMetadata.php?id=221',
  },
  {
    name: 'JPL EOP2',
    cadence: 'Daily / rapid updates',
    latency: 'Updated with latest long and short EOP2 files',
    role: 'Selectable PMx/PMy Earth orientation backend converted from milliarcseconds to arcseconds',
    href: 'https://eop2-external.jpl.nasa.gov/eop2/latest_eop2.long',
  },
  {
    name: 'GFZ Kp',
    cadence: 'Sub-daily upstream, normalized daily in cache',
    latency: 'Usually under 1 hour upstream',
    role: 'Geomagnetic activity context and dipole-strength proxy',
    href: 'https://kp.gfz-potsdam.de/en/data',
  },
  {
    name: 'GRACE / GRACE-FO',
    cadence: 'Monthly',
    latency: 'About 1 month',
    role: 'Optional mass-distribution context when current real products are available',
    href: 'https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4',
  },
  {
    name: 'JPL DE442',
    cadence: 'Static kernel, pre-extracted to daily cache',
    latency: 'Local extraction artifact',
    role: 'Earth-geocentric planetary distance, angular velocity, longitude, and temporal-normalized Net torque overlays',
    href: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/',
  },
];

const sourcePaperHref =
  'https://www.academia.edu/165465085/Earth_Fixed_Geometric_Structure_Bistable_Dynamics_and_Phase_Locked_Planetary_Torque_Coupling_in_Polar_Motion';
const phaseStabilityPaperHref =
  'https://www.academia.edu/166976568/Phase_Stability_Diagnostics_for_Polar_Motion_State_Space_Analysis';

const pipelineSteps = [
  'Fetch upstream geodetic and geomagnetic source files only when local caches may be stale.',
  'Normalize and cache the source products into local JSON artifacts.',
  'Extract daily Earth-geocentric DE442 ephemeris overlays and refresh derived temporal-normalized Net torque rows.',
  'Aggregate GFZ geomagnetic inputs into dashboard-friendly daily records.',
  'Compute drift, rolling diagnostics, lag models, and transition-probability inputs.',
  'Serve combined artifacts through API routes and prebuilt data files.',
  'Render synchronized interactive panels in the browser.',
];

const apiRows = [
  {
    route: '/api/eop',
    purpose: 'Historical Earth Orientation Parameters cache. Optional `dataset` values: `finals` for finals.all IAU1980, `finals2000a` for finals.all IAU2000, `c04` for EOP 20u24 C04 IAU2000A, and `jpl` for JPL EOP2. Unknown or omitted values fall back to `finals`; the response header `X-DRIFT-EOP-Dataset` reports the resolved id.',
    fields: 't, xp, yp',
  },
  {
    route: '/api/inertia',
    purpose: 'Cached inertia-frame eigenvector time series when real inputs are available.',
    fields: 't, e1, e2, e3',
  },
  {
    route: '/api/grace',
    purpose: 'Cached GRACE / GRACE-FO mass-context series when real inputs are available.',
    fields: 't, lwe_mean, lwe_std',
  },
  {
    route: '/api/geomag',
    purpose: 'Normalized daily GFZ geomagnetic records.',
    fields: 't, kp, ap, cp, c9',
  },
  {
    route: '/api/geomag-gfz',
    purpose: 'Raw cached GFZ geomagnetic history.',
    fields: 't, kp, ap, cp, c9',
  },
  {
    route: '/api/combined',
    purpose: 'Lightweight merged EOP view with any currently available real auxiliary series.',
    fields: 't, xp, yp, grace_lwe_mean, grace_lwe_std',
  },
  {
    route: '/api/combined-full',
    purpose: 'Full combined dashboard dataset used by the app. Access is restricted to API key holders to prevent abuse.',
    fields: 't, xp, yp, geomagnetic context, GRACE context, inertia vectors when available',
  },
  {
    route: '/api/ephemeris',
    purpose: 'DE442 Earth-geocentric overlay cache for 1962-01-01 through 2050-12-31. Optional `start` and `end` query parameters return the requested slice and can populate missing cache dates or refresh missing Net rows on demand. Access is restricted to API key holders to prevent abuse.',
    fields: 'source metadata, records[].bodies[bodyKey].distance_au/angular_velocity_deg_per_day/radial_velocity_km_s/ecliptic_longitude_deg/torque_proxy; bodies.net.torque_proxy is a per-body peak-normalized temporal comparison sum',
  },
  {
    route: '/api/rolling-stats',
    purpose: 'On-demand or cached rolling diagnostics and lag models. Access is restricted to API key holders to prevent abuse.',
    fields: 'theta, omega, rRatio, turningPoints, lagModel, conditionalLagModel',
  },
  {
    route: '/api/phase-stability',
    purpose: 'Phase Stability diagnostics derived from the rolling theta-omega state. Access is restricted to API key holders to prevent abuse.',
    fields: 'samples, envelope, summary, Zω, curvatureNorm, manifoldDeparture, hysteresisIndex, analogueSimilarity, couplingStabilityIndex',
    experimental: true,
  },
  {
    route: '/api/transition-forecast',
    purpose: 'Experimental forward transition-probability summary derived from conditional lag structure.',
    fields: 'lags, P_tau, expected_time, peak_time, cumulative, probability summary',
    experimental: true,
  },
  {
    route: '/api/phase-escape',
    purpose: 'Phase-Locked Escape Model state built from internal DRIFT EOP state and DE442-derived composite phases. Access is restricted to API key holders to prevent abuse.',
    fields: 'thetaRaw, thetaResidual, rRatio, bodyPhases, composites, misalignment',
    experimental: true,
  },
  {
    route: '/api/update-data',
    purpose: 'Runs the timestamp-aware source refresh pipeline used by the sidebar Update Data button. Access is restricted to API key holders to prevent abuse.',
    fields: 'ok, completedAt, stdout, stderr, error',
  },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#0b1220] px-6 py-8 text-[#e5e7eb]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#60a5fa]">Documentation</p>
              <h1 className="mt-2 text-3xl font-bold text-white">DRIFT Dashboard Guide</h1>
              <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
                This in-app guide consolidates the dashboard white paper, data-system notes, source attributions, and panel interpretation guidance.
                It is meant to explain what the paper actually supports, how the data arrive in the app, and how to read the dashboard without over-claiming causation.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <span className="rounded-full border border-[#374151] bg-[#0b1220] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#cbd5e1]">
                Version v1.6.3
              </span>
              <Link
                href="/"
                className="rounded-full border border-[#374151] bg-[#0b1220] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#cbd5e1] transition-colors hover:border-[#60a5fa] hover:text-white"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">Purpose</h2>
            <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
              DRIFT is a constraint-first dashboard for reading polar motion as a low-dimensional, partly bistable dynamical system over the observed record.
              Its main job is to expose geometric structure, fast-slow behavior, and transition-like episodes in one place, while using geomagnetic series as
              comparison context rather than as a proved explanatory driver.
            </p>
            <div className="mt-4 flex flex-wrap gap-4">
              <a
                href={sourcePaperHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm font-semibold text-[#93c5fd] underline decoration-[#60a5fa]/50 underline-offset-2 transition-colors hover:text-white"
              >
                Source paper
              </a>
              <a
                href={phaseStabilityPaperHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm font-semibold text-[#93c5fd] underline decoration-[#60a5fa]/50 underline-offset-2 transition-colors hover:text-white"
              >
                Phase Stability paper
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">How to Read It</h2>
              <ol className="mt-3 space-y-3 text-sm leading-6 text-[#cbd5e1]">
                <li>1. Start with the 3D Vector View, Residual Polar Motion, and Polar Motion Trajectory to read the IERS frame consistently: x_pole negative left / positive right, and y_pole positive upward.</li>
                <li>2. Use Phase Portrait and Phase Diagnostics to inspect the fast cyclic structure and any bursts, slowdowns, or loop distortion.</li>
                <li>3. Compare the 3D view, overlays, and any available geomagnetic context for timing context, but keep causal interpretation conservative.</li>
                <li>4. Use the Phase-Locked Escape Model<sup className="ml-1 text-[10px] lowercase text-[#38bdf8]">experimental</sup> to inspect phase-conditioned escape probability, drift, curvature, barrier ratio, and comparative escape-energy diagnostics.</li>
                <li>5. Read Transition Probability<sup className="ml-1 text-[10px] lowercase text-[#38bdf8]">experimental</sup> last as an exploratory summary of whether the present state resembles earlier transition-like episodes.</li>
              </ol>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">Release Highlights</h2>
          {/* Keep this inline release-card list to the latest six versions. */}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-[#38bdf8]/50 bg-[#082f49]/30 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.6.3 Marker Filters</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Added selective display for all eight marker categories, made marker edits more responsive by deferring heavier chart redraw work, and hardened standalone/Docker startup so production serves assets and bundled data immediately.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.6.2 EOP Refresh Controls</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Shifted rapid-tail EOP merging into the full pipeline, documented forced full EOP refreshes, kept heavyweight alternate backfills on a weekly refresh cadence, and increased Overlay Plot title spacing.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.6.1 Phase Stability<sup className="ml-1 text-[10px] lowercase text-[#38bdf8]">experimental</sup></h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Added the PHASE STABILITY layer for manifold departure, phase-conditioned Zω, curvature, hysteresis, historical analogue similarity, and Coupling Stability Index. Docker TLS domains are now empty by default and must be configured explicitly.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.6.0 API Access Control</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                High-cost and mutating API routes can now be restricted to key holders, protecting the public instance from abusive requests while leaving local development open when no API key is configured.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.5.9 Default Markers</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                First-time visitors now start with the curated default marker set from data/markers.json. Marker file loads use the same merge, replace, or cancel confirmation as the default-marker control, while later visits keep each user&apos;s saved marker preferences.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.5.8 Palette Persistence</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Added a greyscale gradient to the heatmap palette set and shared the selector with residual polar-motion phase-space and polar-motion trajectory panels. Palette choices persist across sessions and reset cleanly with dashboard defaults.
              </p>
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">Core Principles</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {DOCS_PRINCIPLES.map((item) => (
              <article key={item.title} className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">Data Sources and Freshness</h2>
            <div className="mt-4 space-y-4">
              {sourceRows.map((row) => (
                <div key={row.name} className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-white underline decoration-[#60a5fa]/50 underline-offset-2 transition-colors hover:text-[#93c5fd]"
                    >
                      {row.name}
                    </a>
                    <span className="rounded-full border border-[#374151] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#9ca3af]">
                      {row.cadence}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{row.role}</p>
                  <p className="mt-2 text-xs text-[#9ca3af]">Typical latency: {row.latency}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">Pipeline and Caching</h2>
            <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
              DRIFT separates source retrieval from UI delivery. Raw or semi-processed source products are normalized into local JSON artifacts,
              mirrored for frontend access, and combined into cacheable outputs that API routes and panels can read consistently. The sidebar Update Data button runs the same retrieval script through a local API route; the script uses local file timestamps to avoid refetching sources that are still fresh. The current app intentionally avoids synthetic fallback values, so missing upstream products remain absent rather than being fabricated in the UI layer.
            </p>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-[#cbd5e1]">
              {pipelineSteps.map((step, index) => (
                <li key={step} className="rounded-xl border border-[#243041] bg-[#0b1220]/70 px-4 py-3">
                  <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1d4ed8] text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">API Endpoints</h2>
          <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
            These routes are the app&apos;s local JSON and analysis surface. Most of the data routes serve cached pipeline artifacts, while the analysis routes compute or reuse cached derived products on demand.
          </p>
          <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
            High-cost API access is restricted to key holders to prevent abuse of the public instance. Protected routes accept `Authorization: Bearer &lt;key&gt;` or `X-API-Key: &lt;key&gt;`.
          </p>
           <div className="mt-4 space-y-4">
             {apiRows.map((row) => (
               <article
                 key={row.route}
                 className={`rounded-xl border p-4 ${row.experimental ? 'border-[#38bdf8]/50 bg-[#082f49]/30' : 'border-[#243041] bg-[#0b1220]/70'}`}
               >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-sm font-semibold text-[#93c5fd]">{row.route}</code>
                  {row.experimental && (
                    <sup className="text-[10px] lowercase text-[#38bdf8]">experimental</sup>
                  )}
                </div>
                 <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{row.purpose}</p>
                 <p className="mt-2 text-xs leading-5 text-[#9ca3af]">Key fields: {row.fields}</p>
               </article>
             ))}
           </div>
          <div className="mt-4 rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4 text-sm leading-6 text-[#cbd5e1]">
            <p>Analysis query routes accept URL parameters.</p>
            <p className="mt-2 text-xs text-[#9ca3af]">
              `/api/eop` accepts `dataset=finals`, `dataset=finals2000a`, `dataset=c04`, or `dataset=jpl`.
            </p>
            <p className="mt-2 text-xs text-[#9ca3af]">
              `/api/ephemeris` accepts `start` and `end` in `YYYY-MM-DD` format and can extend the local DE442 cache for missing requested dates or refresh older records without Net rows.
            </p>
            <p className="mt-2 text-xs text-[#9ca3af]">
              `/api/rolling-stats` accepts `dataset`, `windowSize`, `turnThreshold`, `centerWindow`, `centerStep`, `danceWindow`, and `conditionalTargetState`.
            </p>
            <p className="mt-2 text-xs text-[#9ca3af]">
              `/api/phase-stability` accepts `dataset`, rolling-stat parameters, `recentDays`, `binCount`, `historicalStartDate`, `historicalEndDate`, and `view=full|panel`.
            </p>
            <p className="mt-2 text-xs text-[#9ca3af]">
              `/api/transition-forecast` accepts `currentState`, `theta`, `baseProb`, and `smoothSigma`.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">What the Dashboard Outputs</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {DOCS_OUTPUTS.map((item) => (
              <article key={item.title} className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">What the Paper Strongly Supports</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">Tier 1: Geometric invariants</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Low-dimensional confinement, near-planar organization, and a robust two-state structure are the most stable findings in the paper.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">Tier 2: Dynamical organization</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                The looping phase-space structure, slow drift of loop centers, and intermittent bursts support a fast-slow interpretation, but that layer is more interpretive than Tier 1.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">Tier 3: Directional features</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Absolute directionality and axis stability are present geometrically, but the paper says they are not statistically decisive against correlated-noise null models.
              </p>
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">Panel Guide Reference</h2>
          <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
            These are the live reading guides used across the dashboard. Experimental panels are marked with a cyan border and an experimental superscript.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {DOCS_PANEL_GUIDES.map((panel) => (
              <article
                key={panel.title}
                className={`rounded-xl border p-4 ${panel.experimental ? 'border-[#38bdf8]/50 bg-[#082f49]/30' : 'border-[#243041] bg-[#0b1220]/70'}`}
              >
                 <h3 className="text-sm font-semibold text-white flex items-center justify-between">
                   {panel.title}
                    {panel.experimental && (
                      <sup className="ml-auto text-[10px] lowercase text-[#38bdf8]">experimental</sup>
                    )}
                 </h3>
                <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{panel.guide}</p>
              </article>
            ))}
          </div>
        </section>

          <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
             <div className="rounded-2xl border border-[#38bdf8]/50 bg-[#082f49]/30 p-6">
               <h2 className="text-lg font-bold text-white flex items-center justify-between">
                 Transition Probability Model<sup className="ml-auto text-[10px] lowercase text-[#38bdf8]">experimental</sup>
               </h2>
            <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
              The transition-probability layer converts lag-conditioned response structure into a forward probability curve over days ahead. It combines the current state,
              phase-conditioned lag response, and a base transition probability into a normalized distribution. The most useful outputs are the expected time,
              peak time, and short-horizon cumulative probability, but they should be read as model-based summaries of historical structure rather than certified event predictions.
            </p>
            <div className="mt-4 rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4 text-sm leading-7 text-[#cbd5e1]">
              <p className="font-mono text-[#93c5fd]">P(shift at tau) = P0 x L(tau | current phase, selected state)</p>
              <p className="mt-3">
                Early peaks suggest the current state resembles earlier short-horizon transition episodes, later peaks imply a longer latent horizon, and flat responses indicate weaker transition-like structure in the recent calibration record.
              </p>
            </div>
          </div>

            <div className="rounded-2xl border border-[#38bdf8]/50 bg-[#082f49]/30 p-6">
              <h2 className="text-lg font-bold text-white flex items-center justify-between">
                Phase-Locked Escape Model<sup className="ml-auto text-[10px] lowercase text-[#38bdf8]">experimental</sup>
              </h2>
            <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
              The phase-locked escape layer compares the current DRIFT phase state with DE442-derived composite phase relationships. It reports residual phase misalignment, phase drift, local time-to-alignment, phase acceleration, curvature signal, barrier ratio, phase-well state, and a Kramers-like comparative index that uses R(t) as a noise proxy.
            </p>
            <div className="mt-4 rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4 text-sm leading-7 text-[#cbd5e1]">
              <p className="font-mono text-[#93c5fd]">E_phase = 0.5 omega_phi^2 + alpha(1 - cos(phi - phi0))</p>
              <p className="mt-3">
                Low barrier ratios and stable phase drift suggest the state remains inside a comparative phase basin; near-barrier or super-barrier readings flag episodes that deserve inspection alongside the geometric panels. These outputs are diagnostic coordinates, not deterministic planetary forcing claims.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#38bdf8]/50 bg-[#082f49]/30 p-6">
          <h2 className="text-lg font-bold text-white flex items-center justify-between">
            Phase Stability Diagnostics<sup className="ml-auto text-[10px] lowercase text-[#38bdf8]">experimental</sup>
          </h2>
          <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
            The <strong>Phase Stability</strong> panel quantifies whether the recent θ-ω trajectory remains inside the historically occupied phase-conditioned manifold, or whether it is behaving as an off-manifold excursion. It is a comparative state-space diagnostic, not a deterministic prediction and not a causal claim.
          </p>
          <a
            href={phaseStabilityPaperHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex text-sm font-semibold text-[#93c5fd] underline decoration-[#60a5fa]/50 underline-offset-2 transition-colors hover:text-white"
          >
            Published paper: Phase Stability Diagnostics for Polar Motion State-Space Analysis
          </a>
          <div className="mt-4 rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4 text-sm leading-7 text-[#cbd5e1]">
            <p>The panel should be read as a structured answer to one question:</p>
            <blockquote className="mt-3 border-l-2 border-[#38bdf8]/60 pl-4 text-[#e0f2fe]">
              Is the current polar-motion phase trajectory behaving like a normal member of the historical family, or is it occupying an unusual branch of state space?
            </blockquote>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">Core quantities</h3>
              <div className="mt-3 space-y-4 text-sm leading-7 text-[#cbd5e1]">
                <p>
                  <strong>Phase angle θ.</strong> The current position in phase space. This is not favorable or unfavorable by itself. It tells us where in the cycle the system is being evaluated.
                </p>
                <p>
                  <strong>Angular velocity ω.</strong> The current rate of motion through phase. It is interpreted relative to historical behavior at the same θ, not as an isolated value.
                </p>
                <div>
                  <p>
                    <strong>Zω: phase-conditioned angular-velocity anomaly.</strong> Measures how unusual the current ω is for the current θ:
                  </p>
                  <p className="mt-2 rounded-lg border border-[#1f2937] bg-[#020617] px-3 py-2 font-mono text-[#93c5fd]">
                    Zω = (ω - μω|θ) / σω|θ
                  </p>
                  <p className="mt-2">
                    Low |Zω| means the system is moving normally for its phase. High |Zω| means the system is moving unusually fast or slow relative to the historical corridor.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[#cbd5e1]">
                    <li>|Zω| &lt; 1.5: ordinary / stable</li>
                    <li>1.5 ≤ |Zω| &lt; 2.5: watch</li>
                    <li>2.5 ≤ |Zω| &lt; 3.5: excursion</li>
                    <li>|Zω| ≥ 3.5: strong escape-candidate behavior</li>
                  </ul>
                </div>
                <p>
                  <strong>Curvature κ.</strong> Measures how sharply the trajectory is bending in θ-ω space. Low curvature suggests the path is following a familiar branch. High curvature suggests rapid phase-space reorganization, recapture, or branch transition.
                </p>
                <div>
                  <p>
                    <strong>Manifold Departure.</strong> A normalized 0-1 score measuring how far the recent state lies from the historical phase-conditioned corridor. Low values mean the trajectory is inside or near the normal manifold. High values indicate strong off-manifold behavior.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[#cbd5e1]">
                    <li>0.00-0.25: inside historical manifold</li>
                    <li>0.25-0.50: mild displacement</li>
                    <li>0.50-0.75: significant excursion</li>
                    <li>0.75-1.00: strong off-manifold behavior</li>
                  </ul>
                </div>
              </div>
            </article>

            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">Similarity, hysteresis, and composite state</h3>
              <div className="mt-3 space-y-4 text-sm leading-7 text-[#cbd5e1]">
                <div>
                  <p>
                    <strong>Historical Analogue.</strong> Measures how closely the recent trajectory resembles prior historical windows. Unlike the other severity scores, higher is more favorable.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[#cbd5e1]">
                    <li>&gt;0.75: strong historical analogue</li>
                    <li>0.50-0.75: partial analogue</li>
                    <li>0.30-0.50: weak analogue</li>
                    <li>&lt;0.30: historically unusual or poorly classified</li>
                  </ul>
                  <p className="mt-2">
                    A low analogue score does not prove novelty in a physical sense; it means the current trajectory is not well matched by prior windows in the available record.
                  </p>
                </div>
                <p>
                  <strong>Hysteresis Index.</strong> Measures whether the trajectory returns through the same phase sector along a displaced angular-velocity branch. Low hysteresis means the return path overlaps the outbound path. High hysteresis suggests path dependence or branch switching. If the panel reports <code className="rounded bg-[#020617] px-1.5 py-0.5 text-[#e5e7eb]">n/a</code>, there is not yet enough return-path geometry to evaluate hysteresis.
                </p>
                <div>
                  <p>
                    <strong>Coupling Stability Index.</strong> A composite 0-1 score combining phase anomaly, curvature, manifold departure, hysteresis when available, and historical novelty. It summarizes whether the present trajectory is stable, watch-level, excursion-level, or escape-candidate.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[#cbd5e1]">
                    <li>0.00-0.25: stable</li>
                    <li>0.25-0.50: watch</li>
                    <li>0.50-0.75: excursion</li>
                    <li>0.75-1.00: escape candidate</li>
                  </ul>
                  <p className="mt-2">
                    This should be read as a state-space stability index, not as a probability of a specific physical event.
                  </p>
                </div>
              </div>
            </article>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-[#166534] bg-[#052e16]/40 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#86efac]">Favorable reading</h3>
              <p className="mt-3 rounded-lg border border-[#166534]/70 bg-[#020617] px-3 py-2 font-mono text-sm text-[#bbf7d0]">
                |Zω| &lt; 1.5, M &lt; 0.25, A &gt; 0.75, C &lt; 0.25
              </p>
              <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
                The trajectory is moving through a familiar part of the phase portrait, at a normal angular velocity, with low curvature and strong historical precedent.
              </p>
            </article>

            <article className="rounded-xl border border-[#b91c1c] bg-[#450a0a]/40 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#fca5a5]">Unfavorable reading</h3>
              <p className="mt-3 rounded-lg border border-[#7f1d1d]/80 bg-[#020617] px-3 py-2 font-mono text-sm text-[#fecaca]">
                |Zω| &gt; 2.5, M &gt; 0.75, A &lt; 0.50, C &gt; 0.75
              </p>
              <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
                The trajectory is moving outside its normal phase-conditioned corridor, bending unusually, and showing limited historical similarity.
              </p>
            </article>
          </div>

          <div className="mt-6 rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">How to read the panel</h3>
            <ol className="mt-3 space-y-2 text-sm leading-7 text-[#cbd5e1]">
              <li>1. Check Zω: is the current angular velocity unusual for this phase?</li>
              <li>2. Check Manifold Departure: is the recent state outside the historical corridor?</li>
              <li>3. Check Curvature: is the trajectory bending sharply?</li>
              <li>4. Check Historical Analogue: has a similar path occurred before?</li>
              <li>5. Check Hysteresis: if the path has returned, did it return along the same branch?</li>
              <li>6. Check the Coupling Stability Index: does the combined state indicate stable, watch, excursion, or escape-candidate behavior?</li>
            </ol>
            <p className="mt-4 text-sm leading-7 text-[#cbd5e1]">
              The most important pattern is not one elevated number, but a coherent cluster: high Zω, high curvature, high manifold departure, weak historical analogue support, and measurable hysteresis.
            </p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">Appropriate interpretations</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[#cbd5e1]">
                <li>off-manifold motion</li>
                <li>elevated phase-conditioned anomaly</li>
                <li>high-curvature trajectory</li>
                <li>weak historical analogue</li>
                <li>escape-candidate state-space behavior</li>
                <li>possible branch transition if hysteresis develops</li>
              </ul>
            </article>

            <article className="rounded-xl border border-[#7f1d1d] bg-[#450a0a]/35 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#fca5a5]">Avoid stronger claims</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[#fecaca]">
                <li>confirmed core-mantle decoupling</li>
                <li>deterministic prediction</li>
                <li>imminent event</li>
              </ul>
            </article>
          </div>

          <p className="mt-6 text-sm leading-7 text-[#cbd5e1]">
            The Phase Stability layer can identify an unusual state-space episode. It cannot identify the physical cause by itself. The diagnostic becomes more meaningful when read alongside length-of-day, geomagnetic, residual polar-motion, planetary phase, and escape-model diagnostics.
          </p>
        </section>

        <section>

          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">Deployment Notes</h2>
            <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
              The production app is packaged as a Docker image, served by a Next.js standalone server on port 3000, and reverse proxied by Nginx on ports 80 and 443.
              HTTPS is provided by Let&apos;s Encrypt, and routine redeployments replace the running container with the latest published image.
            </p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-[#cbd5e1]">
              <li>Docker image for reproducible app builds.</li>
              <li>Nginx reverse proxy for default web traffic and TLS termination.</li>
              <li>Linux VM hosting for the live public deployment.</li>
              <li>Cache-aware JSON artifacts bundled with the app for fast startup and consistent UI outputs.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">Current Limitations</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-[#cbd5e1]">
            {DOCS_LIMITATIONS.map((item) => (
              <li key={item} className="rounded-xl border border-[#243041] bg-[#0b1220]/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
