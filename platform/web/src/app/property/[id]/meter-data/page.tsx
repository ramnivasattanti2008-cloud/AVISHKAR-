import type { Metadata } from "next";
import { MeterDataView } from "@/components/energy/MeterDataView";

export const metadata: Metadata = { title: "Meter data" };

export default async function MeterDataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeterDataView id={id} />;
}
