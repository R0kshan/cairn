/**
 * Lazy, swappable ELK provider. `getElk` returns a cached elkjs instance,
 * creating one from the Node worker factory on first use; `setElkFactory` lets
 * the browser playground inject its own. Isolating construction here keeps the
 * elkjs boundary (and its environment shims) out of the layout code.
 */

import type { ELK } from "elkjs/lib/elk.bundled.js";

let factory: (() => ELK) | null = null;
let instance: ELK | null = null;

export function setElkFactory(elkFactory: () => ELK) {
  factory = elkFactory;
  instance = null;
}

export async function getElk(): Promise<ELK> {
  if (instance) return instance;
  if (!factory) {
    const modulePath = "./elk-worker" + ".ts";
    const mod = await import(/* @vite-ignore */ modulePath);
    factory = mod.nodeElkFactory;
  }
  instance = factory!();
  return instance;
}
