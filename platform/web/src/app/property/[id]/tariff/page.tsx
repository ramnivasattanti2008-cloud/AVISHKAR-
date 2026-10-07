import type { Metadata } from "next";
import { TariffView } from "@/components/tariff/TariffView";

export const metadata: Metadata = { title: "Tariff" };

export default async function TariffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TariffView id={id} />;
}
