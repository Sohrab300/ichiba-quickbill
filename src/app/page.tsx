import { Suspense } from "react";
import BillingScreen from "@/components/BillingScreen";
import PageLoading from "@/components/PageLoading";
import { requireStaffForPage } from "@/lib/auth";

export default function BillingPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Billing />
    </Suspense>
  );
}

async function Billing() {
  const staff = await requireStaffForPage();
  return <BillingScreen canAddProducts={staff.role === "admin"} />;
}
