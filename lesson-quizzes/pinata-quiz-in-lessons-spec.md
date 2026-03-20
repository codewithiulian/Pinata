# Piñata Feature Spec: Quiz-in-Lessons

## Overview

Replace the current isolated quiz system with a properly linked quiz architecture. Quizzes become first-class children of **either** a lesson **or** a unit (week), never both. The existing Quizzes page is redesigned as a filterable aggregated view. JSON upload is the only creation method implemented now; AI generation and manual builder are shown in the UI as "coming soon."

---

## Current Schema Problems

The existing quiz system has three tables linked entirely by **title strings** with zero foreign keys:

```
saved_quizzes  ←(quiz_title string match)→  quiz_progress
saved_quizzes  ←(lesson_title string match)→ quiz_results
```

| Problem                  | Detail                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| No FK integrity          | Deleting a quiz doesn't cascade to progress/results                |
| No link to lessons/weeks | `unit_number` / `lesson_number` integers in metadata, not real FKs |
| Title-based joins        | Renaming a quiz silently orphans its progress and results          |
| Duplicates possible      | `saved_quizzes` upserts on `(user_id, title)` — fragile uniqueness |
| Mixed concerns           | `saved_quizzes.quiz_data` is a JSONB blob holding everything       |

---

## Target Schema

After migration, the quiz tables look like this:

```
auth.users
├── weeks                    (1:M)
│   ├── lessons              (1:M via week_id FK)
│   │   └── quizzes          (1:M via lesson_id FK)  ← NEW
│   └── quizzes              (1:M via week_id FK)    ← NEW
│
├── quiz_progress            (M:1 → quizzes via quiz_id FK)  ← UPDATED
└── quiz_results             (M:1 → quizzes via quiz_id FK)  ← UPDATED

[saved_quizzes]              ← DROPPED after data migration
```

### Step 1: Create `quizzes` table

This replaces `saved_quizzes` as the source of truth for quiz definitions.

```sql
CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Belongs to EITHER a lesson OR a week (not both)
  -- Both nullable to allow the CHECK constraint to enforce exclusivity
  lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
  week_id UUID REFERENCES weeks(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  quiz_data JSONB NOT NULL,            -- same blob structure as saved_quizzes.quiz_data
  question_count INTEGER NOT NULL,     -- denormalized for display
  source TEXT NOT NULL DEFAULT 'upload', -- 'upload' | 'ai_generated' | 'manual'

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
```

> **Note:** The column is called `quiz_data` (not `questions`) to match the existing `saved_quizzes.quiz_data` shape. This means the quiz-taking UI doesn't need to change how it reads quiz content — same JSONB blob, same structure.

### Step 2: Alter `quiz_progress` — add `quiz_id` FK

```sql
-- Add FK column (nullable initially for migration)
ALTER TABLE quiz_progress
  ADD COLUMN quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE;

CREATE INDEX idx_quiz_progress_quiz_id ON quiz_progress(quiz_id);
```

**Current state:** `quiz_progress` uses `(user_id, quiz_title)` as its composite unique key. After migration, the unique key should shift to `(user_id, quiz_id)`. However, this is done in Step 4 after data is migrated.

### Step 3: Alter `quiz_results` — add `quiz_id` FK

```sql
-- Add FK column (nullable initially for migration)
ALTER TABLE quiz_results
  ADD COLUMN quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE;

CREATE INDEX idx_quiz_results_quiz_id ON quiz_results(quiz_id);
```

### Step 4: Migrate existing data

```sql
-- 4a: Copy saved_quizzes → quizzes
-- These will have week_id set (based on unit_number) but NOT lesson_id,
-- since the old schema had no lesson FK. They land as "unit quizzes."
-- If you want to manually re-link some to lessons, do it after migration.
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
LEFT JOIN weeks w ON w.user_id = sq.user_id AND w.week_number = sq.unit_number;

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

-- 4d: Replace the unique constraint on quiz_progress
-- Old: (user_id, quiz_title) → New: (user_id, quiz_id)
-- First drop the old unique constraint (check actual constraint name in Supabase)
ALTER TABLE quiz_progress
  DROP CONSTRAINT IF EXISTS quiz_progress_user_id_quiz_title_key;

ALTER TABLE quiz_progress
  ADD CONSTRAINT quiz_progress_user_quiz_unique UNIQUE (user_id, quiz_id);
```

> **Decision point for orphaned rows:** After migration, any `quiz_progress` or `quiz_results` rows where `quiz_id IS NULL` are orphans (their title didn't match any migrated quiz). You can either keep them for historical reference or purge them:
>
> ```sql
> -- Optional: purge orphans
> DELETE FROM quiz_progress WHERE quiz_id IS NULL;
> DELETE FROM quiz_results WHERE quiz_id IS NULL;
> ```

### Step 5: Drop legacy columns and table

After confirming the migration is clean and the app is fully using the new schema:

```sql
-- Remove old string-based columns
ALTER TABLE quiz_progress DROP COLUMN quiz_title;
ALTER TABLE quiz_results DROP COLUMN lesson_title;
ALTER TABLE quiz_results DROP COLUMN lesson_number;
ALTER TABLE quiz_results DROP COLUMN unit_number;

-- Make quiz_id NOT NULL now that migration is done
ALTER TABLE quiz_progress ALTER COLUMN quiz_id SET NOT NULL;
ALTER TABLE quiz_results ALTER COLUMN quiz_id SET NOT NULL;

-- Drop the old table
DROP TABLE saved_quizzes;
```

> **⚠️ Step 5 is a separate migration** — don't bundle it with Steps 1–4. Ship the feature with both old and new columns coexisting, verify everything works, then clean up in a follow-up PR. This way you can roll back if something breaks.

### Step 6: RLS Policies

```sql
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY quizzes_select ON quizzes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY quizzes_insert ON quizzes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY quizzes_update ON quizzes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY quizzes_delete ON quizzes FOR DELETE USING (auth.uid() = user_id);
```

### Final Relationships

```
auth.users
├── weeks                          (1:M)
│   ├── lessons                    (1:M, CASCADE)
│   │   └── quizzes                (1:M via lesson_id, CASCADE)
│   └── quizzes                    (1:M via week_id, CASCADE)
├── quiz_progress                  (1:M, FK → quizzes.id)
├── quiz_results                   (1:M, FK → quizzes.id)
└── chat_sessions                  (1:M)
```

Everything flows through proper UUIDs. Deleting a lesson cascades its quizzes. Deleting a quiz cascades its progress and results. No more title-string matching.

---

## JSON Schema (Quiz Content)

The `quizzes.quiz_data` column uses the **exact same JSONB structure** as the current `saved_quizzes.quiz_data`. This means the quiz-taking UI (`QuizRoute.jsx`) doesn't need to change how it reads quiz content — it just loads from a different table.

The uploaded JSON file should match this existing structure. On upload, validate:

- `quiz_data` is a valid object containing a questions array
- Questions array is non-empty
- Each question has at minimum: `question`, `correctAnswer`
- Extract `question_count` from the questions array length

No schema changes to the JSONB blob itself — this feature only changes _where it's stored and how it's linked_.

---

## API Routes

### `POST /api/quizzes`

Create a new quiz from uploaded JSON.

**Request body (multipart or JSON):**

```jsonc
{
  "title": "Saludos y presentaciones",
  "description": "Optional description",
  "lesson_id": "uuid-here", // OR week_id, not both
  // "week_id": "uuid-here",
  "quiz_data": {
    /* ... */
  }, // parsed from uploaded JSON, same shape as saved_quizzes.quiz_data
}
```

**Validation:**

- Exactly one of `lesson_id` or `week_id` must be provided
- The referenced lesson/week must belong to the authenticated user
- `quiz_data` must contain a valid non-empty questions array
- `title` is required
- `question_count` is computed server-side from the questions array

**Response:** Created quiz object with `id`.

### `GET /api/quizzes`

List all quizzes for the authenticated user. Supports optional filters:

```
GET /api/quizzes?lesson_id=xxx
GET /api/quizzes?week_id=xxx
GET /api/quizzes                   (all quizzes, for aggregated view)
```

**Response includes** for each quiz:

- Quiz metadata (id, title, question_count, source, created_at)
- Parent info: joined lesson title + week title (for lesson quizzes), or just week title (for unit quizzes)
- Aggregated results: `best_score`, `avg_score`, `attempt_count`, `last_attempted_at`
- Progress status: check `quiz_progress` for `status` field to determine "In progress" / "New" / "Completed"

Use a single query with LEFT JOINs to `quiz_results`, `quiz_progress`, `lessons`, and `weeks`, then GROUP BY to compute aggregates.

### `DELETE /api/quizzes/:id`

Delete a quiz. CASCADE handles progress and results cleanup. Verify ownership.

### `PATCH /api/quizzes/:id`

Update title/description. Verify ownership.

### Updated: `POST /api/quiz-results`

**Existing endpoint.** Update to also accept and store `quiz_id` alongside the existing fields. During the transition period (Phase 1), continue writing the old string-based columns too so nothing breaks until Phase 6 cleanup.

### Affected existing code files

These files currently reference `saved_quizzes` and title-based lookups and will need updating:

- `useQuizHistory.js` — main hook for quiz CRUD, queries `saved_quizzes`
- `QuizRoute.jsx` — loads quiz by title from `saved_quizzes`, writes to `quiz_progress` by title
- `ResultsRoute.jsx` — reads `quiz_results` by title, writes teacher overrides
- `HomeScreen.jsx` — reads `quiz_progress` for "in progress" count and badge
- `DesktopSidebar.jsx` — reads `quiz_progress` for sidebar badge count

---

## UI Changes

### 1. Lessons Page (Desktop & Mobile)

**Lesson row changes:**

- Add a quiz count badge next to the existing PDF badge: `🧩 2 quizzes` (purple)
- If no quizzes: show dimmed `🧩 No quizzes` or omit badge entirely
- Badge pulls count from a `quiz_count` field (use a query that joins/counts)

**Unit card footer:**

- Add a `+ Add unit quiz` button alongside the existing `+ Add lesson`
- Styled in purple to visually distinguish from lesson actions (green/mint)

**Unit header meta:**

- Update subtitle: `3 lessons · 4 quizzes` (total quizzes across all lessons + unit-level)

**Data fetching:**

- Extend the lessons query to include quiz counts per lesson and per week
- Can use a subquery or a separate lightweight query

### 2. Lesson Detail Page (Desktop & Mobile)

**Desktop: Right sidebar panel**

- New "Quizzes" panel card in the right column
- Shows mini-cards for each quiz attached to this lesson:
  - Quiz title
  - Question count
  - Best score (or "—" if not attempted)
  - Mini progress bar
  - Clickable → navigates to quiz
- `+ Add quiz` button (dashed purple border) at the bottom of the panel
- A "Lesson Progress" stats card below showing aggregated quiz performance

**Mobile: Quiz section**

- Placed between the PDF card and the markdown lesson content
- Section header: `🧩 Quizzes` with count
- Tappable quiz mini-cards (same info as desktop)
- `+ Add quiz` button at bottom of section

**Data fetching:**

- When loading lesson detail, also fetch quizzes where `lesson_id = this_lesson`
- Include aggregated results per quiz

### 3. Add Quiz Flow

**Desktop: Modal dialog**

- Triggered from:
  - `+ Add quiz` button inside lesson detail sidebar panel
  - `+ Add unit quiz` button in unit card footer
- Modal contents:
  1. **"Attach to" selector** — Pre-filled based on context (lesson or unit). Shows the lesson/unit name. User can toggle between them.
  2. **Method selector** — Two cards:
     - **Upload JSON** (functional) — selected by default
     - **Generate with AI** — shows "Coming soon" overlay/badge, not clickable
  3. **Upload zone** — Drag-and-drop or click to browse, `.json` files only
  4. **Title field** — Auto-populated from JSON filename (editable)
  5. **Footer** — Cancel + "Add Quiz" (purple) button
- On submit: parse JSON, validate, POST to `/api/quizzes`, close modal, refresh quiz list

**Mobile: Bottom sheet**

- Same content as modal but in a native bottom sheet pattern
- Slides up from bottom, has drag handle
- Method cards stacked in 2-column grid
- Single CTA button: "Choose File & Upload"

**Validation UX:**

- If JSON is invalid: show inline error below upload zone with specific message
- If JSON has no questions: "No questions found in this file"
- If file is not `.json`: "Please upload a .json file"

### 4. Quizzes Page (Aggregated View)

**Keep the existing Quizzes sidebar nav item.** Redesign the page:

**Header:**

- Title: "Quizzes"
- Global stats pills: `Avg: 58%` (mint), `Best: 87%` (amber)

**Filter bar:**

- Horizontally scrollable chips: `All` | `Unit 1: Name` | `Lesson 1` | `Lesson 2` | ...
- Active chip is filled purple
- Chips are generated from the user's weeks and lessons that have quizzes

**Quiz cards grid:**

- Desktop: responsive grid, `repeat(auto-fill, minmax(300px, 1fr))`
- Mobile: single column, stacked cards
- Each card shows:
  - Status badge: `In progress` (mint) | `New` (purple) | `Unit Quiz` (blue)
  - Title
  - Parent context: `📖 Lesson 1` (purple) or `📁 Unit 1` (blue)
  - Question count
  - Stats row: Best / Avg / Attempts
  - Progress bar
  - Action button: "Continue →" or "Start →"

**Card click behavior:** Navigate to the quiz-taking page (existing).

**Data fetching:**

- `GET /api/quizzes` with no filters initially
- When chip is selected, re-fetch with `?lesson_id=x` or `?week_id=x`
- Include parent lesson/week title in the response for display

---

## Implementation Plan

### Phase 0: Database Migration (Ship first, alone)

1. Run migration Steps 1–4: Create `quizzes` table, alter `quiz_progress` and `quiz_results`, migrate data from `saved_quizzes`, backfill FKs
2. Add RLS policies to `quizzes`
3. Verify migrated data: spot-check that quiz_progress and quiz_results rows have correct `quiz_id` values
4. **Do NOT drop `saved_quizzes` or old columns yet** — the old code still references them

### Phase 1: API + Quiz-Taking Refactor (Backend)

5. Create `POST /api/quizzes` — accepts JSON upload, creates quiz linked to lesson or week
6. Create `GET /api/quizzes` — with optional `lesson_id` / `week_id` filters, includes aggregated results (best_score, avg_score, attempt_count) via LEFT JOIN to quiz_results
7. Create `DELETE /api/quizzes/:id` and `PATCH /api/quizzes/:id`
8. Update quiz-taking flow (`QuizRoute.jsx`) to load quiz by `quiz_id` (from new `quizzes` table) instead of loading from `saved_quizzes` by title
9. Update `quiz_progress` reads/writes to use `quiz_id` FK instead of `quiz_title` string match
10. Update `quiz_results` writes to include `quiz_id` on submission
11. Update `useQuizHistory.js` to query new `quizzes` table instead of `saved_quizzes`
12. Update `ResultsRoute.jsx` to use `quiz_id` for looking up results

### Phase 2: Lessons Page Updates

13. Extend lessons query to include quiz count per lesson (subquery or join to `quizzes`)
14. Extend weeks query to include total quiz count (lesson quizzes + unit quizzes)
15. Add quiz count badge (`🧩 2`) to lesson row component
16. Add `+ Add unit quiz` button to unit card footer (purple styled)
17. Update unit header meta text to show `3 lessons · 4 quizzes`

### Phase 3: Lesson Detail — Quiz Panel

18. Create `QuizPanel` component (desktop right sidebar)
19. Create `QuizSection` component (mobile, inline between PDF and content)
20. Shared `QuizMiniCard` component — shows title, question count, best score, progress bar
21. Fetch quizzes for current lesson via `GET /api/quizzes?lesson_id=xxx`
22. Wire up quiz mini-card click → navigate to quiz-taking page with `quiz_id`
23. Add `+ Add quiz` button at bottom of panel/section

### Phase 4: Add Quiz Modal / Bottom Sheet

24. Create `AddQuizModal` (desktop) — modal with attach-to selector, method picker, upload zone
25. Create `AddQuizSheet` (mobile) — bottom sheet pattern with same content
26. Implement JSON file upload: parse, validate schema, extract question_count
27. "Attach to" selector: pre-fill from context (lesson or unit), allow toggle
28. "Generate with AI" card shown but disabled with "Coming soon" badge
29. On submit: POST to `/api/quizzes`, close modal, invalidate/refetch quiz list (TanStack Query)

### Phase 5: Quizzes Aggregated Page

30. Redesign Quizzes page with filter bar + card grid layout
31. Generate filter chips from user's weeks/lessons that have quizzes
32. Implement quiz card component with status badge, parent context tag, stats, progress bar
33. Wire up filtering: clicking a chip re-fetches `GET /api/quizzes?week_id=x` or `?lesson_id=x`
34. Card click → navigate to quiz-taking page

### Phase 6: Cleanup (Separate PR, after feature is verified)

35. Drop `saved_quizzes` table
36. Drop old columns: `quiz_progress.quiz_title`, `quiz_results.lesson_title`, `quiz_results.lesson_number`, `quiz_results.unit_number`
37. Make `quiz_progress.quiz_id` and `quiz_results.quiz_id` NOT NULL
38. Remove `useQuizHistory.js` localStorage fallback code (or update to use new table)
39. Remove any remaining references to old string-based quiz lookups
40. Delete orphaned quiz_progress/quiz_results rows where quiz_id IS NULL

---

## Migration Risks & Rollback

| Risk                                 | Mitigation                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title mismatch during backfill       | `quiz_progress.quiz_title` may not exactly match `saved_quizzes.title` (casing, whitespace). Run a pre-migration query to check: `SELECT qp.quiz_title FROM quiz_progress qp WHERE NOT EXISTS (SELECT 1 FROM saved_quizzes sq WHERE sq.title = qp.quiz_title AND sq.user_id = qp.user_id)` |
| `unit_number` doesn't match any week | `LEFT JOIN` in Step 4a handles this — those quizzes get `week_id = NULL`, which violates the CHECK constraint. **Fix:** Insert those as week_id pointing to the user's first week, or skip them and log.                                                                                   |
| Offline localStorage quizzes         | `useQuizHistory.js` has localStorage fallback (`offline_quizzes`, `cached_quizzes`). These won't be in `saved_quizzes` and won't migrate. Decision: either flush them to the server first, or accept they're lost.                                                                         |
| Rollback path                        | Phase 0 is additive only (new table + new columns). Old code still works against old tables. If something goes wrong in Phase 1, revert the code — the DB changes are harmless. Phase 6 (dropping old tables) is the point of no return, which is why it's a separate PR.                  |

---

## Out of Scope (Future)

- **AI quiz generation from lesson PDF/content** — UI placeholder shown as "Coming soon"
- **Manual quiz builder** — Not shown in current UI
- **Quiz editing** — Can delete and re-upload for now
- **Quiz sharing between users** — Single-user app
- **Quiz ordering/sorting within a lesson** — Uses `created_at` order
- **Drag-and-drop reordering of quizzes** — Future nice-to-have

---

## Design Tokens Reference

| Element             | Color                        | Usage                                             |
| ------------------- | ---------------------------- | ------------------------------------------------- |
| Quiz badges/accents | `#8B5CF6` (purple)           | Quiz count badges, add quiz buttons, filter chips |
| Quiz light bg       | `#EDE9FE` (purple-light)     | Quiz mini-card hover, method card selected        |
| Unit quiz accent    | `#3B82F6` (blue)             | Unit-level quiz badges on aggregated page         |
| Unit quiz light bg  | `#DBEAFE` (blue-light)       | Unit quiz card status                             |
| PDF badge           | `#FF6B6B` / `#FEE2E2`        | Existing — no change                              |
| Primary actions     | `#43C6AC` (mint)             | Existing — no change                              |
| Progress bars       | `#43C6AC → #2BA88C` gradient | Quiz progress                                     |

---

## File Structure (Suggested)

```
src/
  app/
    api/
      quizzes/
        route.js              # GET (list), POST (create)
        [id]/
          route.js            # PATCH, DELETE
  components/
    quizzes/
      QuizPanel.jsx           # Desktop sidebar panel in lesson detail
      QuizSection.jsx         # Mobile inline section in lesson detail
      QuizMiniCard.jsx        # Shared mini-card component
      AddQuizModal.jsx        # Desktop modal
      AddQuizSheet.jsx        # Mobile bottom sheet
      QuizCard.jsx            # Full card for aggregated view
      QuizFilterBar.jsx       # Filter chips component
  lib/
    validators/
      quiz-json.js            # JSON upload validation

  # Existing files that need updating:
  # hooks/useQuizHistory.js   → rewrite to use `quizzes` table
  # routes/QuizRoute.jsx      → load quiz by id, write progress by quiz_id
  # routes/ResultsRoute.jsx   → read/write results by quiz_id
  # screens/HomeScreen.jsx    → read quiz_progress by quiz_id for badge count
  # components/DesktopSidebar.jsx → same badge count update
```
