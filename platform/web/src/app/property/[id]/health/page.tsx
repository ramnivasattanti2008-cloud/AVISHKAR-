import type { Metadata } from "next";
import { HealthView } from "@/components/insight/HealthView";

export const metadata: Metadata = { title: "Energy health and waste" };

export default async function HealthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HealthView id={id} />;
}
