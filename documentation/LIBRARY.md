# Using cairn as a library

The engine is published as [`@r0kshan/cairn`](https://www.npmjs.com/package/@r0kshan/cairn). One ESM module runs in the browser (Vite, webpack, esbuild…) and in Node, has zero dependencies (elkjs is inlined), and ships its TypeScript declarations.

```sh
npm install @r0kshan/cairn@unstable
```

## In the browser

With any bundler (Vite shown):

```ts
// Lazy import: the module inlines elkjs (~3.6 MB unminified), so load it when a diagram is needed.
const { compile, matrixCsv } = await import("@r0kshan/cairn");

const source = document.querySelector<HTMLTextAreaElement>("#source")!.value;
const { svg, diagnostics, matrix } = await compile(source, { theme: "dark", matrix: true });

if (svg) document.querySelector("#diagram")!.innerHTML = svg;   // null when the source has errors
for (const d of diagnostics) console.warn(d.code, d.message);

if (matrix) {                                                   // same bytes as `cairn matrix`
  const csv = new Blob([matrixCsv(matrix)], { type: "text/csv" });
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(csv), download: "flows.csv" });
  link.click();
}
```

## In Node

The same import works unchanged:

```ts
import { compile } from "@r0kshan/cairn";
```

## Errors and options

- `compile(source, options?)` never throws on a bad diagram: errors come back in `diagnostics` (see [`DIAGNOSTICS.md`](./DIAGNOSTICS.md)) and `svg` is `null`.
- It throws `ThemeSpecError` only for a malformed custom `theme` object.
- Logos given as file paths need their `data:` URIs passed in `options.logos`, since the engine does no filesystem work.
- The API is pre-1.0: expect it to move with the grammar until v1.0.0.
