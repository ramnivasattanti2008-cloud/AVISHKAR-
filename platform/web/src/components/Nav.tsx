"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { ThemeToggle } from "./ThemeToggle";

/** Only pages that exist are linked: no "coming soon" entries (spec section 86). */
const LINKS = [
  { href: "/map", label: "Map" },
  { href: "/properties", label: "Properties" },
  { href: "/community", label: "Community" },
  { href: "/system", label: "System" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-wide">
          <span aria-hidden className="inline-block h-5 w-5 rounded-sm bg-accent" />
          AVISHKAR
        </Link>
        {/* On a phone the links take their own row under the brand and the account buttons. */}
        <ul className="order-last -mx-2 flex w-full items-center gap-1 sm:order-none sm:mx-0 sm:ml-2 sm:w-auto">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`);
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={active ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-surface2 text-ink" : "text-muted hover:text-ink"}`}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {loading ? null : user ? (
            <>
              <span className="hidden text-sm text-muted sm:inline" title={user.email}>
                {user.displayName ?? user.email}
              </span>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await logout();
                  router.push("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn">
                Sign in
              </Link>
              <Link href="/register" className="btn btn-primary max-sm:hidden">
                Create account
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
