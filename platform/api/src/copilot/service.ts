import { AppError } from "../errors.js";
import { ungroundedNumbers } from "./guard.js";
import { type Intent, type Rendered, SUGGESTIONS, render, route } from "./intents.js";
import { type LlmAdapter, buildPrompt } from "./llm.js";
import { type ToolContext, type ToolResult, callTool } from "./tools.js";

export interface CopilotAnswer {
  question: string;
  intent: Intent | null;
  status: "ANSWERED" | "UNAVAILABLE" | "NOT_UNDERSTOOD";
  paragraphs: string[];
  citations: { marker: number; toolResultId: string; tool: string }[];
  /** The tool results the answer was built from, in full, so the supporting data can be inspected. */
  toolResults: ToolResult[];
  generatedBy: "TEMPLATES" | "LANGUAGE_MODEL";
  /** Why a language model's wording was not used, when one was configured and was rejected. */
  notes: string[];
  suggestions: string[];
}

/** Does a model's wording hold to the rules: only the tools' numbers, and only citations that exist? */
export function checkWording(text: string, results: ToolResult[]): string | null {
  const bad = ungroundedNumbers(text, results.map((r) => r.output));
  if (bad.length > 0) return `it stated ${bad.slice(0, 3).join(", ")}, which no tool returned`;
  const markers = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  if (markers.length === 0) return "it cited no tool result";
  if (markers.some((n) => n < 1 || n > results.length)) return "it cited a tool result that does not exist";
  return null;
}

/**
 * Answer a question about one property. The question is routed to tools by fixed patterns; the tools run; the answer is worded
 * from their results. A configured language model may reword it, and its wording is used only if it passes `checkWording`.
 */
export async function ask(ctx: ToolContext, question: string, llm: LlmAdapter | null = null): Promise<CopilotAnswer> {
  const r = route(question);
  if (!r) {
    return {
      question,
      intent: null,
      status: "NOT_UNDERSTOOD",
      paragraphs: ["I can only answer questions that AVISHKAR's calculations can answer, and I did not recognise this one. Here are some I can answer."],
      citations: [],
      toolResults: [],
      generatedBy: "TEMPLATES",
      notes: [],
      suggestions: SUGGESTIONS,
    };
  }
  const results: ToolResult[] = [];
  for (const c of r.calls) results.push(await callTool(ctx, c.tool, c.input));
  const rendered: Rendered = render(r.intent, question, results);
  const notes: string[] = [];
  let paragraphs = rendered.paragraphs;
  let citations = rendered.citations;
  let generatedBy: CopilotAnswer["generatedBy"] = "TEMPLATES";

  if (llm && rendered.status === "ANSWERED") {
    try {
      const p = buildPrompt(question, results);
      const text = await llm.complete(p);
      const problem = checkWording(text, results);
      if (problem === null) {
        paragraphs = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
        citations = results.map((x, i) => ({ marker: i + 1, toolResultId: x.id, tool: x.tool }));
        generatedBy = "LANGUAGE_MODEL";
      } else notes.push(`The language model's wording was not used: ${problem}. This is the template answer.`);
    } catch (e) {
      notes.push(`The language model could not be reached (${e instanceof AppError ? e.message : "error"}). This is the template answer.`);
    }
  }
  const property = await ctx.deps.db.property.findFirst({ where: { id: ctx.propertyId, ownerId: ctx.userId }, select: { isDemo: true } });
  if (property?.isDemo) {
    paragraphs = ["DEMO DATA: this is a demo property. Its readings and equipment are invented, so the answer below describes the demo, not a real home or business.", ...paragraphs];
  }
  return { question, intent: r.intent, status: rendered.status, paragraphs, citations, toolResults: results, generatedBy, notes, suggestions: [] };
}
