# UrjaSetu EMS — Phase 23: Responsive Layouts & Data Display Standards

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Scope:** Viewport Reflow (320px to 1440px), Tabular Reflow & Chart Non-Visual Alternatives  

---

## 1. Responsive Viewport Architecture

In compliance with WCAG 2.2 AA (1.4.10 Reflow), UrjaSetu EMS guarantees full task completion across all common viewport widths without requiring two-dimensional scrolling.

### Tested Breakpoints
- **Narrow Mobile (320px to 480px)**: Single-column reflow; navigation collapses to wrapped rows; full-width interactive buttons; hidden non-essential secondary labels.
- **Tablet (768px to 1024px)**: Two-column grid layouts; split filters and results; side-by-side KPI cards.
- **Laptop & Desktop (1024px to 1440px+)**: Multi-column command center grids; persistent sidebar controls; detailed time-series charts.

---

## 2. Horizontal Overflow Defense

1. **Flexible Container Constraints**: Top-level containers enforce `max-w-7xl mx-auto px-4 w-full` with `min-w-0` on flex children to prevent unintended text pushing.
2. **Long Identifier & Text Wrapping**: Telemetry hashes, correlation IDs, and file names apply `break-all` or `truncate` with full tooltips:
   ```css
   .break-anywhere {
     overflow-wrap: anywhere;
     word-break: break-word;
   }
   ```
3. **Number Column Right-Alignment**: Numeric tabular values (`.num`) align to the right with consistent character widths to avoid layout jitter during real-time data polling.

---

## 3. Accessible Non-Visual Alternatives for Visualizations

Visual charts (Plotly time-series, solar irradiance curves) cannot be parsed by screen readers or text-only browsers. UrjaSetu EMS provides dedicated alternatives:

### 3.1 Tabular Data Alternative Generator (`AccessibleTableGenerator`)
Every graphical chart widget is paired with an expandable or directly rendered accessible table:
```markdown
### 📋 Tabular Data Alternative: Daily Residential Consumption
*Screen reader accessible presentation of chart data (MEASURED). Total intervals: 3.*

| Date | Energy (kWh) | Data Provenance |
| :--- | :--- | :--- |
| 2026-03-01 | 12.45 | MEASURED (METER) |
| 2026-03-02 | 14.80 | MEASURED (METER) |
| 2026-03-03 | 11.20 | MEASURED (METER) |
```

### 3.2 Visual Invariant: Axis & Unit Clarity
- All charts enforce explicit axis titles: Time (Interval), Energy (kWh / MWh), Power (kW / MW), Cost (₹ INR).
- Series legends differentiate between **Actual** (solid line), **Forecast** (dashed line with $P_{10}–P_{90}$ shaded envelope), and **Simulated** (dotted line).

---

## 4. Map & Geographic Spatial Alternatives

For geographic and map-based exploration:
- **Canvas Limitation**: Interactive MapLibre / WebGL map tiles cannot be directly navigated by screen-reader accessibility APIs.
- **Accessible Alternative**: The application provides an accompanying searchable, filterable **Properties List View** and **District Summary Table** presenting identical geographic attributes, coordinates, and energy figures.
- Users can select a property, inspect solar rooftop potential, and audit tariffs completely from the tabular view without ever interacting with the canvas map.

---

## 5. Audit Results

- **320px Reflow Test**: Passed without horizontal scrolling or clipped essential actions.
- **100% Tabular Equivalents**: All critical charts provide exportable or inline table views.
- **Map Fallback**: Verified that properties and community clusters are accessible via semantic lists and tables.
