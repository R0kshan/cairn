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
 * The digit counts CSS defines. The lengths between them are not "nearly right"
 * — `#12345` is a typo for one of its neighbours, and a renderer discards it as
 * readily as it discards a misspelt word.
 */
const HEX = "#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})";

/**
 * A CSS `<number>`: optional sign, the point on either side of the digits, and
 * the base-ten exponent CSS allows on all of them — `.5`, `5.`, `-1.25`, `1e2`.
 */
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;

/** A `<percentage>`, which is a number wearing a `%`. */
const PERCENT = `${NUMBER}%`;

/** Either of the two, which is what a modern channel and every alpha accept. */
const AMOUNT = `${NUMBER}%?`;

/** `hsl()` leads with an angle, whose unit is optional and defaults to degrees. */
const ANGLE = `${NUMBER}(?:deg|grad|rad|turn)?`;

/**
 * The legacy comma-separated argument list — `rgb(0, 0, 0, .5)`. Each component
 * is spelled out rather than shared, because CSS constrains them differently
 * here than it does in the modern form.
 *
 * Alpha is an `<alpha-value>` in both forms, so it stays an `AMOUNT` throughout:
 * a number or a percentage, whatever the channels ahead of it are.
 */
const commaForm = (first: string, second: string, third: string): string =>
  `${first}\\s*,\\s*${second}\\s*,\\s*${third}(?:\\s*,\\s*${AMOUNT})?`;

/**
 * The modern space-separated list, which puts alpha behind a slash —
 * `rgb(0 0 0 / 50%)`. Kept as a separate alternative rather than folded into one
 * pattern loose enough for both, because CSS does not let an author mix the
 * separators: `rgb(0, 0 0)` is not a colour, and a check that spelled the
 * separator as "comma or space" would read it as one.
 */
const spaceForm = (first: string, second: string, third: string): string =>
  `${first}\\s+${second}\\s+${third}(?:\\s*/\\s*${AMOUNT})?`;

/**
 * Legacy `rgb()` takes three numbers *or* three percentages, never a mix, so the
 * two spellings are separate alternatives — `rgb(255, 50%, 0)` is not a colour.
 * The modern form does allow the mix, and says so by using `AMOUNT` throughout.
 */
const RGB =
  `rgba?\\(\\s*(?:${commaForm(NUMBER, NUMBER, NUMBER)}` +
  `|${commaForm(PERCENT, PERCENT, PERCENT)}` +
  `|${spaceForm(AMOUNT, AMOUNT, AMOUNT)})\\s*\\)`;

/**
 * Legacy `hsl()` requires its saturation and lightness to be percentages —
 * `hsl(120, 50, 50)` is not a colour. The modern form relaxed that to accept
 * bare numbers, which is why only the comma branch insists.
 */
const HSL =
  `hsla?\\(\\s*(?:${commaForm(ANGLE, PERCENT, PERCENT)}` +
  `|${spaceForm(ANGLE, AMOUNT, AMOUNT)})\\s*\\)`;

/**
 * Hex and the `rgb()`/`hsl()` functions — every colour form that carries its own
 * numbers rather than naming one.
 *
 * Matches the grammar rather than the alphabet. A pattern that only asked for
 * plausible characters would accept `rgb(,)` and `hsl(---)`, which reach a
 * renderer as an attribute it cannot parse — the same silent failure an
 * unrecognised keyword causes, and the one this module exists to catch.
 *
 * Three things CSS accepts are deliberately absent, because each would have to
 * survive every renderer a cairn SVG is opened in, which is a wider question
 * than this module answers: the newer colour functions (`lab()`, `oklch()`,
 * `color()`), the `none` component keyword, and `var()` substitution. A theme
 * that wants one of them is rejected by name at load time, which is a loud
 * failure the author can act on — unlike the silent ones above.
 */
const NUMERIC_COLOUR = new RegExp(`^(?:${HEX}|${RGB}|${HSL})$`, "i");

/**
 * Every CSS `<named-color>` (Color Level 4), plus the two colour-valued keywords
 * that are not named colours: `transparent`, and `currentColor` for a fill that
 * follows the inherited text colour.
 *
 * Spelled out rather than approximated by `/^[a-z]+$/`, which accepts `dakgrey`
 * as readily as `darkgrey`. An unrecognised keyword is not an error the renderer
 * can raise later — SVG *ignores* a presentation attribute it cannot parse and
 * takes the property's initial value, so a bad `fill` turns the shape black and
 * a bad `stroke` erases its outline (`stroke`'s initial value is `none`), and
 * the diagram is produced without a complaint either way. Naming the key at load
 * time is the only chance to catch that typo.
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
 * silently dropping to the property's initial value in the finished SVG.
 */
export const isColour = (value: string): boolean =>
  NUMERIC_COLOUR.test(value) || COLOUR_KEYWORDS.has(value.toLowerCase());
