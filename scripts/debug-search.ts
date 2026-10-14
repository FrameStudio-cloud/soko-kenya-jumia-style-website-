import { sql, close, branch } from "./db";

/*
  Explains why a search term returns nothing. Prints the parsed tsquery, the
  stemmed lexemes, and whether each term appears in search_vector — because
  "0 results" has four different causes and the API does not distinguish them.
*/
const terms = process.argv.slice(2);
if (terms.length === 0) {
  console.error("usage: npx tsx scripts/debug-search.ts <term> [term...]");
  process.exit(1);
}

for (const term of terms) {
  console.log(`\n=== "${term}" ===`);

  // to_tsvector(regconfig, text) has no tsquery overload — to_tsvector takes
  // text, so the tsquery must be cast back first.
  const [parsed] = await sql<{ query: string; lexemes: string }>(`
    SELECT websearch_to_tsquery('english', $1)::text AS query,
           to_tsvector('english', websearch_to_tsquery('english', $1)::text)::text AS lexemes
  `, [term]);
  console.log(`  parsed tsquery: ${parsed.query}`);
  console.log(`  stemmed lexemes: ${parsed.lexemes}`);

  const rows = await sql<{
    slug: string;
    title: string;
    brand: string;
    vector_lexemes: string;
    matches: boolean;
    tags: string[];
  }>(
    `SELECT p.slug, p.title, p.brand, p.tags,
            p.search_vector::text AS vector_lexemes,
            p.search_vector @@ websearch_to_tsquery('english', $1) AS matches
     FROM products p
     ORDER BY p.slug`,
    [term],
  );

  for (const r of rows) {
    console.log(`  ${r.matches ? "MATCH  " : "no     "} ${r.slug}`);
    console.log(`          title  : ${r.title.slice(0, 56)}`);
    console.log(`          lexemes: ${r.vector_lexemes.slice(0, 110)}`);
    console.log(`          tags   : ${(r.tags ?? []).join(", ") || "(none)"}`);
  }
}

await close();
console.log(`\nbranch: ${branch()}`);
