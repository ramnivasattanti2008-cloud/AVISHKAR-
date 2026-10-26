import type { Metadata } from "next";
import { CityView } from "@/components/city/CityView";

export const metadata: Metadata = { title: "City energy map" };

export default function CityPage() {
  return <CityView />;
}
