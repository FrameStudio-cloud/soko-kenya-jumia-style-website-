import Link from "next/link";
import { ProductGrid } from "@/components/ProductGrid";
import { CategoryRail } from "@/components/Header";
import { getActiveProducts, getCategories, getDeals } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  /*
    Sequential, and deliberately so. These are three small reads against one
    regional database ~150ms from the user; Promise.all would shave perhaps
    60ms and hide the queries behind one another's failures. If this page
    ever gets slower, the fix is caching, not parallelising.
  */
  const categories = await getCategories();
  const deals = await getDeals(5);
  const fresh = await getActiveProducts(5);

  return (
    <div className="space-y-10">
      {/*
        The hero carries one job: say what this is. Jumia stacks promo tiles
        here; we lead with the search bar already in the header and keep this
        to positioning plus the category grid.
      */}
      <section className="rounded-card bg-ink p-6 sm:p-8">
        <h1 className="max-w-xl text-3xl font-bold leading-tight text-white sm:text-4xl">
          Everything Kenyan sellers offer, in one place
        </h1>
        <p className="mt-2 max-w-lg text-base text-white/80">
          Verified sellers, delivery estimates you can see before you commit,
          and prices in Kenyan shillings with no conversion maths.
        </p>
      </section>

      <section aria-labelledby="cats">
        <h2 id="cats" className="mb-3 text-xl font-semibold">
          Shop by category
        </h2>
        <CategoryRail categories={categories} />
      </section>

      <ProductGrid products={deals} label="Deals" />
      <ProductGrid products={fresh} label="Recently added" />
    </div>
  );
}
