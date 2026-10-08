import type { Metadata } from "next";
import { CopilotView } from "@/components/copilot/CopilotView";

export const metadata: Metadata = { title: "Ask" };

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CopilotView id={id} />;
}
