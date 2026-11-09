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
});
