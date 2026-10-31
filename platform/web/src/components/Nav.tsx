"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/map", label: "Energy map" },
  { href: "/properties", label: "Properties" },
  { href: "/community", label: "Community" },
  { href: "/city", label: "City grid" },
  { href: "/system", label: "System" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const links = [
    ...LINKS,
    ...(user ? [{ href: "/account", label: "Account" }] : []),
    ...(user?.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <>
      <div className="mission-topbar">
        <div className="mission-container mission-topbar-inner">
          <span className="mission-emblem">भारत सरकार</span>
          <span>Ministry of Power &amp; MNRE aligned energy intelligence</span>
          <div className="mission-topbar-metrics">
            <span><b>50.01 Hz</b> grid frequency</span>
            <span><b>LIVE</b> provider telemetry</span>
          </div>
        </div>
      </div>
      <header className="mission-header">
        <nav aria-label="Main" className="mission-container mission-nav">
          <Link href="/" className="mission-brand">
            <span className="mission-brand-icon" aria-hidden>⚡</span>
            <span>
              <strong>AVISHKAR</strong>
              <small>National clean energy grid</small>
            </span>
          </Link>
          <ul className="mission-nav-links">
            {links.map((link) => {
              const active = path === link.href || path.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link href={link.href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}>
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mission-nav-actions">
            <span className="mission-sync"><i aria-hidden /> INSAT telemetry synced</span>
            <ThemeToggle />
            {loading ? null : user ? (
              <button type="button" className="mission-action-button" onClick={async () => { await logout(); router.push("/"); }}>
                Sign out
              </button>
            ) : (
              <>
                <Link href="/login" className="mission-action-button">Sign in</Link>
                <Link href="/register" className="mission-primary-button">Create account</Link>
              </>
            )}
          </div>
        </nav>
      </header>
    </>
  );
}
