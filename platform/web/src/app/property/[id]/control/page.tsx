import type { Metadata } from "next";
import { ControlView } from "@/components/control/ControlView";

export const metadata: Metadata = { title: "Control" };

export default async function ControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ControlView id={id} />;
}
