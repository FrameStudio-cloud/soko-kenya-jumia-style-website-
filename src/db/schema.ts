import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
  Money is stored as numeric(12,2), never float. KSh amounts are whole
  shillings today, but "numeric" keeps the door open for cents when a
  cross-border seller appears, and doing that migration later is painful.
*/
const kes = (name: string) => numeric(name, { precision: 12, scale: 2 });

/*
  Drizzle has no native tsvector column type. This maps the Postgres type
  through, and its builder carries `.generatedAlwaysAs()` from the shared
  column-builder, so a generated column works on it as it does on `text`.
*/
const tsvectorColumn = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/* ------------------------------------------------------------------ sellers */

export const sellers = pgTable(
  "sellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    location: text("location").notNull(),
    phone: text("phone"),
    rating: numeric("rating", { precision: 3, scale: 2 }).default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    onTimeRate: numeric("on_time_rate", { precision: 4, scale: 3 }).default("0"),
    joinedYear: integer("joined_year").notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    isOfficialStore: boolean("is_official_store").notNull().default(false),

    /*
      Suspended, added by migration 0008 for the admin back office.

      Deliberately NOT modelled as isVerified = false. Unverified is a claim
      about the past ("we have not checked them"); suspended is a decision about
      the present ("we are refusing to serve them right now"). They are different
      facts, and only one of them is a decision someone made on a date.

      It also has to be its own column to be actionable: nothing in the
      catalogue read path filters on is_verified, so a seller "suspended" by
      flipping that flag would keep selling. Phase 4 adds
      `status = 'active'` to those reads.
    */
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    /** When the suspension took effect. NULL while active; kept after reactivation. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /** Why an admin suspended this seller. Staff-only, never shown to shoppers. */
    suspensionReason: text("suspension_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sellers_slug_key").on(table.slug),
    check("sellers_rating_range", sql`${table.rating} >= 0 AND ${table.rating} <= 5`),
  ],
);

export const sellerRelations = relations(sellers, ({ many }) => ({
  products: many(products),
  orders: many(orders),
}));

/* --------------------------------------------------------------- categories */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
  },
  (table) => [
    uniqueIndex("categories_slug_key").on(table.slug),
    index("categories_parent_idx").on(table.parentId),
  ],
);

/* ----------------------------------------------------------------- products */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    price: kes("price").notNull(),
    /*
      NULL means "never discounted". A row equal to price would let us strike
      through the real price and claim a 0% saving.
    */
    compareAtPrice: kes("compare_at_price"),
    /*
      Physical units on hand. Never derived — it is what the seller counted.

      DECREMENTED ONLY at checkout, never when an item enters a cart. Cart
      holds live in stock_reservations instead, so an abandoned cart cannot
      shrink the number the seller manages.
    */
    stock: integer("stock").notNull().default(0),
    /*
      Units currently held across all live reservations, maintained
      atomically by the same UPDATE that checks availability.

      Denormalised on purpose: it makes the availability check a single
      indexed row lock instead of a SUM over reservations. The alternative —
      computing stock - sum(active holds) on every read — has no gap to race
      in, but it needs a lock anyway to write the hold, so the aggregate buys
      nothing and costs a scan.
    */
    stockReserved: integer("stock_reserved").notNull().default(0),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    brand: text("brand"),
    rating: numeric("rating", { precision: 3, scale: 2 }).default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    deliveryFee: kes("delivery_fee").notNull().default("0"),
    deliveryEstimateDays: integer("delivery_estimate_days"),
    /*
      Specs as JSONB rather than a spec table for phase 1. Sellers do not
      manage specs yet, so the read is always "all of them" and a table would
      buy nothing but joins. The API returns the same object either way, so
      promoting it later touches the query, not the components.
    */
    specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
    /*
      Exact short keywords, searched with ILIKE rather than the tsvector.
      "usb-c" is a literal tag, not prose: tsquery stems the term and can drop
      the hyphen, so full-text is the wrong tool here.
    */
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    /*
      GENERATED ALWAYS AS STORED. Postgres recomputes it on every write, so
      the index can never drift from the text it indexes — the failure mode a
      trigger or app-maintained column has is a product silently becoming
      unfindable, which is invisible until someone searches for it.

      Referenced by raw column name, not `${products.title}`. A self-reference
      inside the table's own initializer is circular, and Drizzle's inference
      cannot resolve it.
    */
    searchVector: tsvectorColumn("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english',
            coalesce(title, '') || ' ' ||
            coalesce(brand, '')
          )`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("products_slug_key").on(table.slug),
    // Covers the default catalogue query: active products, newest first.
    index("products_status_created_idx").on(table.status, table.createdAt),
    index("products_seller_idx").on(table.sellerId),
    index("products_category_idx").on(table.categoryId),
    // GIN on the tsvector. Without this, websearch_to_tsquery falls back to a
    // sequential scan and search silently gets slower as the catalogue grows.
    index("products_search_idx").using("gin", table.searchVector),
    check("products_price_positive", sql`${table.price} > 0`),
    check("products_stock_nonneg", sql`${table.stock} >= 0`),
    check("products_stock_reserved_nonneg", sql`${table.stockReserved} >= 0`),
    /*
      Holds can never exceed stock on hand. This is the database-level backstop
      for overselling: even if application logic miscounts, a reservation that
      would push reserved past stock is rejected outright.
    */
    check(
      "products_reserved_not_over_stock",
      sql`${table.stockReserved} <= ${table.stock}`,
    ),
    /*
      Database-enforced invariant the UI cannot bypass: a compare-at price
      must be strictly above the selling price. The -0% badge is impossible
      even if someone writes bad code.
    */
    check(
      "products_compare_at_greater",
      sql`${table.compareAtPrice} IS NULL OR ${table.compareAtPrice} > ${table.price}`,
    ),
  ],
);

export const productRelations = relations(products, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [products.sellerId],
    references: [sellers.id],
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  reviews: many(reviews),
}));

/* ------------------------------------------------------------------- images */

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /*
      S3 object KEY only, never a URL. The endpoint is branch-scoped, so a
      stored URL breaks the moment a preview branch is created — this is the
      one field that must never hold a full URL.
    */
    objectKey: text("object_key").notNull(),
    position: integer("position").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
  },
  (table) => [index("product_images_product_idx").on(table.productId, table.position)],
);

/* --------------------------------------------------------------- addresses */

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  /*
    Not FK'd to auth.users on purpose: Neon Auth keeps identity in the
    managed neon_auth schema, and a hard FK would couple our migrations to
    theirs. Better Auth's user id is text; we keep the column wide.
  */
  userId: text("user_id").notNull(),
  recipientName: text("recipient_name").notNull(),
  phone: text("phone").notNull(),
  county: text("county").notNull(),
  town: text("town").notNull(),
  street: text("street"),
  notes: text("notes"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const addressRelations = relations(addresses, ({ one }) => ({
  deliveryArea: one(deliveryAreas, {
    fields: [addresses.county],
    references: [deliveryAreas.county],
  }),
}));

/* ----------------------------------------------------------- delivery areas */

export const deliveryAreas = pgTable(
  "delivery_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    county: text("county").notNull(),
    baseFee: kes("base_fee").notNull(),
    /*
      Free above this basket value. NULL means no threshold exists, which is
      different from a threshold of 0 (everything ships free).
    */
    freeDeliveryThreshold: kes("free_delivery_threshold"),
    etaDaysMin: integer("eta_days_min").notNull().default(1),
    etaDaysMax: integer("eta_days_max").notNull().default(3),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("delivery_areas_county_key").on(table.county),
    check("delivery_areas_eta_order", sql`${table.etaDaysMin} <= ${table.etaDaysMax}`),
  ],
);

/* ------------------------------------------------------------------ orders */

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull(),
    userId: text("user_id"),
    /*
      One order belongs to exactly one seller. This is a marketplace, so a
      single basket becomes N orders at checkout — the shopper sees one
      payment, the seller fulfils one shipment. Splitting the basket into
      per-seller orders (rather than a cart holding mixed sellers) is what
      makes payouts, refunds and delivery tracking tractable later.
    */
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    status: text("status", {
      enum: [
        "pending_payment",
        "confirmed",
        "dispatched",
        "delivered",
        "cancelled",
        "refunded",
      ],
    })
      .notNull()
      .default("pending_payment"),
    /*
      Snapshot totals. Never recompute from line items later: a price edit
      after checkout must not change what the customer was charged.
    */
    subtotal: kes("subtotal").notNull(),
    deliveryTotal: kes("delivery_total").notNull().default("0"),
    grandTotal: kes("grand_total").notNull(),
    county: text("county").notNull(),
    /*
      Payment arrives in phase 4. Modelled now so the order row does not need
      an ALTER on a table that will hold real money.
    */
    paymentMethod: text("payment_method", {
      enum: ["cod", "mpesa"],
    }),
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "pending", "paid", "failed", "refunded"],
    })
      .notNull()
      .default("unpaid"),
    mpesaReceiptCode: text("mpesa_receipt_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /*
      The four columns below were added by migration 0007 and were missing from
      this file until scripts/verify-schema-sync.ts existed to say so.
      placeOrder has been writing all of them the whole time; the drift was
      invisible only because every query goes through raw pg rather than
      drizzle's builder.

      Checked by `npx tsx scripts/verify-schema-sync.ts`, which diffs this model
      against information_schema in both directions.
    */

    /*
      Immutable JSONB snapshot of the delivery address at checkout: recipient
      name, county, town, street.

      Never a FK to `addresses`, on purpose. A shopper may edit that row
      afterwards, and a reference would then point somewhere the parcel was not
      sent. An order has to keep describing the delivery it was actually placed
      for.

      Note that `addresses` is currently unusable anyway — its userId is NOT
      NULL and no auth exists yet — so this snapshot is the only place order
      addresses live. It is PII: recipient name, street and phone. Any admin
      surface must mask it by default and audit every reveal.
    */
    deliveryAddress: jsonb("delivery_address").notNull().default({}),
    /** PII. Never rendered without a recorded reveal. */
    deliveryPhone: text("delivery_phone"),
    /** Free text from the rider, e.g. "blue gate, call on arrival". PII-adjacent. */
    deliveryNotes: text("delivery_notes"),
    /*
      When an UNPAID order is voided and its stock returned. NULL for cash on
      delivery: the shopper owes nothing, so there is nothing to time out.

      Nothing sweeps this today. It stays modelled because the column and its
      partial index exist, and a real-but-unwatched column is a trap for the
      next person.
    */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("orders_reference_key").on(table.reference),
    index("orders_user_idx").on(table.userId),
    index("orders_seller_status_idx").on(table.sellerId, table.status),
    index("orders_status_created_idx").on(table.status, table.createdAt),
    check("orders_grand_total_positive", sql`${table.grandTotal} > 0`),
  ],
);

export const orderRelations = relations(orders, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [orders.sellerId],
    references: [sellers.id],
  }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
}));

/* ------------------------------------------------------------- order_items */

export const orderItems = pgTable(
  "order_items",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    /*
      Everything below is a snapshot of the product AT PURCHASE TIME. Title,
      price and stock all move; an order line must not.
    */
    titleSnapshot: text("title_snapshot").notNull(),
    unitPrice: kes("unit_price").notNull(),
    quantity: integer("quantity").notNull().default(1),
    lineTotal: kes("line_total").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.productId] }),
    index("order_items_product_idx").on(table.productId),
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

/* ------------------------------------------------------- order status history */

/*
  Append-only audit trail, created by migration 0007 and undeclared here until
  verify-schema-sync.ts caught it.

  Without it, "where is my order" can only be answered from the current row, and
  every status change becomes invisible. A dispute needs the sequence, not just
  the endpoint — and once an admin can move orders around, it needs to know who
  moved them and why.

  `changedBy` is text, not a FK, on purpose: the actor may be a shopper, a
  seller, the admin console, or the expiry sweep, and none of those is yet one
  table of identities. When accounts land, the value stays free text and gains a
  real id column beside it rather than being migrated.
*/
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** NULL for the initial transition, where there is no "from". */
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    changedBy: text("changed_by"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("order_status_history_order_idx").on(table.orderId, table.createdAt)],
);

/* ------------------------------------------------------------- admin audit */

/*
  Who looked at what, in the admin console.

  Masking a customer's phone number is only a privacy control if somebody can
  afterwards answer "who looked at it, and when". Without this table the masking
  is decoration — anyone with database access reads orders directly, and nothing
  records that they did.

  Separate from order_status_history on purpose. That table is about an order's
  state and is keyed by order_id; a reveal changes no status, so logging one
  there would invent a transition that never happened and corrupt the sequence
  a dispute depends on.

  Never store the revealed data itself. This log is read more often than the
  orders table, so copying PII into it would defeat the masking it records.
*/
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Free text, matching order_status_history.changed_by. No identities table yet. */
    actor: text("actor").notNull(),
    /** e.g. "reveal_delivery", "order_status_change", "login". */
    action: text("action").notNull(),
    /** What was acted on: an order reference, a product slug. Null if none. */
    target: text("target"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_audit_log_created_idx").on(table.createdAt),
    index("admin_audit_log_action_idx").on(table.action, table.createdAt),
  ],
);

/* ------------------------------------------------------- stock reservations */

/*
  The single most missed feature in a marketplace, and the reason an order
  placed without payment is harder than it looks.

  Two buyers race for the last unit. Both read stock=1, both add to cart,
  both reach checkout. Without a reservation row with a hard expiry, the
  second order either oversells or the first buyer's abandoned cart holds the
  unit forever.
*/
/* -------------------------------------------------------------------- carts */

/*
  Carts exist before accounts do. Phase 2 has no login, so a cart is keyed on
  a signed session cookie and belongs to whoever holds it. userId stays
  nullable so signing in can CLAIM a cart rather than orphaning it — the
  claim-on-login path is the whole reason the column is nullable now instead
  of added later.
*/
export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id"),
    /*
      One active cart per session. A partial unique index enforces this rather
      than application code, because two tabs racing to create a cart is
      exactly the case where a check-then-insert in app code duplicates.
    */
    status: text("status", { enum: ["active", "converted", "abandoned"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carts_active_session_key")
      .on(table.sessionId)
      .where(sql`${table.status} = 'active'`),
    index("carts_user_idx").on(table.userId),
  ],
);

/* ---------------------------------------------------------------- cart items */

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    /*
      Price when the buyer added it, so the cart can say "now KSh 8,990, was
      KSh 8,490" if the seller changed it. The BUYER still pays the current
      price at checkout — this is display-only, never used to compute a total.
    */
    addedPrice: kes("added_price").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One line per product. Re-adding increments rather than duplicating.
    uniqueIndex("cart_items_cart_product_key").on(table.cartId, table.productId),
    check("cart_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

/* ----------------------------------------------------------- stock reservations */

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /*
      A reservation belongs either to a cart (held, unconverted) or to an order
      (converted at checkout). Exactly one is set — enforced below — so a
      released-at-checkout reservation can never also be swept as an abandoned
      cart hold.
    */
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    /*
      Abandoned carts must release or stock leaks permanently.

      Availability is read as `stock - stock_reserved` — the COUNTER, not a
      live subquery over this table. So a lapsed row keeps suppressing
      availability until something decrements the counter; expiry alone does not
      free the unit. Every release path therefore has to move both, and the
      counter is the number that must never be trusted on its own.

      HAZARD: `cart_id` cascades, so `DELETE FROM carts` silently removes this
      cart's reservations WITHOUT releasing the counter. Availability then sits
      permanently below the truth and no amount of re-reserving recovers it.
      Release holds through the cart code (which decrements), never by deleting
      rows. If a counter is ever wrong, recompute it from the live rows rather
      than adjusting it by hand.
    */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("stock_reservations_expiry_idx").on(table.expiresAt),
    index("stock_reservations_product_idx").on(table.productId),
    /*
      Partial index for the availability calculation. It covers only live
      holds, which is the only set that query ever reads, so it stays small no
      matter how much history accumulates.
    */
    index("stock_reservations_live_idx")
      .on(table.productId)
      .where(sql`${table.releasedAt} IS NULL`),
    check("stock_reservations_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "stock_reservations_exactly_one_owner",
      sql`num_nonnulls(${table.cartId}, ${table.orderId}) = 1`,
    ),
  ],
);

/* ------------------------------------------------------------------ reviews */

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("reviews_product_idx").on(table.productId),
    // One review per buyer per product.
    uniqueIndex("reviews_user_product_key").on(table.userId, table.productId),
    check("reviews_rating_range", sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
  ],
);

/* ------------------------------------------------------- product search FTS */

/*
  Full-text search without an external service.

  A GENERATED ALWAYS AS STORED column keeps title and brand searchable with a
  GIN index, which is what the catalogue query needs. `english` config gives
  stemming, so "chargers" finds "charger".

  Generated rather than maintained by trigger or by app code: a trigger can
  be forgotten on the one INSERT path that does not fire it, and the failure
  is silent — a product simply stops being findable. A generated column cannot
  drift from its source.

  Lakebase Search (BM25) replaces this later without changing the query
  surface; see the neon-postgres skill.
*/
export const searchVector = sql`
  to_tsvector('english',
    coalesce(${products.title}, '') || ' ' ||
    coalesce(${products.brand}, '') || ' ' ||
    coalesce(${products.categoryId}, '')
  )
`;
