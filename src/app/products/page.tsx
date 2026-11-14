import { Suspense } from "react";
import ProductCatalog from "@/components/ProductCatalog";
import PageLoading from "@/components/PageLoading";
import { requireStaffForPage } from "@/lib/auth";

export default function ProductsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Products />
    </Suspense>
  );
}

async function Products() {
  const staff = await requireStaffForPage();
  return <ProductCatalog canManage={staff.role === "admin"} />;
}
