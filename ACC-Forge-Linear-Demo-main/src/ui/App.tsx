// Demo host. Stands in for the recipient's app: it owns the viewer and holds
// the state in memory (nothing persists). In a real app the callbacks below
// write to its own storage layer instead.

import { useRef, useState } from 'react';
import type { Measurement, SheetScale } from '../measure';
import { DEFAULT_OPTIONS, type Asset, type DivideOptions } from '../tracking';
import {
  attachEdit2D,
  createViewer,
  listSheets,
  loadDocument,
  sheetIdentity,
  showSheet,
  type ApsViewer,
  type MeasureSurface,
  type SheetNode,
} from '../viewer';
import { TrackingWorkspace } from './TrackingWorkspace';

const upsert = <T,>(list: T[], item: T, same: (a: T) => boolean) =>
  list.some(same) ? list.map((x) => (same(x) ? item : x)) : [...list, item];

export function App() {
  const [urn, setUrn] = useState('');
  const [token, setToken] = useState('');
  const tokenRef = useRef('');
  tokenRef.current = token;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ApsViewer>(null);
  const docRef = useRef<any>(null);
  const [sheets, setSheets] = useState<SheetNode[]>([]);
  const [current, setCurrent] = useState<SheetNode | null>(null);
  const [surface, setSurface] = useState<MeasureSurface | null>(null);
  const [status, setStatus] = useState('');

  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [scales, setScales] = useState<SheetScale[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [options, setOptions] = useState<DivideOptions>(DEFAULT_OPTIONS);

  const open = async (node: SheetNode) => {
    setStatus(`Loading ${node.name()}...`);
    surface?.dispose();
    setSurface(null);
    await showSheet(viewerRef.current, docRef.current, node);
    setCurrent(node);
    setSurface(await attachEdit2D(viewerRef.current));
    setStatus('');
  };

  const load = async () => {
    try {
      setStatus('Loading viewer...');
      viewerRef.current ??= await createViewer(containerRef.current!, async () => ({ access_token: tokenRef.current, expires_in: 3600 }));
      docRef.current = await loadDocument(urn.trim());
      const list = listSheets(docRef.current);
      setSheets(list);
      if (!list.length) return setStatus('This document has no 2D sheets.');
      await open(list[0]);
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
    }
  };

  const id = current ? sheetIdentity(current) : { sheet: '', page: 1 };

  return (
    <div className="app">
      <header className="app-bar">
        <input placeholder="Document URN (base64)" value={urn} onChange={(e) => setUrn(e.target.value)} />
        <input placeholder="Access token (viewables:read)" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="primary" disabled={!urn || !token} onClick={load}>Load</button>
        {sheets.length > 1 && (
          <select value={current?.guid() ?? ''} onChange={(e) => open(sheets.find((s) => s.guid() === e.target.value))}>
            {sheets.map((s) => <option key={s.guid()} value={s.guid()}>{s.name()}</option>)}
          </select>
        )}
        <span className="mt-muted">{status}</span>
      </header>
      <main className="app-main">
        <div className="app-viewer" ref={containerRef} />
        <aside className="app-side">
          {current ? (
            <TrackingWorkspace
              surface={surface}
              sheet={id.sheet}
              page={id.page}
              measurements={measurements}
              scales={scales}
              assets={assets}
              options={options}
              onMeasurementCreated={(m) => setMeasurements((ms) => [...ms, m])}
              onMeasurementChanged={(m) => setMeasurements((ms) => ms.map((x) => (x.id === m.id ? m : x)))}
              onMeasurementDeleted={(mid) => setMeasurements((ms) => ms.filter((m) => m.id !== mid))}
              onScaleChanged={(sc) => setScales((ss) => upsert(ss, sc, (x) => x.sheet === sc.sheet && x.page === sc.page))}
              onAssetChanged={(a) => setAssets((as) => upsert(as, a, (x) => x.key === a.key))}
              onOptionsChanged={setOptions}
            />
          ) : (
            <p className="mt-muted mt-panel">Paste a document URN and an access token, then Load.</p>
          )}
        </aside>
      </main>
    </div>
  );
}
