"use client";

import * as React from "react";
import { SunMoonThemeToggle } from "./ui/sun-moon-theme-toggle";

const settings = {
  size: 50,
  duration: 1740,
  autoplay: false,
  sky: true,
};

const CCGATHER_URL = "https://ccgather.com/?utm_source=21st&utm_medium=component&utm_campaign=theme_toggle";

export default function Demo(props: Partial<typeof settings>) {
  const s = { ...settings, ...props };
  const toggleRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const button = toggleRef.current;
    if (!s.autoplay || !button) return;
    const timers = [900, 900 + s.duration + 1400].map((delay) => window.setTimeout(() => button.click(), delay));
    const stop = () => timers.forEach((timer) => window.clearTimeout(timer));
    window.addEventListener("pointerdown", stop, { once: true });
    window.addEventListener("keydown", stop, { once: true });
    return () => {
      stop();
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [s.autoplay, s.duration]);

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-5 bg-background p-6">
      <SunMoonThemeToggle ref={toggleRef} size={s.size} duration={s.duration} sky={s.sky} />
      <div className="space-y-1 text-center">
        <p className="text-sm font-medium text-foreground">The moon sets, the sun rises</p>
        <p className="text-xs text-muted-foreground">
          Theme toggle from the{" "}
          <a
            href={CCGATHER_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            CCgather
          </a>{" "}
          header
        </p>
      </div>
    </div>
  );
}
