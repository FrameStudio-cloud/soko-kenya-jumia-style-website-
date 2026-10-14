import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminChoices,
  getAdminProductDetail,
  PRODUCT_STATUS_LABEL,
} from "@/lib/admin-products";
import { toFormValues } from "@/lib/admin-product-rules";
import { ProductEditForm } from "@/components/admin/ProductEditForm";
import { formatPrice, imageUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, choices] = await Promise.all([
    getAdminProductDetail(id),
    getAdminChoices(),
  ]);

  // Unknown id. notFound() rather than an empty form, and inside the admin
  // guard, so an unauthenticated caller cannot probe for product ids either.
  if (!product) notFound();

  const src = imageUrl(product.imageKey);
  const isActive = product.status === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/products" className="text-sm text-ink-2 hover:text-brand">
            ← Products
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{product.title}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {product.sellerName} · {product.categoryName}
          </p>
        </div>
        <span className="rounded-sm bg-brand-tint px-2 py-1 text-xs font-medium text-brand">
          {PRODUCT_STATUS_LABEL[product.status]}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <div className="overflow-hidden rounded-card bg-card shadow-card">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={product.title}
                width={400}
                height={400}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square items-center justify-center bg-canvas text-sm text-ink-3">
                No image
              </div>
            )}
          </div>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-ink-3">Price</dt>
              <dd className="font-semibold">{formatPrice(product.price)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Stock</dt>
              <dd className="font-semibold">
                {product.stock}
                {product.stockReserved > 0 && (
                  <span className="ml-1 font-normal text-ink-3">
                    ({product.stockReserved} held in carts)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Last updated</dt>
              <dd>
                {new Date(product.updatedAt).toLocaleString("en-KE", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>

          {/*
            The live URL, so an operator can see what they are about to break.
            Shown greyed with an explanation when unpublished, because a dead
            link rendered as a normal link invites a confusing support call.
          */}
          <div className="rounded-card border border-hairline-2 p-3 text-sm">
            <p className="text-ink-3">Public page</p>
            {isActive ? (
              <Link
                href={`/product/${product.slug}`}
                className="font-medium text-brand hover:underline"
              >
                /product/{product.slug}
              </Link>
            ) : (
              <>
                <p className="font-medium text-ink-3">/product/{product.slug}</p>
                <p className="mt-1 text-xs text-ink-3">
                  Not reachable — this product is {PRODUCT_STATUS_LABEL[product.status].toLowerCase()}.
                </p>
              </>
            )}
          </div>
        </aside>

        <section className="rounded-card bg-card p-5 shadow-card">
          <h2 className="mb-4 text-lg font-semibold">Edit</h2>
          {/*
            No `key` here on purpose. The form syncs from `initialUpdatedAt`
            itself, so a successful save adopts the stored rows while keeping
            the "Saved." confirmation — keying would remount the component and
            throw the message away. See ProductEditForm.
          */}
          <ProductEditForm
            productId={product.id}
            initial={toFormValues(product)}
            initialUpdatedAt={product.updatedAt}
            stockReserved={product.stockReserved}
            categories={choices.categories}
            sellers={choices.sellers}
          />
        </section>
      </div>
    </div>
  );
}
