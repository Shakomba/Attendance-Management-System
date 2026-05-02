# Student Portal Design
**Date:** 2026-05-02  
**Status:** Approved

## Overview

Add a student-facing portal to Attendify where students can log in (same login page as professors), view their absence counts per course, and manage their face ID. Students are onboarded via an invite email sent by the professor, containing a magic link for first-time login and forced password setup.

---

## Database Schema Changes

### `dbo.Students` — new columns

| Column | Type | Constraint | Purpose |
|---|---|---|---|
| `FullNameKurdish` | `NVARCHAR(120)` | `NULL` | Kurdish name; nullable for existing rows |
| `PasswordHash` | `NVARCHAR(255)` | `NULL` | bcrypt hash; null until student completes setup |
| `FaceDeletedBySelf` | `BIT` | `NOT NULL DEFAULT 0` | Set to 1 when student self-deletes face embeddings |
| `FaceDeletedAt` | `DATETIME2` | `NULL` | Timestamp of self-deletion |

### New table: `dbo.StudentInviteTokens`

```sql
TokenID    UNIQUEIDENTIFIER  PRIMARY KEY DEFAULT NEWID()
StudentID  INT               NOT NULL FK → Students(StudentID)
Token      NVARCHAR(128)     NOT NULL UNIQUE
ExpiresAt  DATETIME2         NOT NULL   -- 48 hours from creation
UsedAt     DATETIME2         NULL       -- stamped when password setup completes
CreatedAt  DATETIME2         NOT NULL DEFAULT GETUTCDATE()
```

- Token is single-use: valid only when `UsedAt IS NULL AND ExpiresAt > GETUTCDATE()`
- Professor can re-send invite; new token is created, old tokens remain but are superseded
- Token is a cryptographically random URL-safe string (32 bytes, base64url encoded)

---

## Auth Flow

### Login (`POST /api/auth/login`)

The login request body keeps its existing `username` and `password` fields. Students type their email into the `username` field. The login form label changes from "Username" to "Username or Email".

1. Look up professor by `username` field (existing behavior)
2. If no professor found, look up student where `email = username` field value
3. If student found but `PasswordHash IS NULL` → return `403` with error code `account_not_setup` (invite sent but setup not completed); frontend shows "Check your email for the setup link"
4. Verify bcrypt password, issue JWT
5. JWT gains a `role` field: `"professor"` or `"student"`
6. Student JWT payload: `{ sub: StudentID, role: "student", full_name, full_name_kurdish, exp }`
7. Professor JWT payload: `{ sub: ProfessorID, role: "professor", username, course_id, exp }` (existing fields preserved, `role` added)

### Magic link (`GET /api/auth/invite?token=<token>`)
1. Validate token: exists, `UsedAt IS NULL`, `ExpiresAt > now`
2. Return a short-lived one-time JWT (15-minute expiry) with `{ role: "student", password_set: false, student_id }`
3. Frontend detects `password_set: false` → redirects to password setup screen before portal access

### Password setup (`POST /api/auth/student/set-password`)
1. Requires the one-time JWT (Authorization header)
2. Validates: password min 8 characters, confirmation matches
3. bcrypt hashes and writes to `Students.PasswordHash`
4. Stamps `StudentInviteTokens.UsedAt = GETUTCDATE()`
5. Returns a full-duration student JWT (`password_set: true`, standard 480-minute expiry)

---

## API Endpoints

### New endpoints

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| `GET` | `/api/auth/invite` | None | Validate magic link token, return one-time JWT |
| `POST` | `/api/auth/student/set-password` | One-time student JWT | Hash and save password, return full JWT |
| `GET` | `/api/student/portal` | Student JWT | Return student's courses + absence data + face status |
| `DELETE` | `/api/student/face` | Student JWT | Delete all face embeddings, set `FaceDeletedBySelf=1` |

### Modified endpoints

- `POST /api/students` — now accepts `full_name_kurdish` (optional) and `email` (required); after creation, generates invite token and sends invite email
- `GET /api/courses/{id}/students` — each student object gains `face_deleted_by_self: bool` field
- `POST /api/students/{id}/enrollment/start` (and related enrollment endpoints) — on successful enrollment completion, clears `FaceDeletedBySelf=0` and `FaceDeletedAt=NULL`
- `POST /api/students/{id}/invite/resend` — professor-only; generates a new invite token (old tokens remain but are superseded) and re-sends the invite email; returns `200` with `{ "sent": true }`

### `GET /api/student/portal` response shape

```json
{
  "full_name": "Ahmed Ali",
  "full_name_kurdish": "ئەحمەد عەلی",
  "courses": [
    {
      "course_name": "Mathematics",
      "hours_absent": 2.5
    }
  ],
  "face_enrolled": true,
  "face_deleted_by_self": false,
  "face_deleted_at": null
}
```

- `face_enrolled` is `true` when at least one row exists in `StudentFaceEmbeddings` for this student
- `courses` is derived from `dbo.Enrollments JOIN dbo.Courses` — course code is intentionally omitted
- `hours_absent` comes from `Enrollments.HoursAbsentTotal`

---

## Frontend

### Role-based routing (existing SPA, no React Router)

- After login, decode JWT and read `role`
- `role === "professor"` → existing professor dashboard (no change)
- `role === "student"` + `password_set === false` → password setup screen
- `role === "student"` + `password_set === true` → student portal
- JWT stored in localStorage as `ams_token` (same key, compatible)
- Student profile stored as `ams_student` in localStorage (separate from `ams_professor`)

### Password setup screen

- Shown after magic link login, blocks access to portal
- Fields: New password, Confirm password
- Validation: min 8 characters, passwords must match
- On success: replaces one-time JWT with full JWT, navigates to student portal

### Student portal view

**Header:**
- Student name (English + Kurdish based on active language)
- Language toggle (en / ckb)
- Theme toggle (light / dark)
- Logout button

**Absence section:**
- One card per enrolled course
- Shows: course name only (no course code)
- Shows: total hours absent (e.g., "2.5 hrs absent")
- No editing, read-only

**Face ID section:**
- Status indicator: "Active" (green) when enrolled, "Deleted" (red) when `face_deleted_by_self = true`, "Not enrolled" (grey) when no embeddings and not deleted
- Single "Delete Face ID" button — visible only when `face_enrolled = true`
- On click: confirmation modal with text explaining that professors will need to re-enroll them
- On confirm: calls `DELETE /api/student/face`, updates UI to "Deleted" state
- After deletion: button hidden, message shown ("Contact your course professors to re-enroll your face ID")

### Add student modal (professor side)

Replaces / extends the existing student creation UI:

- Field: Full name (English) — required
- Field: Full name (Kurdish) — optional
- Field: Email — required, validated format
- Submit: creates student record, generates invite token, sends invite email
- Email content: bilingual (English + Kurdish), contains the magic link, explains next steps
- Magic link format: `https://<domain>?invite=<token>` (uses a query param on the root URL so the existing tab-based SPA can detect it on load without React Router; on startup, `App.jsx` checks `URLSearchParams` for an `invite` param and if present, calls `GET /api/auth/invite` before rendering anything else)

### Enrollment page (professor side)

- Student row with `face_deleted_by_self: true` shows a red "Student deleted" badge in place of the "Unassigned" label
- No other behavior changes — professor re-enrolls via the existing flow, which clears the flag on enrollment completion
- Tooltip on badge: "Student deleted their face ID on <date>"

---

## i18n

New translation keys required (English + Kurdish):

**Student portal:**
- `student_portal_title`
- `student_absence_title`
- `student_face_id_title`
- `student_face_active`
- `student_face_deleted`
- `student_face_not_enrolled`
- `student_face_delete_btn`
- `student_face_delete_confirm_title`
- `student_face_delete_confirm_body`
- `student_face_delete_contact_msg`

**Password setup:**
- `setup_password_title`
- `setup_password_new`
- `setup_password_confirm`
- `setup_password_submit`
- `setup_password_mismatch`
- `setup_password_too_short`

**Add student modal:**
- `add_student_name_en`
- `add_student_name_ku`
- `add_student_email`
- `add_student_invite_sent`

**Enrollment page:**
- `enroll_student_deleted` — "Student deleted"
- `enroll_student_deleted_tooltip` — "Student deleted their face ID on {date}"

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Magic link token expired | `GET /api/auth/invite` returns `410 Gone` with `token_expired`; frontend shows message to contact professor |
| Magic link already used | Same `410 Gone` response with `token_used` |
| Student tries login before setup | `403` with `account_not_setup`; frontend shows "Check your email for the setup link" |
| Student deletes face but has no embeddings | `400` with `no_face_enrolled`; frontend disables button if already in correct state |
| Re-enrollment clears deletion flag | Handled server-side in existing enrollment completion logic — no extra UI needed |

---

## Out of Scope

- Students cannot self-register; they must be created by a professor
- Students cannot change their own name or email
- Students cannot view session-level attendance detail, only the cumulative `HoursAbsentTotal`
- No student-to-professor messaging within the app (students contact professors externally)
- WebAuthn / passkey support for students (professors only for now)
