import { NextResponse } from "next/server";
import { issueCartSessionCookie } from "@/lib/cart";

/*
  Mints the cart session cookie.

  This exists as a Route Handler for one reason: Next.js only permits cookie
  writes in a Server Action or Route Handler. Minting it during a page render
  threw and 500'd /cart, because reads and writes have to happen in different
  places.

  The browser is redirected to `next` afterwards rather than returning JSON,
  so the shopper lands on a real page. No-JS clients hit the JSON branch and
  can still obtain a session, which matters because the cart has to work
  without JavaScript as far as the server allows.
*/
export async function GET(request: Request) {
  await issueCartSessionCookie();

  const next = new URL(request.url).searchParams.get("next");
  // Only same-origin relative paths. An absolute URL here would be an open
  // redirect: anyone could send a shopper to /cart/session?next=evil.example.
  const target =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (request.headers.get("accept")?.includes("text/html")) {
    return NextResponse.redirect(new URL(target, request.url));
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
