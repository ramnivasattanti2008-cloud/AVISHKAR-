import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminAudit, adminJobs, adminOverview, fakeApi, json } from "@/test/fixtures";
import { AdminView } from "./AdminView";

type U = { id: string; email: string; role: string; displayName: string | null } | null;
const auth = vi.hoisted(() => ({ user: null as U }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

function world(extra: [string, string, (a: { url: URL; body: unknown }) => Response][] = []) {
  // the first route that matches answers, so what a test overrides goes first
  const api = fakeApi([
    ...extra,
    ["GET", "/api/admin/overview", () => json(adminOverview())],
    ["GET", "/api/admin/jobs", () => json(adminJobs())],
    ["GET", "/api/admin/audit", () => json(adminAudit())],
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

beforeEach(() => {
  auth.user = { id: "a1", email: "admin@example.com", role: "ADMIN", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminView", () => {
  it("shows an ordinary user nothing but a refusal, and asks no admin question of the server", async () => {
    auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
    const api = world();
    render(<AdminView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This page is for administrators");
    expect(screen.getByRole("alert")).toHaveTextContent("granted from the command line");
    expect(api.calls).toHaveLength(0);
  });

  it("asks you to sign in when you are not", async () => {
    auth.user = null;
    world();
    render(<AdminView />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=/admin");
  });

  it("shows the counts of accounts and data, and says no one's readings are here", async () => {
    world();
    render(<AdminView />);
    const sec = await screen.findByRole("region", { name: "Accounts and data" });
    expect(within(sec).getByText("12")).toBeInTheDocument();
    expect(within(sec).getByText("1 administrator, 3 new this week")).toBeInTheDocument();
    expect(within(sec).getByText("4 demo")).toBeInTheDocument();
    expect(within(sec).getByText("Meter data gone quiet").nextSibling).toHaveTextContent("2");
    expect(screen.getByText(/no one's readings, equipment or plans appear here/)).toBeInTheDocument();
  });

  it("marks an expired tariff order, and a degraded provider, rather than hiding them", async () => {
    world();
    render(<AdminView />);
    const cat = await screen.findByRole("table", { name: "Curated tariff plans with their validity and source" });
    const expired = within(cat).getByText("EXPIRED");
    expect(expired).toHaveAttribute("data-tone", "unavailable");
    expect(expired).toHaveAttribute("title", "The source covers the period to 2026-03-31.");
    expect(within(cat).getByRole("link", { name: "UPERC tariff order" })).toHaveAttribute("href", "https://example.org/order");
    expect(within(cat).getByText("OPEN ENDED")).toBeInTheDocument();
    const prov = screen.getByRole("table", { name: /Outside providers/ });
    expect(within(prov).getByText("degraded")).toHaveAttribute("data-tone", "updated");
    expect(within(prov).getByText("overpass answered HTTP 504")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Policy rules" })).toHaveTextContent("PM_SURYA_GHAR, residential_cfa (IN, RESIDENTIAL): National Portal for Rooftop Solar");
  });

  it("shows the planning engine's version and the models in use", async () => {
    world();
    render(<AdminView />);
    const sec = await screen.findByRole("region", { name: "Models" });
    expect(within(sec).getByText("healthy")).toBeInTheDocument();
    expect(within(sec).getByText("version 0.1.0, HiGHS 1.9")).toBeInTheDocument();
    expect(within(sec).getByRole("table", { name: /Stored forecasts by kind/ })).toHaveTextContent("same_hour_of_week");
    expect(within(sec).getByText(/Plans by engine version: 0\.1\.0: 41\./)).toBeInTheDocument();
  });

  it("lists the jobs with when they are next due and what they did lately, and says when the scheduler is off", async () => {
    world([["GET", "/api/admin/jobs", () => json(adminJobs({ schedulerEnabled: false }))]]);
    render(<AdminView />);
    const sec = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(sec).getByText(/The scheduler is off on this server/)).toBeInTheDocument();
    const weather = within(sec).getByRole("listitem", { name: "weather-refresh" });
    expect(within(weather).getByText(/Every 60 min, retried after 15 min on failure\. Next: in 30 min\./)).toBeInTheDocument();
    expect(within(weather).getByText("OK")).toBeInTheDocument();
    expect(within(weather).getByText(/places 3, ok 3, failed 0/)).toBeInTheDocument();
    const tariff = within(sec).getByRole("listitem", { name: "tariff-validity" });
    expect(within(tariff).getByText(/Next: due now\./)).toBeInTheDocument();
    expect(within(tariff).getByText("Never run.")).toBeInTheDocument();
  });

  it("runs a job on request, says what happened, and refreshes the list and the log", async () => {
    let ran = false;
    const api = world([
      ["POST", "/api/admin/jobs/tariff-validity/run", () => ((ran = true), json({ id: "d1000000-0000-4000-8000-000000000009", job: "tariff-validity", trigger: "MANUAL", startedAt: "2026-10-08T10:00:00.000Z", finishedAt: "2026-10-08T10:00:01.000Z", status: "OK", seconds: 1, summary: { plans: 3 }, error: null }))],
    ]);
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "Run tariff-validity now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("tariff-validity ran.");
    expect(ran).toBe(true);
    expect(api.called("GET", "/api/admin/jobs")).toHaveLength(2); // opened, then refreshed
    expect(api.called("GET", "/api/admin/audit")).toHaveLength(2);
  });

  it("says a failed or skipped run did not do its work", async () => {
    const failed = { id: "d1000000-0000-4000-8000-000000000009", job: "weather-refresh", trigger: "MANUAL" as const, startedAt: "2026-10-08T10:00:00.000Z", finishedAt: "2026-10-08T10:00:01.000Z", status: "FAILED" as const, seconds: 1, summary: null, error: "Every weather call failed (3): open-meteo answered HTTP 400" };
    world([["POST", "/api/admin/jobs/weather-refresh/run", () => json(failed)]]);
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "Run weather-refresh now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("weather-refresh failed: Every weather call failed (3)");
    cleanup();
    world([["POST", "/api/admin/jobs/weather-refresh/run", () => json({ ...failed, status: "SKIPPED", error: null, summary: { reason: "The job is already running." } })]]);
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "Run weather-refresh now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("weather-refresh was already running, so nothing was started.");
  });

  it("shows the audit log newest first, with who and from where, filters by action, and reads older pages", async () => {
    const api = world([
      [
        "GET",
        "/api/admin/audit",
        ({ url }) => {
          const before = url.searchParams.get("before");
          const action = url.searchParams.get("action");
          if (before) return json({ entries: [{ id: "210", createdAt: "2026-10-08T09:10:00.000Z", action: "property.create", user: "old@example.com", entityType: "property", entityId: "p0", requestId: null, ip: null, detail: null }], next: null });
          if (action) return json({ entries: [adminAudit().entries[1]!], next: null });
          return json(adminAudit());
        },
      ],
    ]);
    render(<AdminView />);
    const table = await screen.findByRole("table", { name: "The audit log, newest first" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("admin.audit.read")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("admin@example.com")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("10.0.0.2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Older entries" }));
    expect(await screen.findByText("old@example.com")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "The audit log, newest first" })).getAllByRole("row")).toHaveLength(4); // the header and three entries
    expect(screen.queryByRole("button", { name: "Older entries" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Actions that start with"), "plan");
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "The audit log, newest first" })).getAllByRole("row")).toHaveLength(2)); // the header and the one plan entry
    expect(api.called("GET", "/api/admin/audit").at(-1)!.search).toContain("action=plan");
    expect(screen.queryByText("admin.audit.read")).not.toBeInTheDocument();
  });

  it("shows an error from the server rather than an empty page", async () => {
    world([["GET", "/api/admin/overview", () => json({ error: { code: "FORBIDDEN", message: "Administrator access required." } }, 403)]]);
    render(<AdminView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Administrator access required.");
  });
});
