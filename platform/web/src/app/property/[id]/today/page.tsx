import type { Metadata } from "next";
import { TodayView } from "@/components/today/TodayView";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TodayView id={id} />;
}
