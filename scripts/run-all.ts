/*
  Runs every verification script in dependency order and reports one verdict.

  Exists because "I ran the tests and they passed" is only meaningful if
  someone can tell WHICH tests, and because the suite is easy to run
  inconsistently by hand — which is how a phase gets declared done with the
  race test quietly skipped.

  Usage: npx tsx scripts/run-all.ts
*/
import { spawn } from "node:child_process";

type Suite = {
  name: string;
  script: string;
  needs?: string; // must run after this
  /**
   * Needs a running server (SMOKE_BASE_URL). Excluded by default, because
   * `npm test` has to work with nothing else running — the HTTP suites are run
   * deliberately, by someone who started a server on purpose.
   */
  requiresServer?: boolean;
};

const SUITES: Suite[] = [
  { name: "migration bookkeeping", script: "scripts/check-migrations.ts" },
  {
    name: "schema sync",
    script: "scripts/verify-schema-sync.ts",
    needs: "migration bookkeeping",
  },
  { name: "schema constraints", script: "scripts/verify-constraints.ts" },
  { name: "cart schema", script: "scripts/verify-cart-schema.ts" },
  {
    name: "ratings",
    script: "scripts/test-ratings.ts",
    needs: "schema constraints",
  },
  {
    name: "admin auth + order rules",
    script: "scripts/test-admin-orders.ts",
    needs: "schema constraints",
  },
  {
    name: "catalogue editing",
    script: "scripts/test-admin-products.ts",
    needs: "admin auth + order rules",
  },
  {
    name: "reservation race",
    script: "scripts/test-reservation-race.ts",
    needs: "cart schema",
  },
  {
    name: "cart behaviour",
    script: "scripts/test-cart-behaviour.ts",
    needs: "cart schema",
  },
  {
    name: "checkout conversion",
    script: "scripts/test-checkout.ts",
    needs: "cart behaviour",
  },
  {
    name: "placeOrder (real code path)",
    script: "scripts/test-place-order-real.ts",
    needs: "checkout conversion",
  },
  {
    /*
      Deliberately after the checkout suites rather than beside the other admin
      ones. It drives placeOrder() itself and temporarily rewrites Nairobi's
      delivery fee, restoring it in line — so if it dies partway, running it
      first would leave the checkout suite asserting a fee that is no longer
      there and failing for a reason of ours.
    */
    name: "moderation",
    script: "scripts/test-admin-moderation.ts",
    needs: "placeOrder (real code path)",
  },
  {
    name: "filters (HTTP)",
    script: "scripts/test-filters.ts",
    needs: "placeOrder (real code path)",
    requiresServer: true,
  },
  {
    name: "checkout surface (HTTP)",
    script: "scripts/smoke-checkout-page.ts",
    requiresServer: true,
  },
  {
    name: "admin guard (HTTP)",
    script: "scripts/smoke-admin-pages.ts",
    needs: "admin auth + order rules",
    requiresServer: true,
  },
];

const includeHttp = process.argv.includes("--http");
const selected = includeHttp
  ? SUITES
  : SUITES.filter((s) => !s.requiresServer);

type Outcome = { suite: string; code: number; tail: string[] };

function run(suite: Suite): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", suite.script], {
      shell: true,
      env: process.env,
    });

    const lines: string[] = [];
    child.stdout.on("data", (d) => lines.push(...String(d).split("\n")));
    child.stderr.on("data", (d) => lines.push(...String(d).split("\n")));

    child.on("close", (code) =>
      resolve({ suite: suite.name, code: code ?? 1, tail: lines }),
    );
  });
}

console.log(`running ${selected.length} suites\n`);

if (!includeHttp) {
  const skipped = SUITES.length - selected.length;
  if (skipped > 0) {
    console.log(
      `  (${skipped} HTTP suite${skipped === 1 ? "" : "s"} skipped — pass --http with SMOKE_BASE_URL set to include them)\n`,
    );
  }
}

const results: Outcome[] = [];

for (const suite of selected) {
  process.stdout.write(`  ${suite.name} ... `);
  const outcome = await run(suite);
  results.push(outcome);
  console.log(outcome.code === 0 ? "pass" : "FAIL");

  // On failure, surface the assertions that failed rather than the noise.
  if (outcome.code !== 0) {
    const relevant = outcome.tail.filter(
      (l) => /FAIL|error|Error|Result|RESULT/.test(l) && l.trim(),
    );
    for (const line of relevant.slice(0, 12)) {
      console.log(`      ${line.trim()}`);
    }
  }
}

const failed = results.filter((r) => r.code !== 0);

console.log(`\n${results.length - failed.length}/${results.length} suites passed`);

if (failed.length > 0) {
  console.log(`\nfailed: ${failed.map((f) => f.suite).join(", ")}`);
  process.exit(1);
}

console.log("\nall green");
