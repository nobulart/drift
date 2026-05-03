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
    role: 'Earth-geocentric planetary distance, angular velocity, longitude, and torque-screening overlays',
    href: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/',
  },
];

const sourcePaperHref =
  'https://www.academia.edu/165465085/Earth_Fixed_Geometric_Structure_Bistable_Dynamics_and_Phase_Locked_Planetary_Torque_Coupling_in_Polar_Motion';

const pipelineSteps = [
  'Fetch upstream geodetic and geomagnetic source files only when local caches may be stale.',
  'Normalize and cache the source products into local JSON artifacts.',
  'Extract daily Earth-geocentric DE442 ephemeris overlays for the tracked bodies.',
  'Aggregate GFZ geomagnetic inputs into dashboard-friendly daily records.',
  'Compute drift, rolling diagnostics, lag models, and transition-probability inputs.',
  'Serve combined artifacts through API routes and prebuilt data files.',
  'Render synchronized interactive panels in the browser.',
];

const apiRows = [
  {
    route: '/api/eop',
    purpose: 'Historical Earth Orientation Parameters cache.',
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
    purpose: 'Full combined dashboard dataset used by the app.',
    fields: 't, xp, yp, geomagnetic context, GRACE context, inertia vectors when available',
  },
  {
    route: '/api/ephemeris',
    purpose: 'DE442 Earth-geocentric overlay cache for 1973-01-02 through 2050-12-31.',
    fields: 'source metadata, records[].bodies[bodyKey].distance_au/angular_velocity_deg_per_day/radial_velocity_km_s/ecliptic_longitude_deg/torque_proxy',
  },
  {
    route: '/api/rolling-stats',
    purpose: 'On-demand or cached rolling diagnostics and lag models.',
    fields: 'theta, omega, rRatio, turningPoints, lagModel, conditionalLagModel',
  },
  {
    route: '/api/transition-forecast',
    purpose: 'Experimental forward transition-probability summary derived from conditional lag structure.',
    fields: 'lags, P_tau, expected_time, peak_time, cumulative, probability summary',
  },
  {
    route: '/api/phase-escape',
    purpose: 'Phase-Locked Escape Model state built from internal DRIFT EOP state and DE442-derived composite phases.',
    fields: 'thetaRaw, thetaResidual, rRatio, bodyPhases, composites, misalignment',
  },
  {
    route: '/api/update-data',
    purpose: 'Runs the timestamp-aware source refresh pipeline used by the sidebar Update Data button.',
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
                Version v1.4.8
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
            <a
              href={sourcePaperHref}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-sm font-semibold text-[#93c5fd] underline decoration-[#60a5fa]/50 underline-offset-2 transition-colors hover:text-white"
            >
              Source paper
            </a>
          </div>

          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">How to Read It</h2>
            <ol className="mt-3 space-y-3 text-sm leading-6 text-[#cbd5e1]">
              <li>1. Start with the 3D Vector View, Residual Polar Motion, and Polar Motion Trajectory to read the IERS frame consistently: x_pole north/up along Greenwich and y_pole west/left toward 90°W.</li>
              <li>2. Use Phase Portrait and Phase Diagnostics to inspect the fast cyclic structure and any bursts, slowdowns, or loop distortion.</li>
              <li>3. Compare the 3D view, overlays, and any available geomagnetic context for timing context, but keep causal interpretation conservative.</li>
              <li>4. Use the Phase-Locked Escape Model<sup className="ml-0.5 text-[10px] lowercase text-[#38bdf8]">experimental</sup> to inspect phase-conditioned escape probability, drift, curvature, barrier ratio, and comparative escape-energy diagnostics.</li>
              <li>5. Read Transition Probability<sup className="ml-0.5 text-[10px] lowercase text-[#38bdf8]">experimental</sup> last as an exploratory summary of whether the present state resembles earlier transition-like episodes.</li>
            </ol>
          </div>
        </section>

        <section className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
          <h2 className="text-lg font-bold text-white">Release Highlights</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.4.8 IERS XY Frame</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Added square residual and trajectory polar-motion panels, aligned their fullscreen modals, and made the 3D Vector View use the same north-up/west-left IERS orientation with clear direction labels and drift longitude.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.4.6 Live Refresh</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                The sidebar Update Data control now runs the source refresh pipeline from the app, skips upstream retrievals while local files are fresh, and keeps fullscreen panel state consistent with panel state.
              </p>
            </article>
            <article className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">v1.4.5 Real Data Only</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">
                Synthetic fallback series were removed from the active pipeline, the unstable Angle Diagnostics and Alignment panels were taken out of the UI, and the transition-probability/lag tooling now reads only the current real-data cache.
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
          <div className="mt-4 space-y-4">
            {apiRows.map((row) => (
              <article key={row.route} className="rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-sm font-semibold text-[#93c5fd]">{row.route}</code>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{row.purpose}</p>
                <p className="mt-2 text-xs leading-5 text-[#9ca3af]">Key fields: {row.fields}</p>
              </article>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-[#243041] bg-[#0b1220]/70 p-4 text-sm leading-6 text-[#cbd5e1]">
            <p>Analysis query routes accept URL parameters.</p>
            <p className="mt-2 text-xs text-[#9ca3af]">
              `/api/rolling-stats` accepts `windowSize`, `turnThreshold`, `centerWindow`, `centerStep`, `danceWindow`, and `conditionalTargetState`.
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
                <h3 className="text-sm font-semibold text-white">
                  {panel.title}
                  {panel.experimental && (
                    <sup className="ml-1 text-[10px] lowercase text-[#38bdf8]">experimental</sup>
                  )}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#cbd5e1]">{panel.guide}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">
              Transition Probability Model<sup className="ml-1 text-[10px] lowercase text-[#38bdf8]">experimental</sup>
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

          <div className="rounded-2xl border border-[#374151] bg-[#111827] p-6">
            <h2 className="text-lg font-bold text-white">Deployment Notes</h2>
            <p className="mt-3 text-sm leading-7 text-[#cbd5e1]">
              The production app is packaged as a Docker image, served by a Next.js standalone server on port 3000, and reverse proxied by Nginx on ports 80 and 443.
              HTTPS is provided by Let&apos;s Encrypt, and routine redeployments replace the running container with the latest published image.
            </p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-[#cbd5e1]">
              <li>Docker image for reproducible app builds.</li>
              <li>Nginx reverse proxy for default web traffic and TLS termination.</li>
              <li>Kamatera VM hosting for the live public deployment.</li>
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
