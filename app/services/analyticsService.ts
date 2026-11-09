import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courses,
  enrollments,
  LessonProgressStatus,
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

  const completions = completionByCourse();
  const quizzesByCourse = quizStatsByCourse();

  const courseStats = courseRows.map((course) => {
    const completion = completions.get(course.id);
    const quizzes = quizzesByCourse.get(course.id) ?? [];
    return {
      ...course,
      studentCount: studentCounts.get(course.id) ?? 0,
      revenue: revenues.get(course.id) ?? 0,
      completionRate: completion
        ? completion.completed / completion.enrolled
        : null,
      averageProgress: completion?.averageProgress ?? null,
      averageQuizScore: meanBestScore(quizzes),
      quizzes,
      completion,
    };
  });

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
      completionRate: pooledCompletionRate(counted),
      averageQuizScore: meanBestScore(counted.flatMap((c) => c.quizzes)),
    },
    courses: courseStats.map(({ completion: _, quizzes, ...course }) => ({
      ...course,
      quizzes: quizzes.map(({ scoreSum: _, ...quiz }) => quiz),
    })),
    instructors: instructorId === null ? instructorSubtotals(counted) : [],
  };
}

type CourseCompletion = {
  enrolled: number;
  completed: number;
  averageProgress: number;
};

type CountedCourse = {
  instructor: { id: number; name: string };
  revenue: number;
  completion: CourseCompletion | undefined;
  quizzes: QuizStats[];
};

type QuizStats = {
  id: number;
  title: string;
  lessonTitle: string;
  attemptedCount: number;
  averageScore: number | null;
  passRate: number | null;
  /** Sum of best scores — lets callers pool means across quizzes. */
  scoreSum: number | null;
};

/** Mean of every student-quiz best score across the given quizzes. */
function meanBestScore(quizzes: QuizStats[]) {
  let count = 0;
  let sum = 0;
  for (const quiz of quizzes) {
    count += quiz.attemptedCount;
    sum += quiz.scoreSum ?? 0;
  }
  return count === 0 ? null : sum / count;
}

/**
 * Per quiz, grouped by course, in curriculum order. A student's score is
 * their best attempt; a pass is best score ≥ the quiz's own passing_score.
 * The stored quiz_attempts.passed flag is not used — it is computed against
 * a hardcoded threshold.
 */
function quizStatsByCourse() {
  const rows = db.all<QuizStats & { courseId: number }>(sql`
    with best as (
      select quiz_id, user_id, max(score) as score
      from quiz_attempts
      group by quiz_id, user_id
    )
    select
      q.id,
      q.title,
      l.title as lessonTitle,
      m.course_id as courseId,
      count(b.user_id) as attemptedCount,
      avg(b.score) as averageScore,
      avg(b.score >= q.passing_score) as passRate,
      sum(b.score) as scoreSum
    from quizzes q
    join lessons l on l.id = q.lesson_id
    join modules m on m.id = l.module_id
    left join best b on b.quiz_id = q.id
    group by q.id
    order by m.position, l.position, q.id
  `);

  const byCourse = new Map<number, QuizStats[]>();
  for (const { courseId, ...quiz } of rows) {
    const list = byCourse.get(courseId) ?? [];
    list.push(quiz);
    byCourse.set(courseId, list);
  }
  return byCourse;
}

function sumRevenue(rows: CountedCourse[]) {
  return rows.reduce((sum, c) => sum + c.revenue, 0);
}

/** Total completed enrollments ÷ total enrollments, across courses with lessons. */
function pooledCompletionRate(rows: CountedCourse[]) {
  let enrolled = 0;
  let completed = 0;
  for (const { completion } of rows) {
    if (!completion) continue;
    enrolled += completion.enrolled;
    completed += completion.completed;
  }
  return enrolled === 0 ? null : completed / enrolled;
}

/**
 * Per course: distinct enrolled students, how many completed every lesson,
 * and their mean fraction of lessons completed. A lesson counts once per
 * student if any of their progress rows for it is completed (there is no
 * unique index on lesson_progress). enrollments.completed_at is ignored —
 * nothing in the app sets it.
 *
 * Courses with no lessons or no enrollments have no row.
 */
function completionByCourse() {
  const rows = db.all<{
    courseId: number;
    enrolled: number;
    completed: number;
    averageProgress: number;
  }>(sql`
    with lesson_totals as (
      select m.course_id, count(*) as total
      from lessons l
      join modules m on m.id = l.module_id
      group by m.course_id
    ),
    student_progress as (
      select e.course_id, e.user_id, count(distinct lp.lesson_id) as done
      from (select distinct course_id, user_id from enrollments) e
      join modules m on m.course_id = e.course_id
      join lessons l on l.module_id = m.id
      left join lesson_progress lp
        on lp.lesson_id = l.id
        and lp.user_id = e.user_id
        and lp.status = ${LessonProgressStatus.Completed}
      group by e.course_id, e.user_id
    )
    select
      sp.course_id as courseId,
      count(*) as enrolled,
      sum(sp.done = lt.total) as completed,
      avg(sp.done * 1.0 / lt.total) as averageProgress
    from student_progress sp
    join lesson_totals lt on lt.course_id = sp.course_id
    group by sp.course_id
  `);

  return new Map<number, CourseCompletion>(
    rows.map(({ courseId, ...completion }) => [courseId, completion])
  );
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
    completionRate: pooledCompletionRate(rows),
  }));
}
