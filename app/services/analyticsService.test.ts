import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getCourseAnalytics } from "./analyticsService";

let emailCounter = 0;

function createUser(
  name: string,
  role: schema.UserRole = schema.UserRole.Student
) {
  emailCounter += 1;
  return testDb
    .insert(schema.users)
    .values({ name, email: `user${emailCounter}@example.com`, role })
    .returning()
    .get();
}

function createCourse(
  title: string,
  opts: { instructorId?: number; status?: schema.CourseStatus } = {}
) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      description: "A course",
      salesCopy: "Sales copy.",
      instructorId: opts.instructorId ?? base.instructor.id,
      categoryId: base.category.id,
      status: opts.status ?? schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  testDb.insert(schema.enrollments).values({ userId, courseId }).run();
}

function purchase(userId: number, courseId: number, amountPaid: number) {
  testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid })
    .run();
}

function addLessons(courseId: number, count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

function progress(
  userId: number,
  lessonId: number,
  status: schema.LessonProgressStatus = schema.LessonProgressStatus.Completed
) {
  testDb.insert(schema.lessonProgress).values({ userId, lessonId, status }).run();
}

function courseRow(
  result: ReturnType<typeof getCourseAnalytics>,
  courseId: number
) {
  const row = result.courses.find((c) => c.id === courseId);
  if (!row) throw new Error(`course ${courseId} not in result`);
  return row;
}

describe("getCourseAnalytics", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("students and revenue", () => {
    it("reports each course's student count and gross revenue", () => {
      const other = createUser("Other Student");
      enroll(base.user.id, base.course.id);
      enroll(other.id, base.course.id);
      purchase(base.user.id, base.course.id, 4999);
      purchase(other.id, base.course.id, 2500);

      const result = getCourseAnalytics(base.instructor.id);

      const row = courseRow(result, base.course.id);
      expect(row.studentCount).toBe(2);
      expect(row.revenue).toBe(7499);
    });

    it("returns only the given instructor's courses", () => {
      const otherInstructor = createUser("Other", schema.UserRole.Instructor);
      const otherCourse = createCourse("Other Course", {
        instructorId: otherInstructor.id,
      });

      const result = getCourseAnalytics(base.instructor.id);

      expect(result.courses.map((c) => c.id)).toEqual([base.course.id]);
      expect(result.courses.map((c) => c.id)).not.toContain(otherCourse.id);
    });

    it("counts a student enrolled twice in a course once", () => {
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, base.course.id);

      const result = getCourseAnalytics(base.instructor.id);

      expect(courseRow(result, base.course.id).studentCount).toBe(1);
      expect(result.totals.studentCount).toBe(1);
    });

    it("counts PPP purchases at amount paid and team purchases in full", () => {
      const teamBuyer = createUser("Team Buyer");
      purchase(base.user.id, base.course.id, 1250); // PPP-discounted
      purchase(teamBuyer.id, base.course.id, 5 * 4999); // 5-seat team purchase

      const result = getCourseAnalytics(base.instructor.id);

      expect(courseRow(result, base.course.id).revenue).toBe(1250 + 24995);
      expect(result.totals.revenue).toBe(26245);
    });

    it("headline students are unique across the instructor's courses", () => {
      const second = createCourse("Second Course");
      const other = createUser("Other Student");
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, second.id);
      enroll(other.id, second.id);

      const result = getCourseAnalytics(base.instructor.id);

      expect(result.totals.studentCount).toBe(2);
    });

    it("lists draft courses but excludes them from totals; archived courses count", () => {
      const draft = createCourse("Draft Course", {
        status: schema.CourseStatus.Draft,
      });
      const archived = createCourse("Archived Course", {
        status: schema.CourseStatus.Archived,
      });
      const draftStudent = createUser("Draft Student");
      enroll(draftStudent.id, draft.id);
      purchase(draftStudent.id, draft.id, 1000);
      enroll(base.user.id, archived.id);
      purchase(base.user.id, archived.id, 3000);

      const result = getCourseAnalytics(base.instructor.id);

      expect(courseRow(result, draft.id)).toMatchObject({
        status: schema.CourseStatus.Draft,
        studentCount: 1,
        revenue: 1000,
      });
      expect(result.totals).toMatchObject({ studentCount: 1, revenue: 3000 });
    });

    it("returns empty courses and zero totals for an instructor with no courses", () => {
      const newInstructor = createUser("New", schema.UserRole.Instructor);

      const result = getCourseAnalytics(newInstructor.id);

      expect(result.courses).toEqual([]);
      expect(result.totals).toMatchObject({ studentCount: 0, revenue: 0 });
    });
  });

  describe("completion and progress", () => {
    it("counts only students who completed every lesson, and averages progress", () => {
      const [l1, l2] = addLessons(base.course.id, 2);
      const partial = createUser("Partial");
      enroll(base.user.id, base.course.id);
      enroll(partial.id, base.course.id);
      progress(base.user.id, l1.id);
      progress(base.user.id, l2.id);
      progress(partial.id, l1.id);
      progress(partial.id, l2.id, schema.LessonProgressStatus.InProgress);

      const row = courseRow(getCourseAnalytics(base.instructor.id), base.course.id);

      expect(row.completionRate).toBe(0.5);
      expect(row.averageProgress).toBe(0.75);
    });

    it("counts a lesson completed when any of a student's duplicate rows is completed", () => {
      const [l1, l2] = addLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      progress(base.user.id, l1.id, schema.LessonProgressStatus.InProgress);
      progress(base.user.id, l1.id);
      progress(base.user.id, l2.id);
      progress(base.user.id, l2.id);

      const row = courseRow(getCourseAnalytics(base.instructor.id), base.course.id);

      expect(row.completionRate).toBe(1);
      expect(row.averageProgress).toBe(1);
    });

    it("does not double-count duplicate completed rows for one lesson", () => {
      const [l1] = addLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      progress(base.user.id, l1.id);
      progress(base.user.id, l1.id);

      const row = courseRow(getCourseAnalytics(base.instructor.id), base.course.id);

      expect(row.completionRate).toBe(0);
      expect(row.averageProgress).toBe(0.5);
    });

    it("ignores enrollments.completedAt", () => {
      const [l1] = addLessons(base.course.id, 2);
      testDb
        .insert(schema.enrollments)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          completedAt: "2026-01-01T00:00:00.000Z",
        })
        .run();
      progress(base.user.id, l1.id);

      const row = courseRow(getCourseAnalytics(base.instructor.id), base.course.id);

      expect(row.completionRate).toBe(0);
    });

    it("returns null for courses with no lessons or no enrollments", () => {
      const noEnrollments = createCourse("No Enrollments");
      addLessons(noEnrollments.id, 3);
      enroll(base.user.id, base.course.id); // base course has no lessons

      const result = getCourseAnalytics(base.instructor.id);

      expect(courseRow(result, base.course.id)).toMatchObject({
        completionRate: null,
        averageProgress: null,
      });
      expect(courseRow(result, noEnrollments.id)).toMatchObject({
        completionRate: null,
        averageProgress: null,
      });
      expect(result.totals.completionRate).toBeNull();
    });

    it("pools the headline and instructor completion rate across courses", () => {
      // Course A: 1 of 1 complete. Course B: 0 of 3 complete.
      // Pooled = 1/4 = 25%, not the mean of course rates (50%).
      const [a1] = addLessons(base.course.id, 1);
      const courseB = createCourse("Course B");
      addLessons(courseB.id, 1);
      enroll(base.user.id, base.course.id);
      progress(base.user.id, a1.id);
      for (const name of ["B1", "B2", "B3"]) {
        enroll(createUser(name).id, courseB.id);
      }

      expect(getCourseAnalytics(base.instructor.id).totals.completionRate).toBe(0.25);
      const admin = getCourseAnalytics(null);
      expect(admin.totals.completionRate).toBe(0.25);
      expect(admin.instructors[0].completionRate).toBe(0.25);
    });

    it("excludes draft courses from the pooled completion rate", () => {
      const [l1] = addLessons(base.course.id, 1);
      const draft = createCourse("Draft", { status: schema.CourseStatus.Draft });
      addLessons(draft.id, 1);
      enroll(base.user.id, base.course.id);
      progress(base.user.id, l1.id);
      enroll(createUser("Draft Student").id, draft.id);

      expect(getCourseAnalytics(base.instructor.id).totals.completionRate).toBe(1);
    });
  });

  describe("platform scope (null)", () => {
    it("returns every course with its instructor", () => {
      const otherInstructor = createUser("Ada Lovelace", schema.UserRole.Instructor);
      const otherCourse = createCourse("Other Course", {
        instructorId: otherInstructor.id,
      });

      const result = getCourseAnalytics(null);

      expect(courseRow(result, base.course.id).instructor).toEqual({
        id: base.instructor.id,
        name: "Test Instructor",
      });
      expect(courseRow(result, otherCourse.id).instructor).toEqual({
        id: otherInstructor.id,
        name: "Ada Lovelace",
      });
    });

    it("de-duplicates students enrolled with multiple instructors in the headline", () => {
      const otherInstructor = createUser("Ada Lovelace", schema.UserRole.Instructor);
      const otherCourse = createCourse("Other Course", {
        instructorId: otherInstructor.id,
      });
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, otherCourse.id);

      const result = getCourseAnalytics(null);

      expect(result.totals.studentCount).toBe(1);
    });

    it("returns per-instructor subtotals that exclude draft courses", () => {
      const otherInstructor = createUser("Ada Lovelace", schema.UserRole.Instructor);
      const otherCourse = createCourse("Other Course", {
        instructorId: otherInstructor.id,
      });
      const draft = createCourse("Draft Course", {
        status: schema.CourseStatus.Draft,
      });
      const second = createCourse("Second Course");
      const other = createUser("Other Student");

      enroll(base.user.id, base.course.id);
      enroll(base.user.id, second.id); // same student, same instructor
      enroll(other.id, second.id);
      purchase(base.user.id, base.course.id, 1000);
      purchase(other.id, second.id, 2000);
      enroll(other.id, draft.id);
      purchase(other.id, draft.id, 9999);
      enroll(base.user.id, otherCourse.id);
      purchase(base.user.id, otherCourse.id, 500);

      const result = getCourseAnalytics(null);

      const byId = new Map(result.instructors.map((i) => [i.id, i]));
      expect(byId.get(base.instructor.id)).toMatchObject({
        name: "Test Instructor",
        studentCount: 2,
        revenue: 3000,
      });
      expect(byId.get(otherInstructor.id)).toMatchObject({
        name: "Ada Lovelace",
        studentCount: 1,
        revenue: 500,
      });
      expect(result.totals).toMatchObject({ studentCount: 2, revenue: 3500 });
    });

    it("leaves instructors empty for instructor scope", () => {
      const result = getCourseAnalytics(base.instructor.id);

      expect(result.instructors).toEqual([]);
    });
  });
});
