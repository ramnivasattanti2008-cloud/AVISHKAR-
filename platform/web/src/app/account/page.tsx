import type { Metadata } from "next";
import { AccountView } from "@/components/account/AccountView";

export const metadata: Metadata = { title: "Your account and your data" };

export default function AccountPage() {
  return <AccountView />;
}
