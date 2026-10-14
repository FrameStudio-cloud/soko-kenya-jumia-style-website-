/*
  Seeds sellers, categories, delivery areas and the sample catalogue.

  Idempotent: every insert is ON CONFLICT DO UPDATE keyed on the natural
  slug, so re-running refreshes prices and stock without duplicating rows.
  That matters because this seeds a dev branch repeatedly.

  Run: npx tsx scripts/seed.ts
*/
import { branch, close, sql } from "./db";
import type { Row } from "./db";

/* --------------------------------------------------------------- categories */

const categorySeed = [
  ["phones-and-tablets", "Phones & Tablets"],
  ["electronics", "Electronics"],
  ["fashion", "Fashion"],
  ["home-and-kitchen", "Home & Kitchen"],
  ["beauty", "Beauty"],
  ["sports", "Sports"],
  ["groceries", "Groceries"],
  ["automotive", "Automotive"],
];

for (const [slug, name] of categorySeed) {
  await sql(
    `INSERT INTO categories (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
    [slug, name],
  );
}
console.log(`seeded ${categorySeed.length} categories`);

/* ------------------------------------------------------------------ sellers */

const sellerSeed = [
  {
    slug: "nairobi-electronics",
    name: "Nairobi Electronics Hub",
    location: "Nairobi",
    rating: "4.60",
    ratingCount: 12840,
    onTimeRate: "0.940",
    joinedYear: 2019,
    verified: true,
    official: true,
  },
  {
    slug: "savannah-home",
    name: "Savannah Home Goods",
    location: "Mombasa",
    rating: "4.40",
    ratingCount: 3120,
    onTimeRate: "0.890",
    joinedYear: 2021,
    verified: true,
    official: false,
  },
  {
    slug: "karibu-tech",
    name: "Karibu Tech",
    location: "Kisumu",
    rating: "4.20",
    ratingCount: 860,
    onTimeRate: "0.820",
    joinedYear: 2023,
    verified: false,
    official: false,
  },
];

const sellerIds: Record<string, string> = {};
for (const s of sellerSeed) {
  const [row] = await sql<Row>(
    `INSERT INTO sellers
       (slug, name, location, rating, rating_count, on_time_rate, joined_year,
        is_verified, is_official_store)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, rating = EXCLUDED.rating,
       rating_count = EXCLUDED.rating_count, on_time_rate = EXCLUDED.on_time_rate,
       is_verified = EXCLUDED.is_verified,
       is_official_store = EXCLUDED.is_official_store
     RETURNING id`,
    [
      s.slug, s.name, s.location, s.rating, s.ratingCount,
      s.onTimeRate, s.joinedYear, s.verified, s.official,
    ],
  );
  sellerIds[s.slug] = row.id;
}
console.log(`seeded ${sellerSeed.length} sellers`);

/* ----------------------------------------------------------- delivery areas */

const deliverySeed = [
  ["Nairobi", "150.00", null, 1, 1],
  ["Mombasa", "250.00", "5000.00", 2, 3],
  ["Kisumu", "200.00", "5000.00", 2, 3],
  ["Nakuru", "220.00", "6000.00", 2, 3],
  ["Uasin Gishu", "260.00", "6000.00", 3, 5],
];

for (const [county, fee, threshold, min, max] of deliverySeed) {
  await sql(
    `INSERT INTO delivery_areas
       (county, base_fee, free_delivery_threshold, eta_days_min, eta_days_max)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (county) DO UPDATE SET
       base_fee = EXCLUDED.base_fee,
       free_delivery_threshold = EXCLUDED.free_delivery_threshold,
       eta_days_min = EXCLUDED.eta_days_min,
       eta_days_max = EXCLUDED.eta_days_max`,
    [county, fee, threshold, min, max],
  );
}
console.log(`seeded ${deliverySeed.length} delivery areas`);

/* ----------------------------------------------------------------- products */

const productSeed = [
  {
    slug: "anker-powercore-20000mah",
    title: "Anker PowerCore 20000mAh Power Bank with 30W PD Fast Charge",
    description:
      "20,000mAh capacity with 30W USB-C Power Delivery. Charges an iPhone twice over, or a 13-inch laptop once. Two USB-A ports for older devices.",
    price: "8490.00",
    compareAt: "11990.00",
    stock: 42,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "Anker",
    rating: "4.70",
    ratingCount: 3120,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Capacity: '20000mAh', Output: '30W USB-C PD', Ports: '2x USB-A, 1x USB-C', Warranty: '18 months' },
    tags: ['power bank', 'charger', 'usb-c'],
  },
  {
    slug: "samsung-galaxy-a15-128gb",
    title: "Samsung Galaxy A15 128GB Dual SIM Android Smartphone — Black",
    description:
      "6.5-inch Super AMOLED display at 90Hz, 6GB RAM, 128GB storage and a 5000mAh battery. Dual SIM, unlocked, with a 12-month warranty.",
    price: "27999.00",
    compareAt: "32500.00",
    stock: 8,
    seller: "karibu-tech",
    category: "phones-and-tablets",
    brand: "Samsung",
    rating: "4.40",
    ratingCount: 1840,
    deliveryFee: "250.00",
    etaDays: 3,
    official: true,
    specs: {
      Display: '6.5" Super AMOLED 90Hz',
      Storage: "128GB",
      RAM: "6GB",
      Battery: "5000mAh",
      Warranty: "12 months",
    },
    tags: ["samsung", "android", "smartphone"],
  },
  {
    slug: "jinja-ceramic-cookware-set",
    title: "Ceramic Non-Stick Cookware Set, 8 Piece — Granite Coating",
    description:
      "Eight-piece granite-coated set: 3 saucepans, a frying pan, a deep pan, 2 lids and a utensil set. Works on gas, electric and induction.",
    price: "6450.00",
    compareAt: null,
    stock: 23,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Jinja",
    rating: "4.10",
    ratingCount: 412,
    deliveryFee: "200.00",
    etaDays: 4,
    official: false,
    specs: {
      Pieces: "8",
      Coating: "Granite non-stick",
      Compatibility: "Gas, electric, induction",
      Warranty: "1 year",
    },
    tags: ["cookware", "kitchen"],
  },
  {
    slug: "jbl-flip-6-portable-speaker",
    title: "JBL Flip 6 Portable Waterproof Bluetooth Speaker — Blue",
    description:
      "12-hour battery, IP67 waterproof and dustproof, Bluetooth 5.1. PartyBoost links two speakers in stereo.",
    price: "11990.00",
    compareAt: "13500.00",
    stock: 0,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "JBL",
    rating: "4.80",
    ratingCount: 2200,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: {
      Battery: "12 hours",
      Rating: "IP67 waterproof",
      Connectivity: "Bluetooth 5.1",
      Warranty: "12 months",
    },
    tags: ["speaker", "bluetooth", "audio"],
  },
  {
    slug: "dyson-v12-detect-silver",
    title: "Dyson V12 Detect Slim Cordless Vacuum Cleaner",
    description:
      "150AW suction, 60-minute runtime, laser dust detection on hard floors. 2.2kg with a two-year warranty.",
    price: "74900.00",
    compareAt: "89900.00",
    stock: 3,
    seller: "nairobi-electronics",
    category: "home-and-kitchen",
    brand: "Dyson",
    rating: "4.90",
    ratingCount: 340,
    deliveryFee: "0.00",
    etaDays: 1,
    official: true,
    specs: {
      Suction: "150AW",
      Runtime: "60 minutes",
      Weight: "2.2kg",
      Warranty: "2 years",
    },
    tags: ["vacuum", "cleaning"],
  },
  {
    slug: "nike-air-max-runner",
    title: "Nike Air Max Runner Men's Running Shoes — Size 42",
    description:
      "Engineered mesh upper with a foam midsole and a rubber outsole. Size 42 (EU 43), black and white.",
    price: "8999.00",
    compareAt: "12499.00",
    stock: 15,
    seller: "savannah-home",
    category: "fashion",
    brand: "Nike",
    rating: "4.30",
    ratingCount: 920,
    deliveryFee: "180.00",
    etaDays: 3,
    official: false,
    specs: {
      Size: "42 (EU 43)",
      Colour: "Black/White",
      Upper: "Engineered mesh",
      Warranty: "6 months",
    },
    tags: ["shoes", "running", "nike"],
  },
];

for (const p of productSeed) {
  const [row] = await sql<Row>(
    `INSERT INTO products
       (slug, title, description, price, compare_at_price, stock, seller_id,
        category_id, brand, rating, rating_count, delivery_fee,
        delivery_estimate_days, specs, tags, status)
     SELECT $1,$2,$3,$4,$5,$6,$7,c.id,$8,$9,$10,$11,$12,$13::jsonb,$14,'active'
     FROM categories c WHERE c.slug = $15
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       price = EXCLUDED.price, compare_at_price = EXCLUDED.compare_at_price,
       stock = EXCLUDED.stock, brand = EXCLUDED.brand,
       rating = EXCLUDED.rating, rating_count = EXCLUDED.rating_count,
       delivery_fee = EXCLUDED.delivery_fee,
       delivery_estimate_days = EXCLUDED.delivery_estimate_days,
       specs = EXCLUDED.specs, tags = EXCLUDED.tags,
       status = 'active'
     RETURNING id`,
    [
      p.slug, p.title, p.description, p.price, p.compareAt, p.stock,
      sellerIds[p.seller], p.brand, p.rating, p.ratingCount, p.deliveryFee,
      p.etaDays, JSON.stringify(p.specs), p.tags, p.category,
    ],
  );

  if (!row) {
    throw new Error(`category ${p.category} missing — cannot seed ${p.slug}`);
  }

  /*
    Official Store is a SELLER credential, not a product one. A product from a
    verified seller is official whatever it is; storing the flag per product
    would let one product in a seller's catalogue claim it while its siblings
    do not. Any seller that sells an official item gets the badge.
  */
  if (p.official) {
    await sql(
      `UPDATE sellers SET is_official_store = true, is_verified = true WHERE id = $1`,
      [sellerIds[p.seller]],
    );
  }
}
console.log(`seeded ${productSeed.length} products`);

/* ------------------------------------------------------------ verification */

const counts = await sql<Row>(
  `SELECT
     (SELECT count(*) FROM sellers)   AS sellers,
     (SELECT count(*) FROM categories) AS categories,
     (SELECT count(*) FROM products)   AS products,
     (SELECT count(*) FROM delivery_areas) AS delivery_areas,
     (SELECT count(*) FROM products WHERE search_vector IS NULL) AS unsearchable`,
);
console.log("\n--- row counts ---");
console.log(counts[0]);

/*
  If unsearchable > 0, the generated column is not populating and search
  will silently return nothing for those rows.
*/
if (Number(counts[0].unsearchable) > 0) {
  console.error(
    `\nFAIL: ${counts[0].unsearchable} products have a NULL search_vector`,
  );
  process.exitCode = 1;
} else {
  console.log("pass  every product has a populated search_vector");
}

const hit = await sql<Row>(
  `SELECT slug, ts_rank(search_vector, websearch_to_tsquery('english',$1)) AS rank
   FROM products
   WHERE search_vector @@ websearch_to_tsquery('english',$1)
   ORDER BY rank DESC LIMIT 3`,
  ["samsung"],
);
console.log(`\nfull-text search "samsung" -> ${hit.length} hit(s)`);
for (const h of hit) console.log(`  ${h.slug}  rank=${Number(h.rank).toFixed(4)}`);

await close();
console.log(`\ndone. branch: ${branch()}`);
