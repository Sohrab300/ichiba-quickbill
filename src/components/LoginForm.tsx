"use client";

import { useActionState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { signIn, type SignInState } from "@/lib/auth-actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { Input, labelClasses } from "@/components/ui/Field";

export default function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, isPending] = useActionState<SignInState, FormData>(signIn, {});
  const message = state.error ?? notice;

  return (
    <form action={formAction} className={cardClasses({ strong: true, className: "w-full max-w-sm space-y-5 p-6" })}>
      <div>
        <h1 className="font-display text-4xl leading-none font-extrabold">Sign in</h1>
        <p className="mt-2 text-base text-ink-muted">Use your counter or staff login.</p>
      </div>

      {message && (
        <Alert tone="danger" size="sm" role="alert">
          {message}
        </Alert>
      )}

      <input type="hidden" name="next" value={next} />

      <label className="block space-y-1.5">
        <span className={labelClasses}>Email</span>
        <Input
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="username"
          defaultValue={state.email}
          placeholder="you@ichiba.local"
          fieldSize="lg"
        />
      </label>

      <label className="block space-y-1.5">
        <span className={labelClasses}>Password</span>
        <Input name="password" type="password" required autoComplete="current-password" fieldSize="lg" />
      </label>

      <Button type="submit" variant="primary" size="lg" block disabled={isPending}>
        {isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <LogIn className="h-5 w-5" aria-hidden />}
        <span>{isPending ? "Signing in…" : "Sign in"}</span>
      </Button>
    </form>
  );
}
