import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "System status" };

export default function SystemLayout({ children }: { children: ReactNode }) {
  return children;
}
