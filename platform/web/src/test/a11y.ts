import axe, { type AxeResults, type Result, type RunOptions } from "axe-core";

/**
 * Run axe-core over a rendered container and return the violations in a readable form.
 *
 * This is automated checking, which catches a particular set of mistakes: missing names on controls, colour contrast below the
 * threshold, broken label associations, heading levels skipped, duplicate ids, landmarks and so on. It is not a screen-reader pass
 * and does not claim to be one: it cannot tell whether what a page says makes sense when read aloud, or whether an order of focus
 * is sensible. Those still need a person.
 *
 * jsdom has no layout, so rules that need real geometry (colour contrast among them) cannot run here; `disabled` lists exactly which
 * are off and why, so the test never looks stronger than it is. Contrast is checked in a real browser instead, against the running
 * app in both themes.
 */
export const RULES_JSDOM_CANNOT_RUN = {
  "color-contrast": "needs real layout and painted colours, which jsdom does not have",
} as const;

export interface A11yViolation {
  id: string;
  impact: string;
  help: string;
  nodes: string[];
}

function readable(r: Result): A11yViolation {
  return { id: r.id, impact: r.impact ?? "unknown", help: r.help, nodes: r.nodes.slice(0, 3).map((n) => `${n.target.join(" ")}: ${n.failureSummary?.replace(/\s+/g, " ").slice(0, 160) ?? ""}`) };
}

export async function a11yViolations(container: Element, options: RunOptions = {}): Promise<A11yViolation[]> {
  const results: AxeResults = await axe.run(container, {
    ...options,
    rules: { ...Object.fromEntries(Object.keys(RULES_JSDOM_CANNOT_RUN).map((id) => [id, { enabled: false }])), ...(options.rules ?? {}) },
    resultTypes: ["violations"],
  });
  return results.violations.map(readable);
}

/** A message that names every violation, so a failure says what to fix rather than just a count. */
export const describeViolations = (v: A11yViolation[]): string =>
  v.map((x) => `${x.id} (${x.impact}): ${x.help}\n    ${x.nodes.join("\n    ")}`).join("\n  ");
