"use client";

import { useActionState } from "react";
import { loginAction, type LoginResult } from "@/app/actions/admin/auth";

/*
  The admin password form.

  The only page in the app rendered without the admin guard, and deliberately
  outside the (protected) route group so it does not guard itself into a
  redirect loop.

  autocomplete="current-password" so a password manager offers the right entry,
  and the field is NOT type="url"/hidden in any way — it is a normal password
  field, so the browser will not refuse to save it.
*/
export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginResult | null, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Admin password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="h-12 w-full rounded-control border border-hairline bg-card px-3 text-base text-ink focus:border-brand"
        />
      </div>

      {state && !state.ok && (
        <p
          role="alert"
          className="rounded-control border-l-4 border-l-sale bg-sale-tint px-4 py-3 text-sm font-medium text-ink"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-control bg-ink text-base font-semibold text-white hover:bg-ink-2 disabled:opacity-60"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}