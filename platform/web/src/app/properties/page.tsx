import type { Metadata } from "next";
import { PropertiesView } from "@/components/PropertiesView";

export const metadata: Metadata = { title: "Your properties" };

export default function PropertiesPage() {
  return <PropertiesView />;
}
