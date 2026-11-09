import { Card, CardContent } from "~/components/ui/card";
import { CourseStatus } from "~/db/schema";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  [CourseStatus.Published]: {
    label: "Published",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  [CourseStatus.Draft]: {
    label: "Draft",
    className:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  [CourseStatus.Archived]: {
    label: "Archived",
    className:
      "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  },
};

export function CourseStatusBadge({ status }: { status: string }) {
  const badge = STATUS_BADGE[status];
  if (!badge) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

/** Cents → "$1,234.56". Zero renders as "$0.00", not "Free". */
export function formatRevenue(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** 0–1 fraction → "72%". Null (metric doesn't apply) → "—". */
export function formatPercent(fraction: number | null): string {
  if (fraction === null) return "—";
  return `${Math.round(fraction * 100)}%`;
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
