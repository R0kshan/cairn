# Theme showcase

The same application-view diagram rendered in every built-in theme, so you can
compare them side by side. Select a theme in your own diagrams with:

```
style { theme: <name> }
```

| Theme | Notes |
|---|---|
| `light` | Modern professional — the default. Crisp white, harmonised hues. |
| `dark` | Refined dark slate. |
| `slate` | Cool neutral, low-key blue-greys. |
| `sand` | Warm, earthy — good for print. |
| `contrast` | High-contrast, colourblind-safe, AA text — projection / accessibility. |
| `nord` | Nord palette (polar night + frost/aurora). |
| `solarized` | Solarized light. |
| `classic` | The original Cairn palette (pre-theme look), preserved exactly. |
| `classic-dark` | The original dark palette. |

All themes keep the same hue *roles* (actor → blue, system → amber, external →
violet, datastore → purple, network zone → green, …), so a diagram stays
recognisable when you switch themes. Kinds also stay distinct in grayscale via
stroke weight, dash pattern and shape, so diagrams still read when printed B&W.

Retint the flows on top of any theme with an accent:

```
style { theme: nord  accent: #17876b }
```
