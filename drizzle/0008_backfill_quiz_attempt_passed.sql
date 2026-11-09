-- Custom SQL migration file, put your code below! --
-- Recompute quiz_attempts.passed against each quiz's own passing_score.
-- Attempts were previously stored with a hardcoded `score > 0.7` (#7).
UPDATE quiz_attempts
SET passed = (
  score >= (SELECT passing_score FROM quizzes WHERE quizzes.id = quiz_attempts.quiz_id)
);
