# UrjaSetu EMS — Phase 23: Design System & Visual Standards

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Design Philosophy:** "A serious instrument, not a toy" — High Contrast, Tabular Numbers & Honest Provenance Tones  

---

## 1. Design Token Architecture

UrjaSetu EMS uses semantic CSS variables designed for high-contrast legibility across both Light and Dark themes.

### Light Theme (`:root`)
```css
:root {
  color-scheme: light;
  --bg: #f4f6f9;             /* Page background (light neutral) */
  --surface: #ffffff;        /* Primary card surface */
  --surface-2: #eaeef4;      /* Secondary interactive surface / hover */
  --ink: #0e1726;            /* Primary typography (contrast 16.2:1 against --bg) */
  --muted: #4d5b73;          /* Secondary typography (contrast 5.8:1 against --bg) */
  --line: #d3dae5;           /* Border separators */
  --accent: #0b6b57;         /* Deep emerald primary brand accent */
  --accent-ink: #ffffff;     /* Contrast text on accent */
  --focus: #1d4fb3;          /* High-visibility cobalt blue focus ring */
}
```

### Dark Theme (`:root[data-theme="dark"]`)
```css
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0b1017;             /* Dark slate background */
  --surface: #121923;        /* Dark card surface */
  --surface-2: #1a2330;      /* Dark interactive surface */
  --ink: #e8eef7;            /* Light typography (contrast 15.8:1 against --bg) */
  --muted: #9fb0c7;          /* Secondary typography (contrast 7.2:1 against --bg) */
  --line: #2a3546;           /* Subtle border lines */
  --accent: #3fd0a9;         /* Vibrant mint green accent */
  --accent-ink: #04251d;     /* High-contrast ink on dark accent */
  --focus: #8db4ff;          /* High-visibility sky blue focus ring */
}
```

---

## 2. Honest Data Provenance Tone Palette

Every value's provenance is encoded with a paired foreground and background token meeting WCAG AA contrast ($\ge 4.5:1$):

| Data Status | Light Foreground / Background | Dark Foreground / Background | Meaning & Provenance |
| :--- | :--- | :--- | :--- |
| `live` | `#0a6b3b` / `#d9f3e4` | `#6ee7a3` / `#0f3a24` | Real-time meter telemetry |
| `updated` | `#8a5200` / `#fbe9c6` | `#fbbf4d` / `#3d2a06` | Historical official report |
| `forecast` | `#1d4fb3` / `#dbe7ff` | `#8db4ff` / `#14284f` | Machine learning forecast |
| `estimated` | `#6b3fb3` / `#ebe1fa` | `#c4a4ff` / `#2a1c4d` | Mathematical estimate |
| `simulated` | `#0c6a77` / `#d6f0f3` | `#6fd6e4` / `#0b3a42` | What-if digital twin run |
| `demo` | `#a1286a` / `#fadcec` | `#ff9ccd` / `#4a1633` | Demo sandbox dataset |
| `reference` | `#465267` / `#e4e9f0` | `#aeb9cb` / `#26303f` | Regulatory gazette citation |
| `unavailable` | `#a12a2a` / `#fadcdc` | `#ff9a9a` / `#4a1a1a` | Missing observation / failed |

---

## 3. Typography & Tabular Numerals

### Font Families
- **Sans-Serif (Body & Headings)**: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Monospace (Code & IDs)**: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

### Tabular Numerals Invariant (`.num`)
In an energy and billing dashboard, fluctuating numbers must never jitter as values update:
```css
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```
All kilowatt-hour figures, rupee amounts, power factors, and timestamps enforce the `.num` class.

---

## 4. Interactive Components & Focus Visibility

### Focus Ring Standard
WCAG 2.2 AA (2.4.7) requires an unambiguous focus indicator:
```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

### Buttons & Form Controls
- `.btn`: Base button with 44px touch target height, distinct hover background (`--surface-2`), and disabled opacity (0.55).
- `.btn-primary`: High-contrast brand action button (`--accent` with `--accent-ink`).
- `.field`: Full-width input control with persistent border (`--line`) and clear focus states.

---

## 5. Reduced Motion Safety

UrjaSetu respects user OS preferences for reduced motion:
```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```
Flashing animations, automated carousel autoplay, and decorative motion that hinders task completion are strictly prohibited.
