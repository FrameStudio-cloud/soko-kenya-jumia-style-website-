import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Admin sign in — SokoKenya" };

/*
  Sits OUTSIDE the (protected) group on purpose. A guard in a shared layout
  would apply to this page too and redirect it to itself, forever.
*/
export default async function AdminLoginPage() {
  // Already signed in? Sending them back to a password box they do not need.
  if (await isAdmin()) redirect("/admin");

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-bold">Admin sign in</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">
        This area manages orders, stock and sellers. It is not for shoppers.
      </p>
      <LoginForm />
    </div>
  );
}