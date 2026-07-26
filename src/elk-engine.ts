let factory: (() => any) | null = null;
let instance: any = null;

export function setElkFactory(elkFactory: () => any) {
  factory = elkFactory;
  instance = null;
}

export async function getElk(): Promise<any> {
  if (instance) return instance;
  if (!factory) {
    const modulePath = "./elk-worker" + ".ts";
    const mod = await import(/* @vite-ignore */ modulePath);
    factory = mod.nodeElkFactory;
  }
  instance = factory!();
  return instance;
}
