-- Custom SQL migration file, put your code below! --
-- Set enrollments.completed_at for students who have already completed every
-- lesson in the course (#8). Nothing in the app set it before. Uses the time
-- of the student's latest completed lesson, falling back to now. Courses with
-- no lessons are skipped; a lesson counts once however many rows it has.
UPDATE enrollments
SET completed_at = (
  SELECT coalesce(max(lp.completed_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  FROM lesson_progress lp
  JOIN lessons l ON l.id = lp.lesson_id
  JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = enrollments.course_id
    AND lp.user_id = enrollments.user_id
    AND lp.status = 'completed'
)
WHERE completed_at IS NULL
  AND (
    SELECT count(*)
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = enrollments.course_id
  ) > 0
  AND (
    SELECT count(DISTINCT lp.lesson_id)
    FROM lesson_progress lp
    JOIN lessons l ON l.id = lp.lesson_id
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = enrollments.course_id
      AND lp.user_id = enrollments.user_id
      AND lp.status = 'completed'
  ) = (
    SELECT count(*)
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = enrollments.course_id
  );
