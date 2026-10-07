import type { Metadata } from "next";
import { ForecastView } from "@/components/property/ForecastView";

export const metadata: Metadata = { title: "Forecast" };

export default async function ForecastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ForecastView id={id} />;
}
