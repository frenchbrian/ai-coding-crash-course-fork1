import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courses,
  enrollments,
  purchases,
  users,
} from "~/db/schema";

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

  const countedInScope = and(inScope, ne(courses.status, CourseStatus.Draft));

  const courseRows = db
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      instructor: { id: users.id, name: users.name },
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
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
    .where(countedInScope)
    .get();

  return {
    totals: {
      studentCount: uniqueStudents?.count ?? 0,
      revenue: sumRevenue(counted),
    },
    courses: courseStats,
    instructors: instructorId === null ? instructorSubtotals(counted) : [],
  };
}

type CountedCourse = {
  instructor: { id: number; name: string };
  revenue: number;
};

function sumRevenue(rows: CountedCourse[]) {
  return rows.reduce((sum, c) => sum + c.revenue, 0);
}

function instructorSubtotals(counted: CountedCourse[]) {
  const uniqueStudentsByInstructor = new Map(
    db
      .select({
        instructorId: courses.instructorId,
        count: sql<number>`count(distinct ${enrollments.userId})`,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(ne(courses.status, CourseStatus.Draft))
      .groupBy(courses.instructorId)
      .all()
      .map((r) => [r.instructorId, r.count])
  );

  const byInstructor = new Map<number, CountedCourse[]>();
  for (const course of counted) {
    const rows = byInstructor.get(course.instructor.id) ?? [];
    rows.push(course);
    byInstructor.set(course.instructor.id, rows);
  }

  return [...byInstructor.values()].map((rows) => ({
    ...rows[0].instructor,
    studentCount: uniqueStudentsByInstructor.get(rows[0].instructor.id) ?? 0,
    revenue: sumRevenue(rows),
  }));
}
