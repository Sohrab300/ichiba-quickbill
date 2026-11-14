import { Suspense } from "react";
import BillingScreen from "@/components/billing/BillingScreen";
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
  return (
    <BillingScreen
      userId={staff.userId}
      isAdmin={staff.role === "admin"}
      counterCode={staff.counter?.code ?? null}
      counterKind={staff.counter?.kind ?? null}
      printWidthMm={staff.counter?.printWidthMm ?? null}
    />
  );
}
