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

/** A CSS `<number>`: optional sign, and the point on either side — `.5`, `5.`, `-1.25`. */
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;

/** An `rgb()` channel, or either function's alpha: a number or a percentage. */
const AMOUNT = `${NUMBER}%?`;

/** `hsl()` leads with an angle, whose unit is optional and defaults to degrees. */
const ANGLE = `${NUMBER}(?:deg|grad|rad|turn)?`;

/**
 * One colour function in both spellings CSS accepts: the legacy comma-separated
 * form (`rgb(0, 0, 0, .5)`) and the modern space-separated one that puts alpha
 * behind a slash (`rgb(0 0 0 / 50%)`).
 *
 * They are separate alternatives rather than one pattern loose enough to cover
 * both, because CSS does not let an author mix them: `rgb(0, 0 0)` is not a
 * colour, and a check that spelled the separator as "comma or space" would read
 * it as one.
 */
const colourFunction = (name: string, lead: string): string => {
  const commas = `${lead}\\s*,\\s*${AMOUNT}\\s*,\\s*${AMOUNT}(?:\\s*,\\s*${AMOUNT})?`;
  const spaces = `${lead}\\s+${AMOUNT}\\s+${AMOUNT}(?:\\s*/\\s*${AMOUNT})?`;
  return `${name}a?\\(\\s*(?:${commas}|${spaces})\\s*\\)`;
};

/**
 * Hex and the `rgb()`/`hsl()` functions — every colour form that carries its own
 * numbers rather than naming one.
 *
 * Matches the grammar rather than the alphabet. A pattern that only asked for
 * plausible characters would accept `rgb(,)` and `hsl(---)`, which reach a
 * renderer as an attribute it cannot parse — the same silent failure an
 * unrecognised keyword causes, and the one this module exists to catch.
 *
 * The newer functional syntaxes (`lab()`, `oklch()`, `color()`) are not here.
 * Accepting one is a matter of extending this pattern, but each also has to be
 * a colour every target renderer understands, which is a wider question than
 * this module answers.
 */
const NUMERIC_COLOUR = new RegExp(
  `^(?:${HEX}|${colourFunction("rgb", AMOUNT)}|${colourFunction("hsl", ANGLE)})$`,
  "i",
);

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
