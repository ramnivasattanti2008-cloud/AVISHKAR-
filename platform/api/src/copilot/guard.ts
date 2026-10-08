/**
 * The check behind "no fake AI" (spec section 90): every number in an answer must be one a tool returned. Applied to a language
 * model's wording before it is shown, and in the tests to the template wording too. A number may be rounded to the precision it
 * is written with ("3.4" for 3.37), and no further. Small whole numbers (counts, hours, days) and years are not checked: they
 * are how sentences are built, not claims about the property.
 */

const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?/g;

interface Token {
  value: number;
  /** Digits after the decimal point as written. */
  decimals: number;
}

function tokens(text: string): Token[] {
  const stripped = text.replace(/\[\d+\]/g, " "); // citation markers
  const out: Token[] = [];
  for (const m of stripped.matchAll(NUMBER)) {
    const value = Number(m[0].replaceAll(",", ""));
    if (Number.isFinite(value)) out.push({ value, decimals: m[0].includes(".") ? m[0].length - m[0].indexOf(".") - 1 : 0 });
  }
  return out;
}

export function numbersIn(text: string): number[] {
  return tokens(text).map((t) => t.value);
}

/** Every number a tool result contains, in numeric fields and inside the sentences it returned, and each as a percentage when it is a share. */
export function groundedNumbers(outputs: unknown[]): number[] {
  const out: number[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push(v, Math.abs(v), v * 100, v / 1000, v * 1000); // as written, as a percentage of a share, and across kW/W and kWh/MWh
    } else if (typeof v === "string") out.push(...numbersIn(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  outputs.forEach(visit);
  return out;
}

const exempt = (x: number): boolean => (Number.isInteger(x) && x >= 0 && x <= 31) || (Number.isInteger(x) && x >= 2000 && x <= 2100);

/** The numbers in `text` that no tool result contains, allowing the rounding the number is written with. */
export function ungroundedNumbers(text: string, outputs: unknown[]): number[] {
  const allowed = groundedNumbers(outputs);
  return tokens(text)
    .filter((t) => !exempt(t.value) && !allowed.some((y) => Math.abs(t.value - y) <= 0.5 * 10 ** -t.decimals + 1e-9))
    .map((t) => t.value);
}
