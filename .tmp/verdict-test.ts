type Profile = Map<string, number>;
function relayoutVerdict(before: Profile, after: Profile): number {
  const normalize = (key: string) => key.replace(/@[-\d.,]+$/, "").replace(/:\d+(?=@|$)/, "");
  const tally = (profile: Profile) => {
    const out = new Map<string, { tier: number; count: number }>();
    for (const [key, tier] of profile) {
      const id = normalize(key);
      const entry = out.get(id) ?? { tier, count: 0 };
      entry.count++;
      out.set(id, entry);
    }
    return out;
  };
  const was = tally(before);
  const now = tally(after);
  for (let tier = 0; tier < 5; tier++) {
    let gained = false;
    let lost = false;
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const w = was.get(key);
      const n = now.get(key);
      if ((w?.tier ?? tier) !== tier && (n?.tier ?? tier) !== tier) continue;
      if ((n?.count ?? 0) > (w?.count ?? 0)) gained = true;
      if ((n?.count ?? 0) < (w?.count ?? 0)) lost = true;
    }
    if (gained) return -1;
    if (lost) return tier;
  }
  return -1;
}

const before: Profile = new Map([
  ["cross:F01~F03@100,200", 2],
  ["away:F02:out", 3],
  ["away:F02:in", 3],
  ["weave:F03", 3],
  ["unlabelled:F05", 1],
  ["cramped:F10:0", 2],
]);
const after: Profile = new Map();
console.log("verdict:", relayoutVerdict(before, after)); // expect 1 (first tier that only lost)
