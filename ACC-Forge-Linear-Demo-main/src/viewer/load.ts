// Demo wiring: load the SDK from the Forge CDN, create a viewer, load a sheet.
// An app that already has APS integrated keeps its own version of this file and
// only uses edit2d-surface.ts, which attaches to any existing viewer instance.

/** A viewer instance (Autodesk.Viewing.GuiViewer3D or Viewer3D). */
export type ApsViewer = any;
/** A 2D viewable node from the document's bubble. */
export type SheetNode = any;

export type GetToken = () => Promise<{ access_token: string; expires_in: number }>;

const cdn = (version: string) => `https://developer.api.autodesk.com/modelderivative/v2/viewers/${version}`;

let sdkLoading: Promise<void> | null = null;

export function loadViewerSdk(version = '7.*'): Promise<void> {
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<void>((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${cdn(version)}/style.min.css`;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `${cdn(version)}/viewer3D.min.js`;
    js.onload = () => resolve();
    js.onerror = () => {
      sdkLoading = null;
      reject(new Error('Could not load the APS Viewer SDK from the CDN'));
    };
    document.head.appendChild(js);
  });
  return sdkLoading;
}

export async function createViewer(container: HTMLElement, getToken: GetToken): Promise<ApsViewer> {
  await loadViewerSdk();
  await new Promise<void>((resolve) =>
    Autodesk.Viewing.Initializer(
      {
        env: 'AutodeskProduction2',
        api: 'streamingV2',
        getAccessToken: (done: (token: string, expires: number) => void) =>
          getToken().then((t) => done(t.access_token, t.expires_in)),
      },
      () => resolve(),
    ),
  );
  const viewer = new Autodesk.Viewing.GuiViewer3D(container);
  viewer.start();
  return viewer;
}

export function loadDocument(urn: string): Promise<any> {
  const id = urn.startsWith('urn:') ? urn : `urn:${urn}`;
  return new Promise((resolve, reject) =>
    Autodesk.Viewing.Document.load(id, resolve, (code: number, msg: string) =>
      reject(new Error(`Document load failed (${code}): ${msg}`)),
    ),
  );
}

export function listSheets(doc: any): SheetNode[] {
  return doc.getRoot().search({ type: 'geometry', role: '2d' });
}

/** The identity a sheet is tracked under: viewable guid + page. */
export function sheetIdentity(node: SheetNode): { sheet: string; page: number } {
  return { sheet: node.guid(), page: Number(node.data?.page) || 1 };
}

export async function showSheet(viewer: ApsViewer, doc: any, node: SheetNode): Promise<void> {
  await viewer.loadDocumentNode(doc, node, { keepCurrentModels: false });
  await new Promise<void>((resolve) => {
    if (viewer.model?.isLoadDone?.()) return resolve();
    viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => resolve(), { once: true });
  });
}
