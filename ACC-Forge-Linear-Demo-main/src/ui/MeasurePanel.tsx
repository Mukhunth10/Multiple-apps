import { Check, Pencil, Ruler } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  LENGTH_UNITS,
  calibrate,
  createMeasurement,
  formatLength,
  measuredLength,
  resolveScale,
  scaleModeOf,
  type LengthUnit,
  type MeasureStyle,
  type Measurement,
  type Point,
  type ScaleMode,
  type SheetScale,
} from '../measure';
import type { MeasureSurface } from '../viewer';

interface Props {
  surface: MeasureSurface | null;
  sheet: string;
  page: number;
  measurements: Measurement[];
  onSheet: Measurement[];
  sheetScale: SheetScale | undefined;
  onMeasurementCreated(m: Measurement): void;
  onMeasurementChanged(m: Measurement): void;
  onMeasurementDeleted(id: string): void;
  /** The run being edited, owned by the workspace so it can hide that run's pieces. */
  editingId: string | null;
  onEditingChanged(id: string | null): void;
  onScaleChanged(s: SheetScale): void;
  onLocate(m: Measurement): void;
}

const CALIBRATION_STYLE = { color: '#ff00c8', thickness: 2 };

export function MeasurePanel(p: Props) {
  const [style, setStyle] = useState<MeasureStyle>({ subject: 'Supply duct', thickness: 6, color: '#e5484d' });
  const [busy, setBusy] = useState<'linear' | 'calibrate' | null>(null);
  const [reference, setReference] = useState<Point[] | null>(null);
  const [realLength, setRealLength] = useState('');
  const [unit, setUnit] = useState<LengthUnit>(p.sheetScale?.manual?.unit ?? 'm');

  // Draw mode outlives renders, so its callback reads the latest list and style through refs.
  const latest = useRef({ measurements: p.measurements, style, sheet: p.sheet, page: p.page });
  latest.current = { measurements: p.measurements, style, sheet: p.sheet, page: p.page };
  useEffect(() => p.surface?.setDrawStyle(style), [p.surface, style]);
  useEffect(
    () => () => {
      p.surface?.endDraw();
      p.surface?.endEdit();
    },
    [p.surface],
  );

  const mode = scaleModeOf(p.sheetScale);
  const viewports = p.surface?.viewportScales() ?? [];
  const manual = p.sheetScale?.manual ?? null;
  const canMeasure = mode === 'auto' ? viewports.length > 0 || !!manual : !!manual;

  const setMode = (next: ScaleMode) =>
    p.onScaleChanged({ sheet: p.sheet, page: p.page, mode: next, manual });

  const toggleLinear = () => {
    if (!p.surface) return;
    if (busy === 'linear') return p.surface.endDraw();
    setBusy('linear');
    p.surface.beginDraw(style, {
      onDrawn: ({ points, viewportScale }) => {
        const { measurements, style: s, sheet, page } = latest.current;
        p.onMeasurementCreated(createMeasurement(measurements, sheet, page, points, s, viewportScale));
      },
      onExit: () => setBusy(null),
    });
  };

  const toggleEdit = (m: Measurement) => {
    if (!p.surface) return;
    if (p.editingId === m.id) return p.surface.endEdit();
    p.surface.beginEdit(m.points, { color: m.color, thickness: m.thickness }, {
      onChange: (points) => {
        const current = latest.current.measurements.find((x) => x.id === m.id);
        if (current) p.onMeasurementChanged({ ...current, points });
      },
      onExit: () => p.onEditingChanged(null),
    });
    p.onEditingChanged(m.id);
  };

  const startCalibration = () => {
    if (!p.surface) return;
    setBusy('calibrate');
    p.surface.beginDraw(CALIBRATION_STYLE, {
      onDrawn: ({ points }) => {
        setReference(points);
        p.surface?.endDraw();
      },
      onExit: () => setBusy(null),
    });
  };

  const applyCalibration = () => {
    const scale = reference && calibrate(reference, Number(realLength), unit);
    if (!scale) return;
    p.onScaleChanged({ sheet: p.sheet, page: p.page, mode: 'manual', manual: scale });
    setReference(null);
    setRealLength('');
  };

  const drawing = busy === 'linear';

  return (
    <div className="mt-panel">
      <section>
        <h3>Scale</h3>
        <div className="mt-row">
          <button className={`mt-choice ${mode === 'auto' ? 'active' : ''}`} onClick={() => setMode('auto')}>Auto</button>
          <button className={`mt-choice ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>Manual</button>
        </div>
        {mode === 'auto' ? (
          viewports.length ? (
            <p className="mt-muted">
              {viewports.length} viewport{viewports.length === 1 ? '' : 's'} with a scale. Each run uses the viewport it is drawn in;
              snap a point onto the drawing so the viewport is known.
            </p>
          ) : (
            <p className="mt-warn">This sheet publishes no scale (PDFs never do). Switch to Manual and calibrate.</p>
          )
        ) : manual ? (
          <p className="mt-muted">Calibrated in {manual.unit}. Applies to this sheet only.</p>
        ) : (
          <p className="mt-warn">Not calibrated. Draw a line over a known dimension.</p>
        )}
        {mode === 'manual' &&
          (reference ? (
            <div className="mt-row">
              <input
                autoFocus
                type="number"
                min="0"
                step="any"
                placeholder="Real length"
                value={realLength}
                onChange={(e) => setRealLength(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
              />
              <select value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>
                {LENGTH_UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
              <button className="primary" disabled={!(Number(realLength) > 0)} onClick={applyCalibration}>Set</button>
              <button onClick={() => setReference(null)}>Cancel</button>
            </div>
          ) : (
            <button disabled={!p.surface || busy === 'linear'} onClick={busy === 'calibrate' ? () => p.surface?.endDraw() : startCalibration}>
              {busy === 'calibrate' ? 'Cancel calibration' : manual ? 'Recalibrate' : 'Calibrate'}
            </button>
          ))}
      </section>

      <section>
        <div className="mt-drawbar">
          <button
            className={`mt-tool ${drawing ? 'active' : ''}`}
            title={drawing ? 'Stop adding linear' : 'Add linear'}
            aria-pressed={drawing}
            disabled={!p.surface || !canMeasure || busy === 'calibrate'}
            onClick={toggleLinear}
          >
            <Ruler size={18} />
          </button>
          <span className={drawing ? '' : 'mt-muted'}>
            {drawing ? 'Drawing: double-click or Enter finishes, Esc stops' : 'Add linear'}
          </span>
        </div>
        <h3>Linear measurement</h3>
        <label>
          Subject
          <input value={style.subject} onChange={(e) => setStyle({ ...style, subject: e.target.value })} />
        </label>
        <div className="mt-row">
          <label>
            Thickness (pt)
            <input
              type="number"
              min="0.5"
              max="40"
              step="0.5"
              value={style.thickness}
              onChange={(e) => setStyle({ ...style, thickness: Math.max(0.5, Number(e.target.value) || 0.5) })}
            />
          </label>
          <label>
            Colour
            <input type="color" value={style.color} onChange={(e) => setStyle({ ...style, color: e.target.value })} />
          </label>
        </div>
      </section>

      <section>
        <h3>Runs on this sheet</h3>
        {!p.onSheet.length && <p className="mt-muted">None yet.</p>}
        <ul className="mt-list">
          {p.onSheet.map((m) => {
            const scale = resolveScale(m, p.sheetScale);
            return (
              <li key={m.id} className={p.editingId === m.id ? 'selected' : ''} onClick={() => p.editingId !== m.id && p.onLocate(m)}>
                <span className="mt-swatch" style={{ background: m.color, height: Math.min(m.thickness, 8) }} />
                <span className="mt-grow">Run {m.number}: {m.subject}</span>
                {scale ? (
                  <span className="mt-muted">{formatLength(measuredLength(m, scale), scale.unit)}</span>
                ) : (
                  <span className="mt-warn" title="Drawn outside any viewport and the sheet has no manual calibration">no scale</span>
                )}
                <button
                  className="mt-icon"
                  title={p.editingId === m.id ? 'Done editing' : 'Edit run'}
                  disabled={!p.surface}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleEdit(m);
                  }}
                >
                  {p.editingId === m.id ? <Check size={15} /> : <Pencil size={14} />}
                </button>
                <button
                  className="mt-icon"
                  title="Delete run (its assets become unplaced)"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (p.editingId === m.id) p.surface?.endEdit();
                    p.onMeasurementDeleted(m.id);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {p.editingId && (
          <p className="mt-muted">
            Drag an end or elbow to move it, select an elbow and press Delete to remove it,
            double-click an end to continue the run. Esc or the tick finishes.
          </p>
        )}
      </section>
    </div>
  );
}
