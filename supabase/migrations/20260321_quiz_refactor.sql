-- ============================================================
-- Phase 0: Quiz Refactor Migration
-- Creates quizzes table, adds quiz_id FK to quiz_progress and
-- quiz_results, migrates data from saved_quizzes, adds RLS.
-- Does NOT drop saved_quizzes or old columns.
-- ============================================================

-- Step 1: Create quizzes table
CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Belongs to EITHER a lesson OR a week (not both)
  lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
  week_id UUID REFERENCES weeks(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  quiz_data JSONB NOT NULL,
  question_count INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce: must belong to exactly one parent
  CONSTRAINT quiz_parent_check CHECK (
    (lesson_id IS NOT NULL AND week_id IS NULL) OR
    (lesson_id IS NULL AND week_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX idx_quizzes_user_id ON quizzes(user_id);
CREATE INDEX idx_quizzes_lesson_id ON quizzes(lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX idx_quizzes_week_id ON quizzes(week_id) WHERE week_id IS NOT NULL;

-- Step 2: Alter quiz_progress — add quiz_id FK
ALTER TABLE quiz_progress
  ADD COLUMN quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE;

CREATE INDEX idx_quiz_progress_quiz_id ON quiz_progress(quiz_id);

-- Step 3: Alter quiz_results — add quiz_id FK
ALTER TABLE quiz_results
  ADD COLUMN quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE;

CREATE INDEX idx_quiz_results_quiz_id ON quiz_results(quiz_id);

-- Step 4: Migrate existing data

-- 4a: Copy saved_quizzes → quizzes (only rows where week_id can be resolved)
-- Rows where unit_number doesn't match any week are skipped to avoid
-- violating the CHECK constraint (both lesson_id and week_id would be NULL).
INSERT INTO quizzes (id, user_id, week_id, title, quiz_data, question_count, source, created_at)
SELECT
  sq.id,
  sq.user_id,
  w.id AS week_id,
  sq.title,
  sq.quiz_data,
  sq.question_count,
  'upload',
  sq.created_at
FROM saved_quizzes sq
INNER JOIN weeks w ON w.user_id = sq.user_id AND w.week_number = sq.unit_number;
-- Note: INNER JOIN means rows with no matching week are skipped.
-- Those orphaned saved_quizzes rows stay in the old table for reference.

-- 4b: Backfill quiz_progress.quiz_id from title match
UPDATE quiz_progress qp
SET quiz_id = q.id
FROM quizzes q
WHERE q.user_id = qp.user_id AND q.title = qp.quiz_title;

-- 4c: Backfill quiz_results.quiz_id from title match
UPDATE quiz_results qr
SET quiz_id = q.id
FROM quizzes q
WHERE q.user_id = qr.user_id AND q.title = qr.lesson_title;

-- 4d: Add new unique constraint on quiz_progress (user_id, quiz_id)
-- Keep the old (user_id, quiz_title) constraint for now since old code still uses it
ALTER TABLE quiz_progress
  ADD CONSTRAINT quiz_progress_user_quiz_id_unique UNIQUE (user_id, quiz_id);

-- Step 5: RLS Policies on quizzes table
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY quizzes_select ON quizzes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY quizzes_insert ON quizzes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY quizzes_update ON quizzes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY quizzes_delete ON quizzes FOR DELETE USING (auth.uid() = user_id);
