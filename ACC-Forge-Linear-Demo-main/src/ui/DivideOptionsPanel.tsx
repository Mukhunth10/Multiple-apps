import { useEffect, useState } from 'react';
import { LENGTH_UNITS, type LengthUnit, type Measurement, type SheetScale } from '../measure';
import { divisionChanged, planRedivide, type Asset, type DivideOptions, type RedividePlan } from '../tracking';

interface Props {
  measurements: Measurement[];
  scales: SheetScale[];
  assets: Asset[];
  options: DivideOptions;
  onOptionsChanged(o: DivideOptions): void;
  onAssetChanged(a: Asset): void;
}

export function DivideOptionsPanel(p: Props) {
  const [draft, setDraft] = useState<DivideOptions>(p.options);
  const [carry, setCarry] = useState(false);
  const [plan, setPlan] = useState<RedividePlan | null>(null);
  useEffect(() => setDraft(p.options), [p.options]);

  const input = { measurements: p.measurements, scales: p.scales, options: p.options, assets: p.assets };
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.options);

  const commit = (next: RedividePlan | null) => {
    p.onOptionsChanged(draft);
    next?.changed.forEach(p.onAssetChanged);
    setPlan(null);
  };

  const apply = () => {
    if (!divisionChanged(p.options, draft)) return commit(null);
    const next = planRedivide(input, draft, carry);
    // Re-dividing re-cuts every piece: confirm before any placed asset changes span or loses geometry.
    if (next.unplaced.length || next.recut.length) setPlan(next);
    else commit(next);
  };

  const setStage = (i: number, patch: Partial<DivideOptions['ladder'][number]>) =>
    setDraft({ ...draft, ladder: draft.ladder.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  return (
    <div className="mt-panel">
      <section>
        <h3>Division size</h3>
        <div className="mt-row">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="None"
            value={draft.divisionSize ?? ''}
            onChange={(e) => setDraft({ ...draft, divisionSize: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <select value={draft.divisionUnit} onChange={(e) => setDraft({ ...draft, divisionUnit: e.target.value as LengthUnit })}>
            {LENGTH_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <p className="mt-muted">Empty or zero keeps every run as one asset. A leftover under half a division joins the last piece.</p>
      </section>

      <section>
        <h3>Gap between pieces</h3>
        <div className="mt-row">
          <input
            type="number"
            min="0"
            max="40"
            step="0.5"
            value={draft.gapWidth}
            onChange={(e) => setDraft({ ...draft, gapWidth: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span className="mt-muted">pt on the sheet</span>
        </div>
      </section>

      <section>
        <h3>Status ladder</h3>
        <ol className="mt-ladder">
          {draft.ladder.map((s, i) => (
            <li key={i}>
              <input type="color" value={s.color} onChange={(e) => setStage(i, { color: e.target.value })} />
              <input className="mt-grow" value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} />
              <span className="mt-muted">{Math.round(((i + 1) / draft.ladder.length) * 100)}%</span>
              <button
                className="mt-icon"
                disabled={draft.ladder.length <= 1}
                onClick={() => setDraft({ ...draft, ladder: draft.ladder.filter((_, k) => k !== i) })}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
        <button
          onClick={() => setDraft({ ...draft, ladder: [...draft.ladder, { name: `${ordinal(draft.ladder.length + 1)} fix`, color: '#888888' }] })}
        >
          Add stage
        </button>
      </section>

      <section className="mt-row">
        <label className="mt-check">
          <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
          Carry progress onto new pieces by span
        </label>
      </section>
      <div className="mt-row">
        <button className="primary" disabled={!dirty} onClick={apply}>Apply</button>
        <button disabled={!dirty} onClick={() => setDraft(p.options)}>Revert</button>
      </div>

      {plan && (
        <div className="mt-modal-backdrop">
          <div className="mt-modal">
            <h3>Re-divide every linear asset?</h3>
            <p>
              Changing the division size re-cuts every run. This affects{' '}
              <b>{plan.unplaced.length + plan.recut.length}</b> current asset{plan.unplaced.length + plan.recut.length === 1 ? '' : 's'}
              {plan.withProgress ? <>, <b>{plan.withProgress}</b> of them with progress</> : null}.
            </p>
            <ul className="mt-muted">
              <li>{plan.recut.length} keep their number but cover a different length of the run</li>
              <li>{plan.unplaced.length} become unplaced (kept, no longer on the sheet)</li>
              <li>{plan.created.length} new asset{plan.created.length === 1 ? '' : 's'} created</li>
            </ul>
            <p className="mt-muted">
              {carry
                ? 'New and re-cut pieces take the stage of the old piece they overlap most.'
                : 'Re-cut pieces keep the stage they had; new pieces start as not started.'}
            </p>
            <div className="mt-row mt-end">
              <button onClick={() => setPlan(null)}>Cancel</button>
              <button className="danger" onClick={() => commit(plan)}>Re-divide</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}
