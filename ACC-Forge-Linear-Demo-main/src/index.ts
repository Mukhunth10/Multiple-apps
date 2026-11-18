// Public surface for lifting into another app. Each folder stands alone:
//   divide/   pure maths, no imports
//   measure/  measurement record, units, calibration
//   tracking/ assets, ladder, divide options (uses divide + measure)
//   viewer/   the only code that touches the APS viewer
//   ui/       React components (uses all of the above)

export { ABSORB_BELOW, cutPoints, divide, pieceLengths, pointAt, polylineLength, type Piece } from './divide';
export * from './measure';
export * from './tracking';
export {
  attachEdit2D,
  type DrawHandlers,
  type DrawStyle,
  type DrawnPolyline,
  type EditHandlers,
  type MeasureSurface,
  type SheetViewportScale,
  type SurfaceShape,
} from './viewer';
export { TrackingWorkspace, type TrackingWorkspaceProps } from './ui/TrackingWorkspace';
