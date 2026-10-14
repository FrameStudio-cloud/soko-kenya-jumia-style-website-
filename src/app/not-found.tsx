export default function NotFound() {
  return (
    <div className="rounded-card bg-card p-10 text-center shadow-card">
      <h1 className="text-2xl font-bold">We couldn&apos;t find that page</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
        The link may be old, or the product may have sold out and been removed
        by its seller.
      </p>
      <a
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-control bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-hover"
      >
        Back to the marketplace
      </a>
    </div>
  );
}