/**
 * Write <out>.owners.json next to a cairn SVG: each flow label's box and each
 * flow's route runs, as cairn's own layout reports them. measure.py uses it
 * only to know which label belongs to which line (D2's SVG says so itself);
 * everything it measures still comes from the SVG.
 *
 *     node --experimental-strip-types owners.ts <view.cairn> <out.owners.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compile } from "../../../src/api.ts";
import { setElkFactory } from "../../../src/elk-engine.ts";
import { nodeElkFactory } from "../../../src/elk-worker.ts";

setElkFactory(nodeElkFactory);
const result = await compile(readFileSync(process.argv[2], "utf8"));
const boxes = (result.boxes ?? [])
  .filter((b) => b.what === "label" || b.what === "segment")
  .map((b) => ({ flow: b.id, what: b.what, x: b.x, y: b.y, w: b.width, h: b.height }));
writeFileSync(process.argv[3], JSON.stringify(boxes));
