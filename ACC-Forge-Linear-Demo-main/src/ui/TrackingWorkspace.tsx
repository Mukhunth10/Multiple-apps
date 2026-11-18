// The whole feature as one controlled component: state comes in as props,
// every change goes out through a callback. It holds nothing but UI state
// (active tab, current selection), so the host decides what is stored.

import { useEffect, useMemo, useState } from 'react';
import { findSheetScale, resolveScale, type Measurement, type SheetScale } from '../measure';
import { assetKey, reconcile, runPieces, stageOf, type Asset, type DivideOptions } from '../tracking';
import type { MeasureSurface, SurfaceShape } from '../viewer';
import { AssetsPanel } from './AssetsPanel';
import { DivideOptionsPanel } from './DivideOptionsPanel';
import { MeasurePanel } from './MeasurePanel';

export interface TrackingWorkspaceProps {
  /** The measure surface attached to the host's viewer (see viewer/edit2d-surface.ts). */
  surface: MeasureSurface | null;
  /** The sheet currently shown in the viewer. */
  sheet: string;
  page: number;
  /** Every measurement the assets refer to, across all sheets. */
  measurements: Measurement[];
  /** Scale choice per sheet (auto from the sheet's viewports, or manual calibration). */
  scales: SheetScale[];
  assets: Asset[];
  options: DivideOptions;
  onMeasurementCreated(m: Measurement): void;
  /** A run's points were edited (moved, added or deleted vertices, or the run was continued). */
  onMeasurementChanged(m: Measurement): void;
  onMeasurementDeleted(id: string): void;
  onScaleChanged(s: SheetScale): void;
  onAssetChanged(a: Asset): void;
  onOptionsChanged(o: DivideOptions): void;
}

type Tab = 'measure' | 'assets' | 'options';

export function TrackingWorkspace(props: TrackingWorkspaceProps) {
  const { surface, sheet, page, measurements, scales, assets, options } = props;
  const [tab, setTab] = useState<Tab>('measure');
  const [selected, setSelected] = useState<string[]>([]);
  /** The run being edited; its pieces are hidden while Edit2D's vertex tool shows the whole run. */
  const [editingId, setEditingId] = useState<string | null>(null);

  // Keep assets in line with the measurements: new pieces appear, vanished ones become unplaced.
  useEffect(() => {
    reconcile({ measurements, scales, options, assets }).changed.forEach(props.onAssetChanged);
  }, [measurements, scales, options, assets]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetScale = findSheetScale(scales, sheet, page);
  const onSheet = useMemo(() => measurements.filter((m) => m.sheet === sheet && m.page === page), [measurements, sheet, page]);

  // Each placed asset is one selectable shape on the sheet, coloured by its stage.
  // Pieces of a divided run leave a small gap at every cut between them.
  const shapes = useMemo<SurfaceShape[]>(() => {
    const stageByKey = new Map(assets.map((a) => [a.key, a.stage]));
    return onSheet.filter((m) => m.id !== editingId).flatMap((m) => {
      const pieces = runPieces(m, resolveScale(m, sheetScale), options);
      return pieces.map((p, i) => {
        const key = assetKey({ sheet: m.sheet, page: m.page, measurementId: m.id, occurrenceKey: p.occurrenceKey });
        const stage = stageOf(stageByKey.get(key) ?? -1, options.ladder);
        return {
          id: key,
          points: p.points,
          color: stage?.color ?? m.color,
          thickness: m.thickness,
          gapStart: i > 0,
          gapEnd: i < pieces.length - 1,
          gapWidth: options.gapWidth,
        };
      });
    });
  }, [onSheet, sheetScale, options, assets, editingId]);

  useEffect(() => surface?.setShapes(shapes), [surface, shapes]);
  useEffect(() => surface?.onSelectionChanged(setSelected), [surface]);

  const select = (keys: string[], locate = true) => {
    setSelected(keys);
    surface?.setSelection(keys);
    if (locate) surface?.locate(keys);
  };

  return (
    <div className="mt-workspace">
      <nav className="mt-tabs">
        {(['measure', 'assets', 'options'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'measure' ? 'Measure' : t === 'assets' ? 'Assets' : 'Divide options'}
          </button>
        ))}
      </nav>
      <div className="mt-tab-body">
        {tab === 'measure' && (
          <MeasurePanel
            surface={surface}
            sheet={sheet}
            page={page}
            measurements={measurements}
            onSheet={onSheet}
            sheetScale={sheetScale}
            onMeasurementCreated={props.onMeasurementCreated}
            onMeasurementChanged={props.onMeasurementChanged}
            onMeasurementDeleted={props.onMeasurementDeleted}
            editingId={editingId}
            onEditingChanged={setEditingId}
            onScaleChanged={props.onScaleChanged}
            onLocate={(m) => select(assets.filter((a) => a.measurementId === m.id && a.placed).map((a) => a.key))}
          />
        )}
        {tab === 'assets' && (
          <AssetsPanel
            measurements={onSheet}
            assets={assets.filter((a) => a.sheet === sheet && a.page === page)}
            options={options}
            sheetScale={sheetScale}
            selected={selected}
            onSelect={select}
            onAssetChanged={props.onAssetChanged}
          />
        )}
        {tab === 'options' && (
          <DivideOptionsPanel
            measurements={measurements}
            scales={scales}
            assets={assets}
            options={options}
            onOptionsChanged={props.onOptionsChanged}
            onAssetChanged={props.onAssetChanged}
          />
        )}
      </div>
    </div>
  );
}
