import { data, isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/admin.analytics";
import { getCourseAnalytics } from "~/services/analyticsService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  CourseStatusBadge,
  StatTile,
  formatPercent,
  formatRevenue,
} from "~/components/analytics";
import { AlertTriangle } from "lucide-react";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Platform-wide course analytics" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view analytics.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return getCourseAnalytics(null);
}

const th =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground";
const thNum = `${th} text-right`;
const td = "px-4 py-3 text-sm";
const tdNum = `${td} text-right tabular-nums`;

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-8 h-9 w-48" />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export default function AdminAnalytics({ loaderData }: Route.ComponentProps) {
  const { totals, courses, instructors } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          All-time numbers across every instructor. Draft courses are listed but
          not counted in totals.
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Students" value={String(totals.studentCount)} hint="Unique, platform-wide" />
        <StatTile label="Revenue" value={formatRevenue(totals.revenue)} hint="Gross, all time" />
        <StatTile label="Completion" value={formatPercent(totals.completionRate)} hint="Finished every lesson" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">By instructor</h2>
      <Card className="mb-8 py-0">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={th}>Instructor</th>
                  <th className={thNum}>Students</th>
                  <th className={thNum}>Revenue (gross)</th>
                  <th className={thNum}>Completion</th>
                </tr>
              </thead>
              <tbody>
                {instructors.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={`${td} text-center text-muted-foreground`}>
                      No published or archived courses yet.
                    </td>
                  </tr>
                ) : (
                  instructors.map((instructor) => (
                    <tr key={instructor.id} className="border-b border-border last:border-0">
                      <td className={`${td} font-medium`}>{instructor.name}</td>
                      <td className={tdNum}>{instructor.studentCount}</td>
                      <td className={tdNum}>{formatRevenue(instructor.revenue)}</td>
                      <td className={tdNum}>{formatPercent(instructor.completionRate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">By course</h2>
      <Card className="py-0">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className={th}>Course</th>
                  <th className={th}>Instructor</th>
                  <th className={th}>Status</th>
                  <th className={thNum}>Students</th>
                  <th className={thNum}>Revenue (gross)</th>
                  <th className={thNum}>Completion</th>
                  <th className={thNum}>Avg. progress</th>
                </tr>
              </thead>
              <tbody>
                {courses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={`${td} text-center text-muted-foreground`}>
                      No courses yet.
                    </td>
                  </tr>
                ) : (
                  courses.map((course) => (
                    <tr key={course.id} className="border-b border-border align-top last:border-0">
                      <td className={`${td} font-medium`}>{course.title}</td>
                      <td className={td}>{course.instructor.name}</td>
                      <td className={td}>
                        <CourseStatusBadge status={course.status} />
                      </td>
                      <td className={tdNum}>{course.studentCount}</td>
                      <td className={tdNum}>{formatRevenue(course.revenue)}</td>
                      <td className={tdNum}>{formatPercent(course.completionRate)}</td>
                      <td className={tdNum}>{formatPercent(course.averageProgress)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
