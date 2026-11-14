"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import { signIn, type SignInState } from "@/lib/auth-actions";

const inputClass =
  "w-full h-12 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-base text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

export default function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, isPending] = useActionState<SignInState, FormData>(signIn, {});
  const message = state.error ?? notice;

  return (
    <form
      action={formAction}
      className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm"
    >
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-500">Use your counter or staff login.</p>
      </div>

      {message && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </div>
      )}

      <input type="hidden" name="next" value={next} />

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Email</span>
        <input
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="username"
          defaultValue={state.email}
          placeholder="cl1@ichiba.local"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <LogIn className="h-5 w-5" aria-hidden />}
        <span>{isPending ? "Signing in…" : "Sign in"}</span>
      </button>
    </form>
  );
}
