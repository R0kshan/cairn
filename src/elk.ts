// Runtime-agnostic ELK provider. The CLI (Node/Bun) registers the sync
// fake-worker loader; the browser playground registers the bundled worker.
// If nothing registered, fall back to the Node loader via a computed dynamic
// import (kept out of browser bundles by the indirection).

let factory: (() => any) | null = null;
let instance: any = null;

export function setElkFactory(f: () => any) {
  factory = f;
  instance = null;
}

export async function getElk(): Promise<any> {
  if (instance) return instance;
  if (!factory) {
    const spec = './elk-node' + '.ts'; // computed: not followed by bundlers
    const mod = await import(/* @vite-ignore */ spec);
    factory = mod.nodeElkFactory;
  }
  instance = factory!();
  return instance;
}
