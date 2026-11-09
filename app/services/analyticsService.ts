import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, enrollments, purchases } from "~/db/schema";

// ─── Analytics Service ───
// All-time course analytics for the instructor and admin dashboards.
// Built from grouped aggregate queries — never per-course or per-student loops.
//
// Scope: an instructor id limits results to that instructor's courses; null
// means every course (admin). Draft courses are listed but excluded from
// totals; published and archived courses count.

export function getCourseAnalytics(instructorId: number | null) {
  const inScope =
    instructorId === null ? undefined : eq(courses.instructorId, instructorId);

  const courseRows = db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(inScope)
    .all();

  const studentCounts = new Map(
    db
      .select({
        courseId: enrollments.courseId,
        count: sql<number>`count(distinct ${enrollments.userId})`,
      })
      .from(enrollments)
      .groupBy(enrollments.courseId)
      .all()
      .map((r) => [r.courseId, r.count])
  );

  const revenues = new Map(
    db
      .select({
        courseId: purchases.courseId,
        total: sql<number>`sum(${purchases.amountPaid})`,
      })
      .from(purchases)
      .groupBy(purchases.courseId)
      .all()
      .map((r) => [r.courseId, r.total])
  );

  const courseStats = courseRows.map((course) => ({
    ...course,
    studentCount: studentCounts.get(course.id) ?? 0,
    revenue: revenues.get(course.id) ?? 0,
  }));

  const counted = courseStats.filter((c) => c.status !== CourseStatus.Draft);

  // Students are de-duplicated across courses, so this can't be summed per course.
  const uniqueStudents = db
    .select({ count: sql<number>`count(distinct ${enrollments.userId})` })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(and(inScope, ne(courses.status, CourseStatus.Draft)))
    .get();

  return {
    totals: {
      studentCount: uniqueStudents?.count ?? 0,
      revenue: counted.reduce((sum, c) => sum + c.revenue, 0),
    },
    courses: courseStats,
  };
}
