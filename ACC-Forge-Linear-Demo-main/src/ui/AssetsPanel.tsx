import { convertLength, formatLength, resolveScale, type LengthUnit, type Measurement, type SheetScale } from '../measure';
import { assetLabel, groupAssets, percentComplete, stageOf, type Asset, type DivideOptions } from '../tracking';

interface Props {
  measurements: Measurement[];
  assets: Asset[];
  options: DivideOptions;
  sheetScale: SheetScale | undefined;
  selected: string[];
  onSelect(keys: string[]): void;
  onAssetChanged(a: Asset): void;
}

export function AssetsPanel(p: Props) {
  const groups = groupAssets(p.assets, p.measurements);
  const selected = new Set(p.selected);

  const row = (a: Asset, placed: boolean, unit: LengthUnit) => {
    const stage = stageOf(a.stage, p.options.ladder);
    const pct = percentComplete(a.stage, p.options.ladder);
    return (
      <li
        key={a.key}
        className={`${selected.has(a.key) ? 'selected' : ''} ${placed ? '' : 'unplaced'}`}
        onClick={() => placed && p.onSelect([a.key])}
      >
        <span className="mt-swatch" style={{ background: stage?.color ?? '#555' }} />
        <span className="mt-grow">{assetLabel(a)}</span>
        <span className="mt-muted">{formatLength(convertLength(a.toM - a.fromM, 'm', unit), unit)}</span>
        <select
          value={a.stage}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => p.onAssetChanged({ ...a, stage: Number(e.target.value) })}
        >
          <option value={-1}>Not started</option>
          {p.options.ladder.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
        </select>
        <span className="mt-pct" title="Derived from the stage's position in the ladder">{pct}%</span>
      </li>
    );
  };

  if (!groups.length) return <p className="mt-muted mt-panel">No assets on this sheet. Draw a polyline first.</p>;

  return (
    <div className="mt-panel">
      {groups.map((g) => {
        const unit = (g.measurement && resolveScale(g.measurement, p.sheetScale)?.unit) || 'm';
        // Unplaced assets with no progress carry nothing worth showing (e.g. the whole run after dividing).
        const unplaced = g.unplaced.filter((a) => a.stage >= 0);
        if (!g.placed.length && !unplaced.length) return null;
        const done = g.placed.length ? Math.round(g.placed.reduce((n, a) => n + percentComplete(a.stage, p.options.ladder), 0) / g.placed.length) : 0;
        return (
          <section key={g.measurementId}>
            <h3 className="mt-group" onClick={() => g.placed.length && p.onSelect(g.placed.map((a) => a.key))}>
              <span className="mt-grow">{g.label}</span>
              <span className="mt-muted">{g.placed.length} asset{g.placed.length === 1 ? '' : 's'}, {done}%</span>
            </h3>
            <ul className="mt-list">{g.placed.map((a) => row(a, true, unit))}</ul>
            {!!unplaced.length && (
              <>
                <h4 className="mt-muted">Unplaced with progress ({unplaced.length})</h4>
                <ul className="mt-list">{unplaced.map((a) => row(a, false, unit))}</ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
