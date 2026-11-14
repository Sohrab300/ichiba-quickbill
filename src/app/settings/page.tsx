import { Suspense } from "react";
import PageLoading from "@/components/PageLoading";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsForms, type CounterSettings, type StoreSettings } from "@/components/settings/SettingsForms";
import { requireStaffForPage } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Settings />
    </Suspense>
  );
}

async function load(): Promise<{ store: StoreSettings; counters: CounterSettings[] }> {
  const supabase = createServerClient();
  const [store, counters] = await Promise.all([
    supabase
      .from("store_settings")
      .select("legal_name, address, phone, gstin, state_code, state_name, fy_label, invoice_footer, default_print_width_mm")
      .eq("id", true)
      .maybeSingle(),
    supabase.from("counters").select("id, code, kind, invoice_prefix, print_width_mm, is_active").order("code"),
  ]);
  if (store.error) throw new Error(`Could not load store settings: ${store.error.message}`);
  if (!store.data) throw new Error("Store settings row is missing. Apply the migrations.");
  if (counters.error) throw new Error(`Could not load counters: ${counters.error.message}`);

  const s = store.data;
  return {
    store: {
      legalName: s.legal_name,
      address: s.address,
      phone: s.phone ?? "",
      gstin: s.gstin,
      stateCode: s.state_code,
      stateName: s.state_name,
      fyLabel: s.fy_label,
      invoiceFooter: s.invoice_footer ?? "",
      defaultPrintWidthMm: s.default_print_width_mm === 58 ? 58 : 80,
    },
    counters: counters.data.map((c) => ({
      id: c.id,
      code: c.code,
      kind: c.kind === "mobile" ? "mobile" : "desk",
      invoicePrefix: c.invoice_prefix,
      printWidthMm: c.print_width_mm === 58 ? 58 : 80,
      isActive: c.is_active,
    })),
  };
}

async function Settings() {
  const staff = await requireStaffForPage();

  let data = null;
  let error: string | null = null;
  if (staff.role === "admin") {
    try {
      data = await load();
    } catch (err: unknown) {
      console.error("Settings page failed", err);
      error = err instanceof Error ? err.message : "Could not load settings.";
    }
  }

  const content =
    staff.role !== "admin" ? (
      <Card className="p-6 text-center font-semibold">
        <p>Only an admin can change settings.</p>
      </Card>
    ) : data ? (
      <SettingsForms store={data.store} counters={data.counters} />
    ) : (
      <Alert tone="danger" role="alert">
        <p className="text-base font-semibold">{error ?? "Could not load settings."}</p>
      </Alert>
    );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title="Settings" />
      {content}
    </div>
  );
}
