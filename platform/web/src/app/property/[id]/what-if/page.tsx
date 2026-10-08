import type { Metadata } from "next";
import { ScenarioView } from "@/components/scenarios/ScenarioView";

export const metadata: Metadata = { title: "What if" };

export default async function WhatIfPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScenarioView id={id} />;
}
