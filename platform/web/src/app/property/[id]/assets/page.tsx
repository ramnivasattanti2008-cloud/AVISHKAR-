import type { Metadata } from "next";
import { AssetsView } from "@/components/assets/AssetsView";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssetsView id={id} />;
}
