import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, copilotAnswer, copilotTools, fakeApi, json, property } from "@/test/fixtures";
import { CopilotView } from "./CopilotView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const NO_TWIN = { error: { code: "NOT_FOUND", message: "No Energy Twin yet." } };

function world(over: { answer?: (body: { question: string }) => Response; tools?: ReturnType<typeof copilotTools> } = {}) {
  const api = fakeApi([
    ["GET", `/api/properties/${PROPERTY_ID}`, () => json(property())],
    ["GET", `/api/properties/${PROPERTY_ID}/twin`, () => json(NO_TWIN, 404)],
    ["GET", "/api/copilot/tools", () => json(over.tools ?? copilotTools())],
    ["POST", `/api/properties/${PROPERTY_ID}/copilot/ask`, ({ body }) => (over.answer ? over.answer(body as { question: string }) : json(copilotAnswer({ question: (body as { question: string }).question })))],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CopilotView", () => {
  it("says what the answers are made of, offers the questions it can answer and lists the tools", async () => {
    world();
    render(<CopilotView id={PROPERTY_ID} />);
    const how = await screen.findByRole("region", { name: "How this works" });
    expect(within(how).getByText(/Nothing is made up, and a figure it cannot find is reported as missing/)).toBeInTheDocument();
    expect(await within(how).findByText(/there is no language model/)).toBeInTheDocument();
    expect(within(how).getByText(/saves the result/)).toBeInTheDocument();
    await userEvent.click(within(how).getByText(/What it can look at \(2 tools\)/));
    expect(within(how).getByText("runOptimization")).toBeInTheDocument();
    expect(within(how).getByText(/Make a new plan and store it\. \(saves its result\)/)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Example questions" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["How much will I save?", "Which tariff am I on?"]);
  });

  it("asks a suggested question, shows the answer with where each figure came from, and opens the data behind it", async () => {
    const api = world();
    render(<CopilotView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "How much will I save?" }));
    const conv = await screen.findByRole("region", { name: "Conversation" });
    expect(await within(conv).findByText(/it saves ₹11\.70/)).toBeInTheDocument();
    expect(api.called("POST", `/api/properties/${PROPERTY_ID}/copilot/ask`)[0]!.body).toEqual({ question: "How much will I save?" });
    expect(within(conv).getByText(/Written from fixed templates over the results; no language model/)).toBeInTheDocument();
    expect(within(conv).queryByRole("region", { name: /Source 1/ })).not.toBeInTheDocument();
    await userEvent.click(within(conv).getByRole("button", { name: "Show the data behind source 1" }));
    const src = within(conv).getByRole("region", { name: "Source 1: getLatestPlan" });
    expect(within(src).getByText("SIMULATED")).toBeInTheDocument();
    expect(src).toHaveTextContent('"savingsInr": 11.7');
    await userEvent.click(within(conv).getByRole("button", { name: "Show the data behind source 1" }));
    expect(within(conv).queryByRole("region", { name: /Source 1/ })).not.toBeInTheDocument();
  });

  it("asks a typed question and clears the box", async () => {
    world();
    render(<CopilotView id={PROPERTY_ID} />);
    const box = await screen.findByLabelText("Your question");
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    await userEvent.type(box, "which tariff am I on");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("which tariff am I on")).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("when the data is missing, shows the reason it was given and the unavailable source, never a number", async () => {
    const a = copilotAnswer({
      status: "UNAVAILABLE",
      paragraphs: ["I cannot answer that from what is on file: No plan has been made for this property yet. [1] Ask me to make a plan and I will say what it saves."],
      toolResults: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tool: "getLatestPlan", input: {}, output: null, status: "UNAVAILABLE", unavailableReason: "No plan has been made for this property yet.", dataStatus: "UNAVAILABLE", calledAt: "2026-10-08T10:00:00.000Z" }],
    });
    world({ answer: () => json(a) });
    render(<CopilotView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "How much will I save?" }));
    expect(await screen.findByText(/I cannot answer that from what is on file/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show the data behind source 1" }));
    const src = screen.getByRole("region", { name: "Source 1: getLatestPlan" });
    expect(within(src).getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(src).toHaveTextContent("No plan has been made for this property yet.");
    expect(src.querySelector("pre")).toBeNull();
  });

  it("lists what it can answer when it does not understand", async () => {
    const a = copilotAnswer({ intent: null, status: "NOT_UNDERSTOOD", paragraphs: ["I did not recognise this one. Here are some I can answer."], citations: [], toolResults: [], suggestions: ["How much will I save?", "Which tariff am I on?"] });
    world({ answer: () => json(a) });
    render(<CopilotView id={PROPERTY_ID} />);
    await userEvent.type(await screen.findByLabelText("Your question"), "tell me a joke");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const conv = await screen.findByRole("region", { name: "Conversation" });
    expect(await within(conv).findByText(/did not recognise this one/)).toBeInTheDocument();
    expect(within(conv).getAllByRole("listitem")).toHaveLength(2);
    expect(within(conv).queryByLabelText("Supporting data")).not.toBeInTheDocument();
  });

  it("says when a language model's wording was rejected, and what is shown instead", async () => {
    world({ answer: () => json(copilotAnswer({ notes: ["The language model's wording was not used: it stated 98765, which no tool returned. This is the template answer."] })) });
    render(<CopilotView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "How much will I save?" }));
    expect(await screen.findByText(/wording was not used: it stated 98765, which no tool returned/)).toBeInTheDocument();
  });

  it("says that a language model words the answers, and that its numbers were checked, only when one is configured", async () => {
    world({ tools: copilotTools({ languageModel: true }), answer: () => json(copilotAnswer({ generatedBy: "LANGUAGE_MODEL" })) });
    render(<CopilotView id={PROPERTY_ID} />);
    expect(await screen.findByText(/A language model words the answers, and its wording is rejected if it states a number/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "How much will I save?" }));
    expect(await screen.findByText(/Worded by a language model; every number was checked/)).toBeInTheDocument();
  });

  it("shows the server's words when the question fails", async () => {
    world({ answer: () => json({ error: { code: "RATE_LIMITED", message: "Too many requests: wait a moment and try again." } }, 429) });
    render(<CopilotView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "How much will I save?" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  });

  it("offers the report for download, and says what is in it", async () => {
    world();
    render(<CopilotView id={PROPERTY_ID} />);
    const section = await screen.findByRole("region", { name: "Report" });
    expect(within(section).getByRole("link", { name: "Download the report" })).toHaveAttribute("href", `/api/properties/${PROPERTY_ID}/report`);
    expect(within(section).getByText(/says where something is missing/)).toBeInTheDocument();
  });

  it("asks you to sign in when you are not", async () => {
    auth.user = null;
    world();
    render(<CopilotView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/ask`);
  });
});
