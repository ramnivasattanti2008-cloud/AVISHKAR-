/**
 * A small, strict CSV reader for meter files: quoted fields, doubled quotes, embedded newlines, a byte-order mark, and a
 * delimiter that is detected rather than assumed (utilities export with commas, semicolons, tabs and pipes).
 */

export interface Csv {
  delimiter: string;
  header: string[];
  rows: string[][];
}

const CANDIDATES = [",", ";", "\t", "|"];

/** The candidate delimiter that appears most often outside quotes in the first non-empty line; a comma if none appears. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const counts = new Map<string, number>(CANDIDATES.map((c) => [c, 0]));
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

export function parseCsv(input: string): Csv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // drop a byte-order mark
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) records.push(row); // blank lines are skipped
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    sawAny = true;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (sawAny && (field !== "" || row.length > 0)) endRow();

  if (records.length === 0) return { delimiter, header: [], rows: [] };
  const [header, ...rows] = records;
  return { delimiter, header: header!.map((h) => h.trim()), rows };
}
