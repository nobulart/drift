export const PANEL_GUIDES: Record<string, string> = {
  forecast:
    'Exploratory transition-risk view derived from lag-conditioned historical structure. Rising probability or earlier peaks suggest the current state resembles past transition episodes, but this is not a deterministic forecast.',
  phaseEscape:
    'Phase-conditioned metastable escape diagnostic built from internal DRIFT state and DE442 torque-proxy phases. Use it to inspect residual phase misalignment, phase drift, curvature, stability, barrier ratio, and the Kramers-like comparative risk index without reading the composite as a deterministic driver.',
  sphere:
    'Compare the drift axis and principal frame in one Earth-fixed view. Use it to inspect geometry and reorientation across the observed record.',
  polar:
    'Observed polar-motion trajectory in xp-yp space. Look for narrow-band confinement, turning points, loop structure, and changes in clustering or excursion shape.',
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

export const DOCS_PANEL_GUIDES = [
  { title: '3D Vector View', guide: PANEL_GUIDES.sphere },
  { title: 'Transition Forecast', guide: PANEL_GUIDES.forecast },
  { title: 'Phase-Locked Escape Model', guide: PANEL_GUIDES.phaseEscape },
  { title: 'Polar Motion (XP, YP)', guide: PANEL_GUIDES.polar },
  { title: 'Drift Direction', guide: PANEL_GUIDES.drift },
  { title: 'Phase Portrait', guide: PANEL_GUIDES.phase },
  { title: 'Phase Diagnostics', guide: PANEL_GUIDES.phaseDiag },
  { title: 'Orthogonal Deviation Ratio R(t)', guide: PANEL_GUIDES.ortho },
  { title: 'Lag Model', guide: PANEL_GUIDES.lagModel },
  { title: 'Overlay Plot', guide: PANEL_GUIDES.overlay },
  { title: 'Conditional Lag Response', guide: PANEL_GUIDES.conditionalLag },
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
    title: 'Exploratory transition monitoring',
    body:
      'The Transition Forecast turns the current state and lag-conditioned history into a forward-looking risk curve. It is most useful as an alerting and prioritization layer that tells you when the present geometry resembles earlier transition-like behavior.',
  },
  {
    title: 'Phase-conditioned escape-energy diagnostics',
    body:
      'The Phase-Locked Escape Model reports phase-dependent escape probability, residual phase drift, curvature, stability, barrier ratio, and a Kramers-like index that uses R(t) as a noise proxy. Treat these as comparative risk diagnostics, not deterministic transition claims.',
  },
];

export const DOCS_LIMITATIONS = [
  'The paper supports low-dimensional geometry and bistable structure more strongly than it supports any fixed Earth-aligned direction or external driver.',
  'The dashboard’s geomagnetic comparisons are contextual; they should not be read as standalone evidence of coupling or causation.',
  'Forecast outputs depend on rolling diagnostics and conditional lag structure, so they are exploratory indicators rather than validated predictive guarantees.',
  'Phase-Locked Escape Model outputs are phase-conditioned diagnostics; barrier ratio and Kramers-like index values are comparative indicators and should not be interpreted as physical joules, literal thermal escape rates, or deterministic timing.',
  'All conclusions are tied to the observational window represented in the available data and may not generalize outside that interval.',
  'Source freshness is bounded by upstream publication cadence, service availability, local timestamp-based refresh windows, and the daily normalization used for some inputs.',
];
