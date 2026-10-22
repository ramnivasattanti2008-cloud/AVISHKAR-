import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AVISHKAR: your energy, understood", template: "%s | AVISHKAR" },
  description: "Pick a property on a map. AVISHKAR builds its Energy Twin from real weather, solar and satellite data, and says plainly what is measured, forecast, estimated or unknown.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

// Applies the saved theme before first paint so the page does not flash the wrong one. Its content never changes, so it is
// allowed in the CSP by a SHA-256 hash rather than by 'unsafe-inline'. See src/lib/theme-script.ts.
import { THEME_SCRIPT } from "@/lib/theme-script";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <AuthProvider>
          <Nav />
          <main id="main" className="flex min-h-0 flex-1 flex-col">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
