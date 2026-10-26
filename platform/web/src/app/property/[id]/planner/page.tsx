import type { Metadata } from "next";
import { InstallationPlanner } from "@/components/property/InstallationPlanner";

export const metadata: Metadata = { title: "Installation Planner" };

export default async function PlannerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InstallationPlanner id={id} />;
}
