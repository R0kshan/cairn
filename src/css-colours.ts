/**
 * Recognises the colour syntaxes cairn will copy into an SVG attribute
 * unaltered. Split out of `theme-spec.ts` so that file stays about validating a
 * theme's *shape*, with the vocabulary of colour names living beside its own
 * explanation rather than as 150 lines of data in the middle of the merge logic.
 *
 * Deliberately free of Node imports, for the same reason `theme-spec.ts` is:
 * the npm package's `.` export is bundled from the browser entry.
 */

/**
 * Hex and the `rgb()`/`hsl()` functions — every colour form that carries its own
 * numbers rather than naming one.
 *
 * The newer functional syntaxes (`lab()`, `oklch()`, `color()`) are not here.
 * Accepting one is a matter of extending this pattern, but each also has to be
 * a colour every target renderer understands, which is a wider question than
 * this module answers.
 */
const NUMERIC_COLOUR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/-]+\))$/i;

/**
 * Every CSS `<named-color>` (Color Level 4), plus the two colour-valued keywords
 * that are not named colours: `transparent`, and `currentColor` for a fill that
 * follows the inherited text colour.
 *
 * Spelled out rather than approximated by `/^[a-z]+$/`, which accepts `dakgrey`
 * as readily as `darkgrey`. An unrecognised keyword is not an error the renderer
 * can raise later — an SVG presentation attribute it cannot parse is *ignored*,
 * so the shape falls back to black and the diagram is produced without a
 * complaint. Naming the key at load time is the only chance to catch that typo.
 */
const COLOUR_KEYWORDS: ReadonlySet<string> = new Set([
  "currentcolor",
  "transparent",
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
]);

/**
 * Whether `value` is a colour cairn can emit. Keywords are matched
 * case-insensitively because CSS matches them that way — `currentColor` is the
 * spelling every stylesheet uses, and `WhiteSmoke` is the same colour as
 * `whitesmoke`.
 *
 * Not a security boundary: the renderer escapes attributes either way. This
 * exists so a mistyped colour fails at load time, naming the key, rather than
 * rendering black.
 */
export const isColour = (value: string): boolean =>
  NUMERIC_COLOUR.test(value) || COLOUR_KEYWORDS.has(value.toLowerCase());
