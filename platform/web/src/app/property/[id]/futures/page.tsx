import type { Metadata } from "next";
import { FuturesView } from "@/components/futures/FuturesView";

export const metadata: Metadata = { title: "Energy futures" };

export default async function FuturesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FuturesView id={id} />;
}
