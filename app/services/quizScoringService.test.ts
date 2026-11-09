import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
  // getUserQuizHistory reads through the raw connection.
  getSqlite: () => testDb.$client,
}));

// Import after mock so the module picks up our test db
import { computeResult, getUserQuizHistory } from "./quizScoringService";

/**
 * A quiz of `questionCount` multiple-choice questions, each with one correct
 * and one wrong option. Returns the quiz and an answer builder that gets
 * exactly `correct` questions right.
 */
function createQuiz(passingScore: number, questionCount: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore })
    .returning()
    .get();

  const questions = Array.from({ length: questionCount }, (_, i) => {
    const question = testDb
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: `Q${i + 1}`,
        questionType: schema.QuestionType.MultipleChoice,
        position: i + 1,
      })
      .returning()
      .get();
    const [right, wrong] = [true, false].map((isCorrect) =>
      testDb
        .insert(schema.quizOptions)
        .values({ questionId: question.id, optionText: String(isCorrect), isCorrect })
        .returning()
        .get()
    );
    return { id: question.id, right: right.id, wrong: wrong.id };
  });

  function answers(correct: number) {
    return Object.fromEntries(
      questions.map((q, i) => [q.id, i < correct ? q.right : q.wrong])
    );
  }

  return { quiz, answers };
}

describe("computeResult", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("passes a score above the quiz's own pass mark even when below 70%", () => {
    const { quiz, answers } = createQuiz(0.6, 3);

    const result = computeResult(base.user.id, quiz.id, answers(2)); // 67%

    expect(result.passed).toBe(true);
    expect(getUserQuizHistory(base.user.id, quiz.id)[0].passed).toBe(true);
  });

  it("passes a score exactly at the pass mark", () => {
    const { quiz, answers } = createQuiz(0.7, 10);

    const result = computeResult(base.user.id, quiz.id, answers(7)); // 70%

    expect(result.passed).toBe(true);
    expect(getUserQuizHistory(base.user.id, quiz.id)[0].passed).toBe(true);
  });

  it("fails a score above 70% that is below a stricter pass mark", () => {
    const { quiz, answers } = createQuiz(0.8, 4);

    const result = computeResult(base.user.id, quiz.id, answers(3)); // 75%

    expect(result.passed).toBe(false);
    expect(getUserQuizHistory(base.user.id, quiz.id)[0].passed).toBe(false);
  });
});
