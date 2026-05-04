export interface PanelOption {
  id: string;
  label: string;
}

export const DEFAULT_PANEL_ORDER = [
  'sphere',
  'forecast',
  'residualPolar',
  'polarTrajectory',
  'loopAngularVelocity',
  'phase',
  'polar',
  'drift',
  'phaseDiag',
  'ortho',
  'lagModel',
  'overlay',
  'conditionalLag',
  'phaseEscape',
] as const;

export const PANEL_OPTIONS: PanelOption[] = [
  { id: 'forecast', label: 'Transition Probability' },
  { id: 'sphere', label: '3D Vector View' },
  { id: 'residualPolar', label: 'Residual Polar Motion (XY)' },
  { id: 'polarTrajectory', label: 'Polar Motion Trajectory' },
  { id: 'loopAngularVelocity', label: 'Loop-Center Angular Velocity' },
  { id: 'phase', label: 'Phase Portrait' },
  { id: 'polar', label: 'Polar Motion' },
  { id: 'drift', label: 'Drift Direction' },
  { id: 'phaseDiag', label: 'Phase Diagnostics' },
  { id: 'ortho', label: 'Orthogonal Deviation' },
  { id: 'overlay', label: 'Overlay Plot' },
  { id: 'lagModel', label: 'Lag Model' },
  { id: 'conditionalLag', label: 'Conditional Lag Response' },
  { id: 'phaseEscape', label: 'Phase-Locked Escape Model' },
];
