import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";
import { LoginBackdrop } from "@/components/brand/LoginBackdrop";
import PageLoading from "@/components/PageLoading";
import { safeNextPath, tryGetStaffContext } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in · Ichiba POS" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  return (
    <div className="relative isolate flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
      <LoginBackdrop />
      <Suspense fallback={<PageLoading />}>
        <Login searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Login({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  // Already signed in with a usable profile → straight to the app. A signed-in login without
  // an active profile/counter (403) stays here and sees why, so there is no redirect loop.
  const { staff, authError } = await tryGetStaffContext();
  if (staff) redirect(nextPath);

  return <LoginForm next={nextPath} notice={authError?.status === 403 ? authError.message : undefined} />;
}
