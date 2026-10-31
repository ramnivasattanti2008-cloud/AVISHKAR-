import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { DegradedBanner } from "@/components/DegradedBanner";
import { Nav } from "@/components/Nav";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";
import "./mission-control.css";

export const metadata: Metadata = {
  title: { default: "AVISHKAR: your energy, understood", template: "%s | AVISHKAR" },
  description: "Pick a property on a map. AVISHKAR builds its Energy Twin from real weather, solar and satellite data, and says plainly what is measured, forecast, estimated or unknown.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

/**
 * Reading the request's headers is what makes every page render per request, which a nonce needs: there is no nonce at
 * build time. Next puts the nonce on its own scripts itself; the theme script is ours, so it is passed here.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <AuthProvider>
          <Nav />
          <DegradedBanner />
          <main id="main" className="flex min-h-0 flex-1 flex-col">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
