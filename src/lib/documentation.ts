export const PANEL_GUIDES: Record<string, string> = {
  forecast:
    'Experimental transition-probability view derived from lag-conditioned historical structure. Rising probability or earlier peaks suggest the current state resembles past transition episodes, but this is a comparative similarity diagnostic rather than a deterministic prediction.',
  phaseEscape:
    'Experimental phase-conditioned metastable escape diagnostic built from internal DRIFT state and DE442 torque-proxy phases. Use it to inspect residual phase misalignment, phase drift, curvature, stability, barrier ratio, and the Kramers-like comparative index without reading the composite as a deterministic driver.',
  sphere:
    'Compare the drift axis and IERS polar-motion frame in one Earth-fixed view. The display is north-up/west-left: x_pole points upward along the Greenwich meridian and y_pole points left toward 90°W.',
  polar:
    'Observed polar-motion trajectory in xp-yp space. Look for narrow-band confinement, turning points, loop structure, and changes in clustering or excursion shape.',
  residualPolar:
    'Reproduces the paper residual polar-motion XY phase-space view from the live EOP series. The panel removes the secular xp/yp trend, integrates the detrended residual components, overlays a one-year rolling centroid, and fits the residual drift axis in a north-up/west-left IERS orientation: x_res upward along Greenwich and y_res left toward 90°W.',
  polarTrajectory:
    'Reproduces the paper polar-motion trajectory view from the live EOP series in a north-up/west-left IERS orientation: x_pole upward along Greenwich and y_pole left toward 90°W. Chronological coloring follows the residual XY panel so the long-loop evolution can be read as a path rather than a static cloud.',
  loopAngularVelocity:
    'Reproduces the paper loop-center angular-velocity figure from the live EOP series. The solid curve uses completed Chandler-scale loop centers, unwraps their center angle, and plots finite-difference angular velocity smoothed with a quadratic Savitzky-Golay style filter. The shaded band is a robust ±2σ estimate from MAD residuals. When newer data extend beyond the last completed loop, the latest incomplete-loop estimate is shown separately as a dashed provisional endpoint so the live diagnostic does not distort the paper-equivalent smoothed curve. Its visible error bar combines the completed-loop robust band with a near-origin angular-sensitivity term; low-radius provisional centers are labeled low-confidence.',
  drift:
    'Tracks the longitude of the dominant drift axis through time. For each selected window, the polar-motion samples are read in the active frame, the dominant direction of the recent xp-yp trajectory is fit from that local cloud, and the planar angle of that direction is reported as drift longitude. Smooth migration indicates a persistent geometric trend, while flattening, reversals, or abrupt bends can mark reorganization.',
  angle:
    'Monitors relative angular measures within the inferred geometric frame. Spikes, drift, or repeated crossings indicate changes in orientation coherence, but they should be read alongside the other structural panels.',
  coupling:
    'Compares directional alignment measures with geomagnetic activity indices. Treat this as contextual comparison and timing evidence, not as proof that geomagnetic forcing is driving the observed geometry.',
  phase:
    'State-space view of phase versus angular velocity. Coherent loops support fast cyclic structure, while distortions, widening, or broken trajectories suggest departures from the recent dynamical pattern.',
  phaseDiag:
    'Tracks phase and angular velocity through time. Use it to spot slowdowns, bursts, clustering, or irregular evolution in the fast component.',
  ortho:
    'Measures how elongated versus isotropic the local geometry is. Lower values indicate stronger directional organization; rising values suggest the structure is broadening or becoming less constrained.',
  overlay:
    'Normalized comparison of several signals on one time axis. Useful for checking whether features line up, lead, lag, or appear only in one subsystem.',
  lagModel:
    'Shows the average delayed response after turning points relative to a baseline. Read it as descriptive evidence for structured persistence, not as a mechanistic impulse-response law.',
  conditionalLag:
    'Maps lag response by phase/state so you can see whether the system reacts differently in different parts of the cycle. Localized hotspots support phase-dependent dynamics.',
};

interface DocsPanelGuide {
  title: string;
  guide: string;
  experimental?: boolean;
}

export const DOCS_PANEL_GUIDES: DocsPanelGuide[] = [
  { title: '3D Vector View', guide: PANEL_GUIDES.sphere },
  { title: 'Polar Motion (XP, YP)', guide: PANEL_GUIDES.polar },
  { title: 'Residual Polar Motion (XY)', guide: PANEL_GUIDES.residualPolar },
  { title: 'Polar Motion Trajectory', guide: PANEL_GUIDES.polarTrajectory },
  { title: 'Loop-Center Angular Velocity', guide: PANEL_GUIDES.loopAngularVelocity },
  { title: 'Drift Direction', guide: PANEL_GUIDES.drift },
  { title: 'Phase Portrait', guide: PANEL_GUIDES.phase },
  { title: 'Phase Diagnostics', guide: PANEL_GUIDES.phaseDiag },
  { title: 'Orthogonal Deviation Ratio R(t)', guide: PANEL_GUIDES.ortho },
  { title: 'Lag Model', guide: PANEL_GUIDES.lagModel },
  { title: 'Overlay Plot', guide: PANEL_GUIDES.overlay },
  { title: 'Conditional Lag Response', guide: PANEL_GUIDES.conditionalLag },
  { title: 'Phase-Locked Escape Model', guide: PANEL_GUIDES.phaseEscape, experimental: true },
  { title: 'Transition Probability', guide: PANEL_GUIDES.forecast, experimental: true },
];

export const DOCS_PRINCIPLES = [
  {
    title: 'Constraint-first reading',
    body:
      'The paper starts from the geometry required by the observed polar-motion record rather than from an assumed forcing model. The dashboard follows that approach: it emphasizes what the data robustly support before moving to interpretation.',
  },
  {
    title: 'Hierarchy of inference',
    body:
      'The strongest claims are low-dimensional confinement, planar organization, and bistable structure. Fast-slow dynamics are an interpretive layer above that, while absolute directional alignment and axis stability should be treated more cautiously.',
  },
  {
    title: 'Context is not causation',
    body:
      'Geomagnetic series are included as comparison signals and timing context. Visual agreement, alignment minima, or coincident activity do not by themselves establish a causal geodetic-geomagnetic coupling.',
  },
  {
    title: 'Observed-window humility',
    body:
      'The paper is explicit that its conclusions apply to the sampled observational window. The dashboard should therefore be read as a live instrument for the available record, not as proof of timeless or universal system structure.',
  },
];

export const DOCS_OUTPUTS = [
  {
    title: 'Geometric state summary',
    body:
      'Polar Motion, Drift Direction, and Orthogonal Deviation summarize whether the trajectory remains confined to a narrow geometric band, how the dominant axis is evolving, and whether the local structure is becoming more isotropic.',
  },
  {
    title: 'Fast-slow dynamical context',
    body:
      'Phase Portrait, Phase Diagnostics, and Lag panels are the main tools for reading the paper’s coupled fast-slow picture: looping motion in the fast component together with slower drift and intermittency in the broader structure.',
  },
  {
    title: 'Comparative external context',
    body:
      'The 3D Vector View and overlays place the geometric diagnostics next to any available external context. Fullscreen views preserve the same controls, selected traces, ranges, and guide text as their dashboard panels, which keeps timing comparisons and cross-checks consistent while causal interpretation remains conservative.',
  },
  {
    title: 'Experimental transition probability',
    body:
      'The Transition Probability panel turns the current state and lag-conditioned history into a forward probability curve. It is most useful as an experimental similarity layer that shows when the present geometry resembles earlier transition-like behavior.',
  },
  {
    title: 'Experimental phase-conditioned escape-energy diagnostics',
    body:
      'The Phase-Locked Escape Model reports phase-dependent escape probability, residual phase drift, curvature, stability, barrier ratio, and a Kramers-like index that uses R(t) as a noise proxy. Treat these as comparative diagnostics, not deterministic transition claims.',
  },
];

export const DOCS_LIMITATIONS = [
  'The paper supports low-dimensional geometry and bistable structure more strongly than it supports any fixed Earth-aligned direction or external driver.',
  'The dashboard’s geomagnetic comparisons are contextual; they should not be read as standalone evidence of coupling or causation.',
  'Transition Probability outputs depend on rolling diagnostics and conditional lag structure, so they are exploratory indicators rather than validated predictive guarantees.',
  'Phase-Locked Escape Model outputs are phase-conditioned diagnostics; barrier ratio and Kramers-like index values are comparative indicators and should not be interpreted as physical joules, literal thermal escape rates, or deterministic timing.',
  'All conclusions are tied to the observational window represented in the available data and may not generalize outside that interval.',
  'Source freshness is bounded by upstream publication cadence, service availability, local timestamp-based refresh windows, and the daily normalization used for some inputs.',
];
