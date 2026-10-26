import { type ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, community, demoWorld, fakeApi, json, property, resilienceReport, today, vppSimulation } from "@/test/fixtures";
import { energyHealth, energyWaste } from "@/test/insight-fixtures";
import { energyFutures } from "@/test/futures-fixtures";
import { RULES_JSDOM_CANNOT_RUN, a11yViolations, describeViolations } from "@/test/a11y";
import { AccountView } from "./account/AccountView";
import { CommunityView } from "./community/CommunityView";
import { FuturesView } from "./futures/FuturesView";
import { HealthView } from "./insight/HealthView";
import { PropertiesView } from "./PropertiesView";
import { ResilienceView } from "./resilience/ResilienceView";
import { TodayView } from "./today/TodayView";

/**
 * Automated accessibility checks over the main views (spec sections 55 and 78). What axe catches: controls with no accessible
 * name, labels that point nowhere, heading levels skipped, duplicate ids, missing landmarks, lists built out of the wrong
 * elements. What it does not: whether a page makes sense read aloud, or whether the order of focus is sensible. Those need a
 * person with a screen reader, which has not been done; the documents say so.
 */
const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("./AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn(), forget: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

const base = `/api/properties/${PROPERTY_ID}`;

/** The real pages sit inside the layout's <main id="main">; render them there so landmark rules are judged as the page really is. */
const page = (ui: ReactElement) => render(<main id="main">{ui}</main>);
const notFound = () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404);

function stub(routes: [string, string, () => Response][]) {
  vi.stubGlobal(
    "fetch",
    fakeApi([
      ["GET", base, () => json(property())],
      ["GET", `${base}/twin`, notFound],
      ["GET", "/api/properties", () => json({ properties: [property({ name: "Home" })] })],
      ...routes,
    ]).fetch,
  );
}

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Each case renders a view, waits for something it only shows once its data has arrived, and then runs axe over the whole thing. */
const cases: { name: string; render: () => void; ready: () => Promise<unknown> }[] = [
  {
    name: "Today",
    render: () => {
      stub([[`GET`, `${base}/today`, () => json(today())]]);
      page(<TodayView id={PROPERTY_ID} />);
    },
    ready: () => screen.findByText("Your energy. Understood."),
  },
  {
    name: "Energy health and waste",
    render: () => {
      stub([
        ["GET", `${base}/health`, () => json(energyHealth())],
        ["GET", `${base}/waste`, () => json(energyWaste())],
      ]);
      page(<HealthView id={PROPERTY_ID} />);
    },
    ready: () => screen.findByRole("heading", { name: "Energy health" }),
  },
  {
    name: "Energy futures",
    render: () => {
      stub([["POST", `${base}/futures`, () => json(energyFutures())]]);
      page(<FuturesView id={PROPERTY_ID} />);
    },
    ready: () => screen.findByRole("heading", { name: "Plan the same day on different days" }),
  },
  {
    name: "Resilience",
    render: () => {
      stub([["GET", `${base}/resilience`, () => json(resilienceReport())]]);
      page(<ResilienceView id={PROPERTY_ID} />);
    },
    ready: () => screen.findByRole("heading", { name: "If the grid failed now" }),
  },
  {
    name: "Community",
    render: () => {
      stub([
        ["GET", "/api/community", () => json(community())],
        ["POST", "/api/vpp/simulate", () => json(vppSimulation())],
      ]);
      page(<CommunityView />);
    },
    ready: () => screen.findByRole("region", { name: "Your properties together" }),
  },
  {
    name: "Properties",
    render: () => {
      stub([["GET", "/api/demo/world", () => json(demoWorld())]]);
      page(<PropertiesView />);
    },
    ready: () => screen.findByRole("list", { name: "Your own properties" }),
  },
  {
    name: "Account",
    render: () => {
      stub([]);
      page(<AccountView />);
    },
    ready: () => screen.findByRole("heading", { name: "Your account and your data" }),
  },
];

describe("accessibility of the main views (axe-core, automated only)", () => {
  for (const c of cases) {
    it(`${c.name} has no axe violations`, async () => {
      c.render();
      await c.ready();
      const v = await a11yViolations(document.body);
      expect(v, v.length ? `\n  ${describeViolations(v)}\n` : "").toEqual([]);
    }, 30_000);
  }

  it("says which rules jsdom cannot run, so the check is never taken for more than it is", () => {
    expect(Object.keys(RULES_JSDOM_CANNOT_RUN)).toContain("color-contrast");
    for (const why of Object.values(RULES_JSDOM_CANNOT_RUN)) expect(why.length).toBeGreaterThan(20);
  });

  it("a view that is still loading, and one a visitor may not see, are also sound", async () => {
    stub([["GET", `${base}/today`, () => json(today())]]);
    page(<TodayView id={PROPERTY_ID} />);
    expect(await a11yViolations(document.body)).toEqual([]); // the loading state
    cleanup();

    auth.user = null;
    stub([]);
    page(<AccountView />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument());
    const v = await a11yViolations(document.body);
    expect(v, describeViolations(v)).toEqual([]);
  }, 30_000);
});
