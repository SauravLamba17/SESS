/** Standard page header used inside portal content. Client-safe (no server
 * imports) so it can be used by both server and client page components. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
