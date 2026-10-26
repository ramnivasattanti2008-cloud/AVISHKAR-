import type { Metadata } from "next";
import { ResilienceView } from "@/components/resilience/ResilienceView";

export const metadata: Metadata = { title: "Resilience" };

export default async function ResiliencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResilienceView id={id} />;
}
