/**
 * Guards the committed browser bundle (`playground/cairn-engine.js`) against
 * referencing Node-only globals, and round-trips the page's drag writeback
 * through the real parser — the DSL a drag writes has to be DSL cairn reads. The bundle runs in a real browser, where
 * `process` does not exist — a bare reference throws a ReferenceError there
 * even though every other test in this suite runs under Node and never sees
 * the gap. Run via `npm test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_URL = new URL("../playground/cairn-engine.js", import.meta.url).href;

test("browser bundle renders a large diagram with no `process` global", async () => {
  const { compile } = await import(BUNDLE_URL);
  const src = readFileSync(join(ROOT, "examples/infrastructure-large.cairn"), "utf8");

  const realProcess = globalThis.process;
  Reflect.deleteProperty(globalThis, "process");
  let result: { svg: string | null; diagnostics: { severity: string }[] } | undefined;
  let thrown: unknown;
  try {
    result = await compile(src);
  } catch (error) {
    thrown = error;
  } finally {
    globalThis.process = realProcess;
  }

  assert.equal(thrown, undefined, `bundle must not throw without a Node global: ${thrown}`);
  assert.ok(result?.svg, "expected non-null svg output");
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "expected zero error diagnostics",
  );
});

/**
 * The page's own inline module has to *parse*, or the browser stops before it
 * ever imports the engine and every visitor gets "loading engine…" for ever.
 *
 * Nothing else here catches that. The bundle test loads the bundle, and the
 * writeback tests lift one marked region out of the page — a syntax error a few
 * lines outside it leaves both green and the page dead. Shipped exactly that
 * way once: an escaped apostrophe lost its backslash, the string ran to the end
 * of the line, and the page never ran a statement.
 *
 * `new Function` compiles without executing, which is the whole check: no DOM,
 * no imports resolved, just "would the browser accept this".
 */
test("the playground page's inline module parses", () => {
  const html = readFileSync(join(ROOT, "playground/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, "expected an inline module in the page");
  for (const [, body] of scripts) {
    // Its `import` statements are legal only in a module, so they are dropped —
    // the rest of the body is what a typo lands in. Line-wise rather than by
    // regex: the stripping must not itself be the thing that is subtly wrong.
    const withoutImports = body
      .split("\n")
      .map((line) => (line.trimStart().startsWith("import ") ? "" : line))
      .join("\n");
    assert.doesNotThrow(
      () => new Function(withoutImports),
      "the page's inline module does not parse — the browser would stop before loading the engine",
    );
  }
});

// ---------- drag writeback ----------

/**
 * Lifts the page's own writeback functions out of `index.html` and into a
 * module, so the round-trip below tests the code that actually ships rather
 * than a copy of it that can drift.
 */
async function pageWriteback(): Promise<{
  writeOffset: (source: string, box: Record<string, unknown>, dx: number, dy: number) => string;
  writeSide: (source: string, box: Record<string, unknown>, side: string) => string;
  writeResize: (
    source: string,
    box: Record<string, unknown>,
    delta: { dw: number; dh: number; dx: number; dy: number },
  ) => string;
  stripFlowHints: (source: string) => string;
}> {
  const html = readFileSync(join(ROOT, "playground/index.html"), "utf8");
  const start = html.indexOf("// #region drag-writeback");
  const end = html.indexOf("// #endregion drag-writeback");
  assert.ok(start >= 0 && end > start, "the drag-writeback markers are gone from the playground");
  const source = html.slice(start, end);
  for (const name of [
    "braceIndex",
    "insertInBlock",
    "spliceSpan",
    "writeSide",
    "readSpan",
    "writeOffset",
    "writeResize",
    "stripFlowHints",
  ])
    assert.ok(source.includes(`function ${name}(`), `\`${name}\` left the marked region`);
  return import(
    `data:text/javascript,${encodeURIComponent(
      `${source}\nexport { writeOffset, writeSide, writeResize, stripFlowHints };`,
    )}`
  );
}

const DRAG_SRC = `diagram application "t"
actor-group G "Actors" {
  actor USER "User"
}
application APP "App" {
  module M1 "Mod one"
}
USER -> M1 : "Request"
`;

test("a drag writes DSL the parser reads back as the same offset", async () => {
  const { writeOffset } = await pageWriteback();
  const { parse } = await import("../src/parser.ts");
  const moduleOf = (src: string) => parse(src).model.elements[1].children[0];

  // No body yet: the drag has to open one.
  const opened = writeOffset(DRAG_SRC, { id: "M1", what: "element", line: 6 }, 40, -20);
  assert.equal(parse(opened).diags.filter((d) => d.severity === "error").length, 0);
  assert.deepEqual(moduleOf(opened).offset?.dx, 40);
  assert.deepEqual(moduleOf(opened).offset?.dy, -20);

  // Dragging again adds to what is there instead of replacing it, which is what
  // makes a series of small corrections behave the way a mouse implies.
  const span = moduleOf(opened).offset!.span;
  const again = writeOffset(opened, { id: "M1", what: "element", offsetSpan: span }, -15, 5);
  assert.equal(moduleOf(again).offset?.dx, 25);
  assert.equal(moduleOf(again).offset?.dy, -15);

  // A flow label with no inline block, then one that already has a style block.
  const labelled = writeOffset(DRAG_SRC, { id: "F01", what: "label", line: 8 }, 12, -6);
  assert.deepEqual(parse(labelled).model.flows[0].labelOffset?.dx, 12);
  // And a second drag on the same label adds to it rather than clobbering the key.
  const labelSpan = parse(labelled).model.flows[0].labelOffset!.span;
  const twice = writeOffset(labelled, { id: "F01", what: "label", offsetSpan: labelSpan }, 3, 3);
  assert.equal(parse(twice).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(parse(twice).model.flows[0].labelOffset?.dx, 15);
  assert.equal(parse(twice).model.flows[0].labelOffset?.dy, -3);
  // One run of a route, which rides the same inline block under its own key.
  const runsOf = (src: string) => parse(src).model.flows[0].segmentOffsets ?? [];
  const slid = writeOffset(DRAG_SRC, { id: "F01", what: "segment", segment: 2, line: 8 }, 0, -18);
  assert.equal(parse(slid).diags.filter((d) => d.severity === "error").length, 0);
  assert.deepEqual(
    runsOf(slid).map((entry) => [entry.segment, entry.delta]),
    [[2, -18]],
  );

  // Sliding the same run again adds to its delta and leaves the run number
  // alone — the first number names the run, it is not part of the nudge.
  const runSpan = runsOf(slid)[0].span;
  const slidTwice = writeOffset(
    slid,
    { id: "F01", what: "segment", segment: 2, offsetSpan: runSpan },
    0,
    4,
  );
  assert.deepEqual(
    runsOf(slidTwice).map((entry) => [entry.segment, entry.delta]),
    [[2, -14]],
  );

  // A second run of the same flow gets its own key rather than overwriting the
  // first: one flow can need two of its runs moved.
  const twoRuns = writeOffset(
    slidTwice,
    { id: "F01", what: "segment", segment: 4, line: 8 },
    12,
    0,
  );
  assert.equal(parse(twoRuns).diags.filter((d) => d.severity === "error").length, 0);
  assert.deepEqual(
    runsOf(twoRuns).map((entry) => [entry.segment, entry.delta]),
    [
      [2, -14],
      [4, 12],
    ],
  );

  // Both kinds of nudge on one flow: sliding a run must not clobber the label's.
  const bothKeys = writeOffset(twoRuns, { id: "F01", what: "label", line: 8 }, 12, -6);
  assert.equal(parse(bothKeys).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(runsOf(bothKeys).length, 2);
  assert.equal(parse(bothKeys).model.flows[0].labelOffset?.dx, 12);

  const styled = DRAG_SRC.replace(
    'USER -> M1 : "Request"',
    'USER -> M1 : "Request" { stroke: dashed }',
  );
  const both = writeOffset(styled, { id: "F01", what: "label", line: 8 }, 12, -6);
  assert.equal(parse(both).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(parse(both).model.flows[0].labelOffset?.dy, -6);
  assert.equal(parse(both).model.flows[0].style?.stroke?.style, "dashed");

  // Body shapes an element declaration can already have. A one-line body is the
  // shape that broke in the playground: it took the "no body" path and appended
  // a second `{ … }` block, which is a syntax error, not a body.
  const BODIES: [string, string][] = [
    ["no body", 'application X "IHM SIET\\nPCC"'],
    ["one-line body", 'application X "IHM SIET\\nPCC" {logo: angular }'],
    ["open at end of line", 'application X "IHM SIET\\nPCC" {\n  logo: angular\n}'],
    ["label holding a brace", 'application X "IHM {SIET}" {logo: angular }'],
  ];
  for (const [shape, declaration] of BODIES) {
    const source = `diagram application "t"\n${declaration}\nmodule Y "Y"\nY -> X : "Request"\n`;
    const written = writeOffset(source, { id: "X", what: "element", line: 2 }, -167, 47);
    const reparsed = parse(written);
    assert.equal(
      reparsed.diags.filter((d) => d.severity === "error").length,
      0,
      `${shape}: ${JSON.stringify(written)}`,
    );
    // Whitespace is asserted, not just re-parsability: `47logo` lexes as two
    // tokens by luck, and source that leans on that is a lexer change away from
    // being corrupt.
    assert.match(written, /offset: -167, 47(\s|$)/, shape);
    const element = reparsed.model.elements.find((e) => e.id === "X")!;
    assert.equal(element.offset?.dx, -167, shape);
    assert.equal(element.offset?.dy, 47, shape);
    if (declaration.includes("angular")) assert.equal(element.logo?.value, "angular", shape);
  }

  // A label may itself contain a brace, and the inline block is the one after it.
  const braced = DRAG_SRC.replace('"Request"', '"step {1}"');
  const written = writeOffset(braced, { id: "F01", what: "label", line: 8 }, 12, -6);
  assert.equal(parse(written).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(parse(written).model.flows[0].label, "step {1}", "the label was rewritten");
  assert.equal(parse(written).model.flows[0].labelOffset?.dx, 12);
});

test("dragging a flow end writes the `ID.side` the DSL already has", async () => {
  const { writeSide } = await pageWriteback();
  const { parse } = await import("../src/parser.ts");
  const flowOf = (src: string) => parse(src).model.flows[0];

  /** The box the page builds from `compile()`'s `boxes` for one end of a flow. */
  const handle = (src: string, end: "from" | "to") => {
    const flow = flowOf(src);
    const declared = end === "from" ? flow.fromSide : flow.toSide;
    return {
      id: flow.id,
      what: "terminal",
      endpoint: {
        end,
        element: end === "from" ? flow.from : flow.to,
        side: declared?.value,
        span: declared?.span ?? (end === "from" ? flow.fromSpan : flow.toSpan),
      },
    };
  };

  // No side declared: the endpoint's id takes an `ID.side` in its place.
  const pinned = writeSide(DRAG_SRC, handle(DRAG_SRC, "from"), "top");
  assert.equal(parse(pinned).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(flowOf(pinned).fromSide?.value, "top");
  assert.equal(flowOf(pinned).from, "USER", "the endpoint still names its element");

  // Declared already: only the side word is replaced, never appended to.
  const moved = writeSide(pinned, handle(pinned, "from"), "left");
  assert.equal(parse(moved).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(flowOf(moved).fromSide?.value, "left");
  assert.match(moved, /USER\.left -> M1/);

  // The far end, on a line the near end has already lengthened — the spans are
  // re-read from the rewritten source, which is what the page does on every render.
  const both = writeSide(moved, handle(moved, "to"), "bottom");
  assert.equal(parse(both).diags.filter((d) => d.severity === "error").length, 0);
  assert.equal(flowOf(both).fromSide?.value, "left");
  assert.equal(flowOf(both).toSide?.value, "bottom");
  assert.equal(flowOf(both).to, "M1");
});

const RESIZE_SRC = `diagram logical "t"
system SYS "My system" {
  layer FRONT "Front office" {
    block PORTAL "Portal"
  }
}
actor-group G "Actors" {
  actor USER "User"
}
USER -> PORTAL "Signs in"
`;

test("a resize writes DSL the parser reads back as the same size", async () => {
  const { writeResize } = await pageWriteback();
  const { parse } = await import("../src/parser.ts");
  const systemOf = (src: string) => parse(src).model.elements[0];
  const clean = (src: string) =>
    assert.equal(parse(src).diags.filter((d) => d.severity === "error").length, 0, src);

  // An east or south grip changes the extent and nothing else. The container's
  // body is already open, so the statement goes on its own indented line.
  const grown = writeResize(RESIZE_SRC, { id: "SYS", line: 2 }, { dw: 120, dh: 40, dx: 0, dy: 0 });
  clean(grown);
  assert.equal(systemOf(grown).size?.dw, 120);
  assert.equal(systemOf(grown).size?.dh, 40);
  assert.match(grown, /\n {2}size: 120, 40(\s|$)/, "written the way the DSL is written by hand");

  // Dragging again adds to what is there, like every other hint.
  const again = writeResize(
    grown,
    { id: "SYS", sizeSpan: systemOf(grown).size!.span },
    { dw: -20, dh: 10, dx: 0, dy: 0 },
  );
  clean(again);
  assert.equal(systemOf(again).size?.dw, 100);
  assert.equal(systemOf(again).size?.dh, 50);

  // A north or west grip moves the corner as well, so one gesture writes both
  // hints — and the two must not land on top of each other.
  const both = writeResize(RESIZE_SRC, { id: "SYS", line: 2 }, { dw: 30, dh: 0, dx: -30, dy: 0 });
  clean(both);
  assert.equal(systemOf(both).size?.dw, 30, "the extent");
  assert.equal(systemOf(both).offset?.dx, -30, "and the corner that came with it");

  // Re-dragging that pair rewrites both spans. They sit on one line, so the
  // later one has to be replaced first or the second splice lands inside the
  // first — which is the bug this ordering exists to prevent.
  const parsed = systemOf(both);
  const redragged = writeResize(
    both,
    { id: "SYS", sizeSpan: parsed.size!.span, offsetSpan: parsed.offset!.span },
    { dw: 5, dh: 0, dx: -5, dy: 0 },
  );
  clean(redragged);
  assert.equal(systemOf(redragged).size?.dw, 35);
  assert.equal(systemOf(redragged).offset?.dx, -35);

  // Every body shape a container declaration can have, the same four the offset
  // writeback is held to.
  const BODIES: [string, string][] = [
    ["open at end of line", 'system X "IHM SIET\\nPCC" {\n  block B "B"\n}'],
    ["one-line body", 'system X "IHM SIET\\nPCC" { block B "B" }'],
    ["label holding a brace", 'system X "IHM {SIET}" { block B "B" }'],
  ];
  for (const [shape, declaration] of BODIES) {
    const source = `diagram logical "t"\n${declaration}\nactor-group G "g" { actor A "a" }\nA -> B "Request"\n`;
    const written = writeResize(source, { id: "X", line: 2 }, { dw: -167, dh: 47, dx: 0, dy: 0 });
    clean(written);
    // Whitespace is asserted, not just re-parsability: `47block` lexes as two
    // tokens by luck, and source that leans on that is one lexer change from
    // being corrupt.
    assert.match(written, /size: -167, 47(\s|$)/, shape);
    const element = parse(written).model.elements.find((e) => e.id === "X")!;
    assert.equal(element.size?.dw, -167, shape);
    assert.equal(element.size?.dh, 47, shape);
    assert.equal(element.children[0]?.id, "B", `${shape}: the children survived`);
  }
});

/**
 * Lifts the page's grip geometry out of `index.html`, the same way the writeback
 * is lifted — this is the arithmetic that has to agree with the engine's clamp,
 * so it is tested against the engine's own bounds rather than hand-written ones.
 */
async function pageGeometry(): Promise<{
  GRIP_NAMES: string[];
  gripPoint: (box: Box, grip: string) => { x: number; y: number };
  resized: (box: Box, grip: string, dx: number, dy: number) => Box;
}> {
  const html = readFileSync(join(ROOT, "playground/index.html"), "utf8");
  const start = html.indexOf("// #region resize-geometry");
  const end = html.indexOf("// #endregion resize-geometry");
  assert.ok(start >= 0 && end > start, "the resize-geometry markers are gone from the playground");
  const source = html.slice(start, end);
  return import(
    `data:text/javascript,${encodeURIComponent(
      `${source}\nexport { GRIP_NAMES, gripPoint, resized };`,
    )}`
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  resize?: { minWidth: number; minHeight: number };
}

test("a resize grip pulls the face it is on and anchors the opposite one", async () => {
  const { GRIP_NAMES, gripPoint, resized } = await pageGeometry();
  // Room to move in every direction, so this case is about the arithmetic alone.
  const box: Box = {
    x: 100, y: 50, width: 200, height: 100,
    resize: { minWidth: 20, minHeight: 20 },
  };
  assert.deepEqual(GRIP_NAMES, ["nw", "n", "ne", "w", "e", "sw", "s", "se"]);
  assert.deepEqual(gripPoint(box, "nw"), { x: 100, y: 50 });
  assert.deepEqual(gripPoint(box, "se"), { x: 300, y: 150 });
  assert.deepEqual(gripPoint(box, "n"), { x: 200, y: 50 });

  // East and south move the far face: the box grows, the corner stays.
  assert.deepEqual(resized(box, "e", 40, 999), { what: "element", x: 100, y: 50, width: 240, height: 100 });
  assert.deepEqual(resized(box, "s", 999, 30), { what: "element", x: 100, y: 50, width: 200, height: 130 });
  // West and north move the near face: dragging *left* makes it wider and moves
  // the corner by exactly what it won, so the far edge holds still.
  const west = resized(box, "w", -40, 0);
  assert.deepEqual(west, { what: "element", x: 60, y: 50, width: 240, height: 100 });
  assert.equal(west.x + west.width, box.x + box.width, "the east edge is the anchor");
  const north = resized(box, "n", 0, -30);
  assert.equal(north.y, 20);
  assert.equal(north.y + north.height, box.y + box.height, "the south edge is the anchor");
  // A corner pulls both axes at once.
  assert.deepEqual(resized(box, "nw", -10, -20), { what: "element", x: 90, y: 30, width: 210, height: 120 });
  // A side grip never touches the other axis, whatever the pointer did.
  for (const [grip, axis] of [["n", "width"], ["s", "width"], ["e", "height"], ["w", "height"]] as const)
    assert.equal(resized(box, grip, 77, 77)[axis], box[axis], `${grip} must not change ${axis}`);

  // The floor is the engine's, not a rule re-derived here: a pull past it stops
  // there, and the anchored edge still holds.
  const tight: Box = { ...box, resize: { minWidth: 180, minHeight: 90 } };
  assert.equal(resized(tight, "e", -999, 0).width, 180, "held at its own children");
  const heldWest = resized(tight, "w", 999, 0);
  assert.equal(heldWest.width, 180);
  assert.equal(heldWest.x + heldWest.width, box.x + box.width, "floored, and still anchored east");
  // And nothing stops it growing: a container dragged past its parent is not cut
  // back, the parent grows with it.
  assert.equal(resized(tight, "e", 5000, 0).width, 5200);
  assert.equal(resized(tight, "w", -5000, 0).width, 5200);
});

test("the playground's floor is the engine's, to the pixel", async () => {
  const { resized } = await pageGeometry();
  const { compile } = await import("../src/compile.ts");
  const source = `diagram logical "t"
system SYS "My system" {
  layer FRONT "Front office" {
    block PORTAL "Portal"
  }
}
actor-group G "Actors" {
  actor USER "User"
}
USER -> PORTAL "Signs in"
`;
  const boxOf = (result: { boxes: unknown[] | null }, id: string) =>
    (result.boxes as { id: string; what: string; [k: string]: unknown }[]).find(
      (b) => b.id === id && b.what === "element",
    ) as unknown as Box & { id: string };

  const plain = await compile(source);
  const front = boxOf(plain, "FRONT");
  // What a grip dragged 400px right would leave, per the page…
  const promised = resized(front, "e", 400, 0);
  // …and what the engine actually draws for the `size:` that drag would write.
  const written = source.replace(
    'layer FRONT "Front office" {',
    `layer FRONT "Front office" { size: ${promised.width - front.width}, 0`,
  );
  const rendered = await compile(written);
  const drawn = boxOf(rendered, "FRONT");
  assert.equal(
    drawn.width,
    promised.width,
    "the ghost promised a width the engine refused to draw",
  );
  // That drag takes the layer well past the system around it, which is the case
  // the ghost used to over-promise on: the engine clamped the child back and the
  // resize did nothing. The parent grows instead.
  const parent = boxOf(rendered, "SYS");
  assert.ok(
    parent.x + parent.width >= drawn.x + drawn.width,
    "the parent must have grown to hold the resized layer",
  );
});

test("resetting the flows drops their hints and keeps the container dispositions", async () => {
  const { stripFlowHints } = await pageWriteback();
  const { parse } = await import("../src/parser.ts");

  const source = [
    'diagram logical "t"',
    'actor-group G "Actors" {',
    '  actor USER "User"',
    "}",
    'system SYS "My system" {',
    "  size: 120, 40",
    '  layer FRONT "Front office" {',
    "    offset: 10, -5",
    '    block PORTAL "Portal"',
    "  }",
    "}",
    'USER -> PORTAL "Signs in" { segment-offset: 2, -18 segment-offset: 4, 12 }',
    'USER -> FRONT "Consults" { label-offset: 12, -6 stroke: dashed }',
    'PORTAL -> USER "Answers" { stroke: dotted }',
  ].join("\n");

  const cleared = stripFlowHints(source);
  const model = parse(cleared).model;
  assert.equal(parse(cleared).diags.filter((d) => d.severity === "error").length, 0, cleared);

  // Every flow hint is gone, both keys and both entries of the repeated one.
  assert.deepEqual(
    model.flows.map((flow) => [flow.segmentOffsets?.length ?? 0, flow.labelOffset ? 1 : 0]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
  // The container dispositions are what the author is keeping — only the flows
  // drawn for the *old* ones are stale.
  const system = model.elements.find((e) => e.id === "SYS")!;
  assert.equal(system.size?.dw, 120, "`size:` survives");
  assert.equal(system.size?.dh, 40);
  assert.equal(system.children[0].offset?.dx, 10, "and so does `offset:`");

  // Anything else sharing the inline block stays, and a block emptied by the
  // strip goes rather than being left as `{  }`.
  assert.equal(model.flows[1].style?.stroke?.style, "dashed", "a sibling property is untouched");
  assert.equal(model.flows[2].style?.stroke?.style, "dotted", "a flow with no hint is untouched");
  assert.match(cleared, /USER -> PORTAL "Signs in"$/m, "the emptied block went with the hints");
  assert.doesNotMatch(cleared, /\{\s*\}/, "no empty block is left behind");

  // A label that merely reads like a hint is text, not a hint.
  const labelled = 'diagram logical "t"\nA -> B "label-offset: 1, 2"\n';
  assert.equal(stripFlowHints(labelled), labelled, "a quoted label is not a hint");

  // And a source with nothing to clear comes back identical, which is what the
  // button reads to tell you it did nothing.
  const plain = 'diagram logical "t"\nA -> B "Plain"\n';
  assert.equal(stripFlowHints(plain), plain);
});

test("a second resize drag continues from the size the drawing shows", async () => {
  const { writeResize } = await pageWriteback();
  const { parse } = await import("../src/parser.ts");
  const { compile } = await import("../src/compile.ts");

  // A `size:` well past the floor, so the engine cuts it short and the number in
  // the source stops describing the box on screen.
  const source = `diagram logical "t"
actor-group G "Actors" {
  actor USER "User"
}
system SYS "My system" {
  size: -4000, 0
  layer FRONT "Front office" {
    block PORTAL "Portal"
  }
}
G -> PORTAL "Signs in"
`;
  const boxOf = (result: { boxes: unknown[] | null }, id: string) =>
    (result.boxes as Record<string, unknown>[]).find(
      (b) => b.id === id && b.what === "element",
    ) as unknown as Box & { sizeApplied?: { dw: number; dh: number }; sizeSpan?: unknown };

  const clamped = await compile(source);
  const sys = boxOf(clamped, "SYS");
  assert.ok(sys.sizeApplied, "the box reports what the hint came to");
  assert.notEqual(sys.sizeApplied!.dw, -4000, "and it is not what the hint said");

  // Widen it by 30. Continuing from the written -4000 would write -3970, which
  // the floor swallows again: the drag would do nothing, and so would the next.
  const widened = writeResize(source, sys as unknown as Record<string, unknown>, {
    dw: 30,
    dh: 0,
    dx: 0,
    dy: 0,
  });
  assert.equal(parse(widened).diags.filter((d) => d.severity === "error").length, 0, widened);
  assert.equal(
    parse(widened).model.elements[1].size?.dw,
    sys.sizeApplied!.dw + 30,
    "the new hint continues from the applied delta",
  );
  const after = boxOf(await compile(widened), "SYS");
  assert.equal(after.width, sys.width + 30, "so the box actually grows by the drag");
});
