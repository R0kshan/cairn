import ELKConstructor from "elkjs/lib/elk.bundled.js";

export function nodeElkFactory(): any {
  const globalObject = globalThis as any;
  const savedSelf = globalObject.self;
  const hadSelf = "self" in globalObject;
  try {
    delete globalObject.self;
  } catch {
    /* ignore */
  }
  const elk = new (ELKConstructor as any)();
  if (hadSelf) globalObject.self = savedSelf;
  return elk;
}
