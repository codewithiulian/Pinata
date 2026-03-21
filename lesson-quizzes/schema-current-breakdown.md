# Database Tables Overview

## Relationships

```
auth.users
├── chat_sessions      (1:M)
├── weeks              (1:M)
│   └── lessons        (1:M via week_id FK, CASCADE DELETE)
├── saved_quizzes      (1:M)
├── quiz_progress      (1:M)
└── quiz_results       (1:M)
```

All tables have RLS — users can only access their own rows. Deleting a user cascades everything. Deleting a week cascades its lessons.

---

## Table Details

### `weeks`

Organizes the curriculum into numbered weeks.

| Column                  | Type        | Notes                    |
| ----------------------- | ----------- | ------------------------ |
| id                      | UUID        | PK                       |
| user_id                 | UUID        | FK → auth.users, CASCADE |
| week_number             | INTEGER     | unique per user          |
| title                   | TEXT        |                          |
| markdown_content        | TEXT        |                          |
| created_at / updated_at | TIMESTAMPTZ |                          |

**Used for:** Grouping lessons. API returns lesson count per week. Weeks are created/listed/deleted via `/api/weeks`.

---

### `lessons`

Individual lesson content, optionally with a PDF attachment.

| Column                         | Type          | Notes                                |
| ------------------------------ | ------------- | ------------------------------------ |
| id                             | UUID          | PK                                   |
| user_id                        | UUID          | FK → auth.users, CASCADE             |
| week_id                        | UUID          | FK → weeks, CASCADE                  |
| title                          | TEXT          |                                      |
| markdown_content               | TEXT          |                                      |
| sort_order                     | INTEGER       | ordering within a week               |
| pdf_path / pdf_name / pdf_size | TEXT/TEXT/INT | optional PDF in `lesson-pdfs` bucket |
| fts                            | tsvector      | generated, Spanish full-text search  |
| created_at / updated_at        | TIMESTAMPTZ   |                                      |

**Used for:** CRUD on lesson content, PDF upload/download (signed URLs), reordering, and full-text search via `search_lessons` RPC. API at `/api/lessons`.

---

### `saved_quizzes`

Stores quiz definitions (the questions themselves) so users can retake them.

| Column         | Type        | Notes                                     |
| -------------- | ----------- | ----------------------------------------- |
| id             | UUID        | PK                                        |
| user_id        | UUID        |                                           |
| title          | TEXT        | unique with user_id (upsert key)          |
| unit_number    | INTEGER     | nullable                                  |
| lesson_number  | INTEGER     | nullable                                  |
| question_count | INTEGER     |                                           |
| quiz_data      | JSONB       | full quiz structure (questions, metadata) |
| created_at     | TIMESTAMPTZ |                                           |

**Used for:** Saving/loading/deleting quizzes. Upserts on `(user_id, title)` to avoid duplicates. Has localStorage fallback for offline. Managed in `useQuizHistory.js`.

---

### `quiz_progress`

Tracks in-progress quiz attempts so users can resume.

| Column        | Type    | Notes                               |
| ------------- | ------- | ----------------------------------- |
| user_id       | UUID    | composite unique with quiz_title    |
| quiz_title    | TEXT    | identifies which quiz               |
| current_index | INTEGER | current question (0-based)          |
| answers       | JSONB   | map of question index → answer data |
| overrides     | JSONB   | teacher corrections `{index: true}` |
| status        | TEXT    | `"in_progress"` or `"completed"`    |

**Used for:** Auto-saving progress (debounced 300ms) during quiz-taking, resuming quizzes, counting in-progress quizzes for sidebar badge. Upserts on `(user_id, quiz_title)`. Used in `QuizRoute.jsx`, `ResultsRoute.jsx`, `HomeScreen.jsx`, `DesktopSidebar.jsx`.

---

### `quiz_results`

Stores completed quiz outcomes for history and stats.

| Column                      | Type        | Notes                                              |
| --------------------------- | ----------- | -------------------------------------------------- |
| id                          | UUID        | PK                                                 |
| user_id                     | UUID        |                                                    |
| lesson_title                | TEXT        | nullable                                           |
| lesson_number / unit_number | INTEGER     | nullable, from quiz metadata                       |
| score                       | INTEGER     | correct count                                      |
| total                       | INTEGER     | question count                                     |
| percentage                  | INTEGER     |                                                    |
| overrides                   | INTEGER     | count of manual corrections applied                |
| question_breakdown          | JSONB       | per-question details (type, prompt, correct, etc.) |
| created_at                  | TIMESTAMPTZ |                                                    |

**Used for:** Recording final scores, calculating avg/best stats, showing history, enabling teacher override corrections post-submission. Used in `QuizRoute.jsx`, `ResultsRoute.jsx`, `HomeScreen.jsx`.

---

### `chat_sessions`

Records Spanish conversation practice sessions (Hablar feature).

| Column           | Type        | Notes                     |
| ---------------- | ----------- | ------------------------- |
| id               | UUID        | PK                        |
| user_id          | UUID        | FK → auth.users, CASCADE  |
| unit_name        | TEXT        | topic/unit identifier     |
| started_at       | TIMESTAMPTZ |                           |
| duration_seconds | INTEGER     |                           |
| turn_count       | INTEGER     | conversation turns        |
| transcript       | JSONB       | full conversation history |

**Used for:** Creating, updating (transcript/turns), and ending chat sessions. History is fetched ordered by `started_at DESC`. Managed in `useChatHistory.js`.

---

## Quiz Data Flow

```
AI generates quiz → saved_quizzes (store definition)
                  ↓
User starts quiz → quiz_progress (auto-save answers as they go)
                  ↓
User finishes   → quiz_results (record score + breakdown)
                  quiz_progress.status → "completed"
                  ↓
Teacher review  → quiz_results (update score/overrides)
                  quiz_progress (update overrides)
```

## Key Points for Refactoring

- **`saved_quizzes` and `quiz_progress` are linked by quiz title** (not by FK) — there's no formal foreign key between them, just matching on title string.
- **`quiz_results` is also linked by title** (`lesson_title`) — same pattern, no FK to `saved_quizzes`.
- **`saved_quizzes.quiz_data`** holds the entire quiz structure as JSONB — questions, options, answers, metadata all in one blob.
- **`quiz_progress.answers`** and **`quiz_results.question_breakdown`** are both JSONB — answers map indices to responses, breakdown stores per-question grading details.
- **Offline fallback** exists only for `saved_quizzes` (via localStorage keys `offline_quizzes` and `cached_quizzes`).
- **No FK between quizzes and lessons/weeks** — quizzes reference lessons only via `unit_number`/`lesson_number` integers in metadata, not via actual foreign keys.
