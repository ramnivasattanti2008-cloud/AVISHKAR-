"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function current(): Theme {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("avk-theme", next);
        } catch {
          /* storage can be blocked; the choice then lasts for this visit only */
        }
        listeners.forEach((l) => l());
      }}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
