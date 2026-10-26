import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json } from "@/test/fixtures";
import { AccountView } from "./AccountView";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "me@example.com", role: "USER", displayName: "Asha" } as { id: string; email: string; role: string; displayName: string | null } | null,
  push: vi.fn(),
  forget: vi.fn(),
}));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: h.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn(), forget: h.forget }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));

beforeEach(() => {
  h.user = { id: "u1", email: "me@example.com", role: "USER", displayName: "Asha" };
  h.push.mockClear();
  h.forget.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AccountView: what is kept, what leaves, the export and the deletion", () => {
  it("asks a visitor who is not signed in to sign in, and shows nothing about an account", () => {
    h.user = null;
    render(<AccountView />);
    expect(screen.getByRole("heading", { level: 1, name: "Your account and your data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=/account");
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("lists what is kept and, for each outside service, what it is sent and how precisely", () => {
    render(<AccountView />);
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    const kept = screen.getByRole("region", { name: "What AVISHKAR keeps about you" });
    expect(within(kept).getByText(/hash of your password, never the password itself/)).toBeInTheDocument();
    expect(within(kept).getByText(/No advertising, no analytics and no tracking scripts/)).toBeInTheDocument();
    expect(within(kept).getByText(/can still read its database/)).toBeInTheDocument(); // the limit of the promise is stated

    const sent = screen.getByRole("region", { name: "What leaves AVISHKAR, and to whom" });
    const items = within(sent).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(within(sent).getByText(/rounded to about a kilometre\. Never your name, email or readings/)).toBeInTheDocument();
    expect(within(sent).getByText(/The exact point of a property, to find the building on it/)).toBeInTheDocument(); // not claimed to be coarse
    expect(within(sent).getByText(/rounded to about a hundred metres/)).toBeInTheDocument();
    expect(within(sent).getByText(/only if whoever runs this server has switched one on/)).toBeInTheDocument();
  });

  it("offers the export as a download of the signed-in person's own file", () => {
    render(<AccountView />);
    const link = screen.getByRole("link", { name: "Download my data" });
    expect(link).toHaveAttribute("href", "/api/account/export");
    expect(link).toHaveAttribute("download");
    expect(screen.getByText(/It does not repeat the readings themselves/)).toBeInTheDocument(); // what the file leaves out is said
  });

  it("deletes only after the password is entered, shows the server's refusal of a wrong one, and leaves once it is accepted", async () => {
    const user = userEvent.setup();
    let accept = false;
    const api = fakeApi([["DELETE", "/api/account", () => (accept ? new Response(null, { status: 204 }) : json({ error: { code: "INVALID_CREDENTIALS", message: "Password is incorrect." } }, 401))]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<AccountView />);

    expect(screen.queryByLabelText(/Your password, to confirm/)).not.toBeInTheDocument(); // one click does not delete, or even ask to
    await user.click(screen.getByRole("button", { name: "Delete my account…" }));
    await user.click(screen.getByRole("button", { name: "Delete everything" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your password to delete the account.");
    expect(api.calls).toHaveLength(0); // nothing was sent without a password

    await user.type(screen.getByLabelText(/Your password, to confirm/), "not-my-password");
    await user.click(screen.getByRole("button", { name: "Delete everything" }));
    expect(await screen.findByText("Password is incorrect.")).toBeInTheDocument();
    expect(api.called("DELETE", "/api/account")[0]?.body).toEqual({ password: "not-my-password" });
    expect(h.forget).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();

    accept = true;
    await user.click(screen.getByRole("button", { name: "Delete everything" }));
    await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith("/"));
    expect(h.forget).toHaveBeenCalledTimes(1);
  });

  it("lets the person back out of deleting", async () => {
    const user = userEvent.setup();
    render(<AccountView />);
    await user.click(screen.getByRole("button", { name: "Delete my account…" }));
    await user.type(screen.getByLabelText(/Your password, to confirm/), "abc");
    await user.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(screen.queryByLabelText(/Your password, to confirm/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete my account…" })).toBeInTheDocument();
  });
});
