import type { Metadata } from "next";
import { PropertyView } from "@/components/property/PropertyView";

export const metadata: Metadata = { title: "Energy Twin" };

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PropertyView id={id} />;
}
