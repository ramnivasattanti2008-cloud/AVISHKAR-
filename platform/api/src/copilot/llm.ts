/**
 * The optional language-model interface (spec sections 44 and 90, decision D14). The model only words an answer: the backend has
 * already chosen the tools and run them, and the model is given their results and nothing else. Its wording is then checked
 * (`guard.ts`): a number no tool returned, a missing or invented citation, or a failure of any kind sends the person the
 * template answer instead. With no key configured there is no model and nothing here runs.
 */
import { AppError } from "../errors.js";
import type { ToolResult } from "./tools.js";

export interface LlmAdapter {
  readonly name: string;
  complete(input: { system: string; user: string }): Promise<string>;
}

export const SYSTEM_PROMPT = [
  "You explain results that AVISHKAR's calculations have already produced for one property's electricity.",
  "You are given a question and numbered tool results in JSON. Answer ONLY from them.",
  "Rules: never state a number, price, tariff, forecast, saving or subsidy that is not in the results; do not round to a different figure; do not give advice about buying a particular product or about whether someone qualifies for a scheme.",
  "Mark every statement with the number of the result it comes from, like [1]. If the results do not answer the question, say what is missing.",
  "Say when a figure is a forecast, an estimate or a simulation, as its dataStatus says. Keep the answer under 150 words, in plain language.",
].join(" ");

export function buildPrompt(question: string, results: ToolResult[]): { system: string; user: string } {
  const body = results.map((r, i) => ({ n: i + 1, tool: r.tool, status: r.status, dataStatus: r.dataStatus, unavailableReason: r.unavailableReason, output: r.output }));
  return { system: SYSTEM_PROMPT, user: `Question: ${question}\n\nTool results:\n${JSON.stringify(body, null, 1)}` };
}

/** Anthropic's Messages API. Not exercised against the real service in this repository's tests (no key was available); the tests use a fake fetch. */
export class AnthropicAdapter implements LlmAdapter {
  readonly name = "anthropic";
  constructor(private readonly o: { apiKey: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch; baseUrl?: string }) {}

  async complete(input: { system: string; user: string }): Promise<string> {
    const f = this.o.fetchImpl ?? fetch;
    const res = await f(new URL("/v1/messages", this.o.baseUrl ?? "https://api.anthropic.com"), {
      method: "POST",
      headers: { "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: this.o.model, max_tokens: 600, system: input.system, messages: [{ role: "user", content: input.user }] }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000),
    });
    if (!res.ok) throw new AppError("PROVIDER_UNAVAILABLE", `The language model answered HTTP ${res.status}.`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n").trim();
    if (!text) throw new AppError("PROVIDER_BAD_RESPONSE", "The language model returned no text.");
    return text;
  }
}
