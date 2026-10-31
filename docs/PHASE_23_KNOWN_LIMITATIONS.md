# UrjaSetu EMS — Phase 23: Known Accessibility & Usability Limitations

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Scope:** Transparent Accounting of Unresolved Accessibility Constraints & Future Work  

---

## 1. Automated Testing & JSDOM Limitations

In compliance with Core Invariant 6, uncertain or unverifiable claims are explicitly disclosed:
1. **Color Contrast Computation in Headless Testing**: JSDOM does not compute CSS layout geometry or render font pixels. While design tokens are mathematically verified (e.g., `#0e1726` on `#f4f6f9` achieves 16.2:1 contrast), automated axe-core tests run inside JSDOM cannot evaluate computed contrast dynamically.
2. **Absence of Real-User Screen Reader Audits**: While semantic HTML5 landmarks, ARIA roles, and polite live regions have been implemented and verified via automated test suites, testing with real screen-reader users (NVDA on Windows, JAWS, or VoiceOver on macOS/iOS) has not yet been performed by an independent third party.

---

## 2. Interactive Canvas Map Constraints

1. **MapLibre GL / WebGL Tiles**: The interactive GIS map on `/map` renders map tiles using HTML5 Canvas / WebGL. Assistive technologies cannot traverse individual geographic polygon shapes on a raw WebGL canvas.
2. **Mitigation Provided**: UrjaSetu provides a parallel **Properties List View** (`/properties`) and **District Exploration Table** containing identical telemetry, addresses, solar potential, and billing histories in accessible HTML semantic tables.

---

## 3. Dynamic Vector Chart Complexity

1. **Plotly Canvas Graphs**: High-density 15-minute time-series graphs (e.g. 96-interval diurnal load curves) present cognitive and spatial navigation challenges for screen-reader users who must tab through individual points.
2. **Mitigation Provided**: Every time-series graph provides an accessible markdown/tabular alternative generated via `AccessibleTableGenerator` summarizing the data in clear, semantic table rows with explicit headers.

---

## 4. Multi-Lingual & Voice Interface Scope

1. **Language Scope**: The current interface and plain-language glossary are implemented in English.
2. **Future Accessibility Target**: Native localization into regional Indian languages (Kannada, Telugu, Hindi, Tamil, Gujarati) and voice-driven Copilot interactions are cataloged as high-priority post-pilot enhancements.
