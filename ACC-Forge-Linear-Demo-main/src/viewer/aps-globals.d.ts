// The APS Viewer SDK is a global script, loaded at runtime from the Forge CDN.
// `Autodesk` and `THREE` exist only after it loads: never touch them at module scope.
// Typed loosely on purpose; swap in @types/forge-viewer if your app already uses it.
declare global {
  // eslint-disable-next-line no-var
  var Autodesk: any;
  // eslint-disable-next-line no-var
  var THREE: any;
}

export {};
