# UrjaSetu EMS — Phase 23: Keyboard Navigation & Screen-Reader Support

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Scope:** Keyboard Operability, Focus Management, ARIA Landmarks & Assistive Technologies  

---

## 1. Keyboard Navigation Architecture

Every critical workflow in UrjaSetu EMS can be executed exclusively via keyboard without requiring mouse interactions.

### 1.1 Skip Navigation Link
A dedicated skip link is the very first focusable element on every page:
```html
<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
  Skip to content
</a>
```
- **Behavior**: Hidden off-screen by default; becomes immediately visible upon first `Tab` press. Pressing `Enter` bypasses top-level header navigation and places focus directly onto `<main id="main">`.

### 1.2 Focus Trapping & Restoration in Dialogs
- **Dialog Activation**: When a modal dialog opens (e.g., scenario configuration or bill upload modal), keyboard focus is programmatically shifted to the first interactive element inside the dialog.
- **Containment**: Pressing `Tab` cycles focus strictly within the dialog; focus cannot escape to underlying background controls.
- **Escape Key Dismissal**: Pressing `Escape` immediately dismisses the modal.
- **Focus Restoration**: Upon closure, focus returns seamlessly to the button that originally launched the modal.

---

## 2. ARIA Landmarks & Heading Structure

Assistive technologies rely on clear semantic landmark regions to provide fast keyboard navigation shortcuts:

```text
├── <header>
│   └── <nav aria-label="Main"> (Primary Navigation: Map, Properties, Community, City, System)
├── <main id="main">
│   ├── <section aria-labelledby="heading-today">
│   │   ├── <h1> Today's Energy Intelligence
│   │   ├── <h2> Verified Generation & Consumption
│   │   └── <div role="status"> ...
│   ├── <section aria-labelledby="heading-scenarios">
│   │   ├── <h2> Energy Digital Twin What-If Scenarios
│   │   └── <h3> 3 kWp Rooftop Solar Simulation
```

### Invariants:
1. **Single `<h1>` Per Page**: Each page defines exactly one top-level `<h1>` tag summarizing the view's primary domain purpose.
2. **No Skipped Heading Levels**: Progression follows strict hierarchical order (`<h1>` $\to$ `<h2>` $\to$ `<h3>`).
3. **No Unlabeled Sections**: Major content containers use `<section aria-labelledby="...">` pointing to an existing heading element.

---

## 3. Accessible Icon Buttons & Interactive Names

Icon-only buttons (such as theme toggles, close buttons, and navigation arrows) must provide unambiguous accessible names:
- **Theme Toggle**:
  ```html
  <button type="button" aria-label="Switch to dark theme" ...>
    <svg aria-hidden="true" ... />
  </button>
  ```
- **Close Modal Button**:
  ```html
  <button type="button" aria-label="Close dialog" ...>
    <span aria-hidden="true">&times;</span>
  </button>
  ```
- **Decorative Elements**: All decorative graphics and SVG indicators carry `aria-hidden="true"` so screen readers ignore non-essential visual fluff.

---

## 4. Screen-Reader Announcements & Live Regions

Dynamic updates (such as simulation completion, alert acknowledgment, or file upload progress) use polite live regions:
```html
<div role="status" aria-live="polite" class="sr-only">
  Simulation executed successfully. Updated bill estimate: ₹1,894.75.
</div>
```
- **Polite Announcement (`aria-live="polite"`)**: Waits until the user finishes typing or navigating before speaking, avoiding disruptive interruptions.
- **Assertive Alerting (`role="alert"`)**: Reserved strictly for critical system-level errors or blocking form submission failures.

---

## 5. Keyboard Navigation Audit Results

| Workflow / View | Tested Key Sequences | Expected Behavior | Observed Result | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Top Navigation Bar** | `Tab`, `Shift+Tab`, `Enter` | Focus moves through brand, links, theme toggle, sign-in | Smooth progression; high-contrast focus ring active | **PASS** |
| **Property Selector** | `ArrowDown`, `ArrowUp`, `Enter` | Cycles through owned properties without trapping | Correct selection; ARIA active-descendant updated | **PASS** |
| **Tariff Calculation Form** | `Tab`, `Space`, `Enter` | Focuses inputs; submits form; highlights errors | No mouse required; inline error announcements read | **PASS** |
| **Modal Dialogs** | `Escape` | Closes dialog; returns focus to trigger button | Trapped inside dialog; Escape restores trigger focus | **PASS** |
| **Digital Twin Slider** | `ArrowLeft`, `ArrowRight` | Adjusts capacity in incremental steps (0.5 kWp) | Increments cleanly; current value announced | **PASS** |
