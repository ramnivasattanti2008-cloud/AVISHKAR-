import type { Metadata } from "next";
import { PropertyComparisonView } from "@/components/property/PropertyComparisonView";

export const metadata: Metadata = { title: "Compare Properties" };

export default function ComparePropertiesPage() {
  return <PropertyComparisonView />;
}
