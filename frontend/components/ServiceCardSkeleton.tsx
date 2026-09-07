export default function ServiceCardSkeleton() {
  return (
    <div data-testid="service-card-skeleton" className="card p-4 sm:p-6 flex flex-col gap-4 animate-pulse min-w-0 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="h-5 w-40 max-w-[60%] bg-border/60 rounded" />
        <div className="h-5 w-16 bg-border/60 rounded-full shrink-0" />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <div className="h-3.5 w-full bg-border/50 rounded" />
        <div className="h-3.5 w-3/4 bg-border/50 rounded" />
      </div>

      {/* Endpoint bar */}
      <div data-testid="skeleton-endpoint" className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border min-w-0">
        <div className="h-3.5 w-48 max-w-[60%] bg-border/50 rounded flex-1" />
        <div className="h-3.5 w-10 bg-border/50 rounded ml-auto shrink-0" />
      </div>

      {/* Price + reputation row */}
      <div className="flex items-center justify-between gap-2">
        <div className="h-4 w-24 bg-border/60 rounded" />
        <div className="h-4 w-16 bg-border/50 rounded shrink-0" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-3 mt-1 gap-2">
        <div className="h-3 w-28 max-w-[50%] bg-border/50 rounded" />
        <div className="h-3 w-20 bg-border/50 rounded shrink-0" />
      </div>

      {/* Button */}
      <div data-testid="skeleton-button" className="h-11 w-full bg-border/40 rounded-full" />
    </div>
  );
}
