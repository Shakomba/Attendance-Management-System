# Student Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a student-facing portal where students log in via invite email (magic link → forced password setup), view their absence counts per course, and can delete their own face ID — with professor enrollment page reflecting the deletion.

**Architecture:** Parallel auth layer alongside professors (same JWT infrastructure, new `role` claim). Students are invited by professors via magic link; backend tries professor login first, then student by email. Role-based routing in the React SPA dispatches to either the existing professor dashboard or the new student portal.

**Tech Stack:** Python/FastAPI, PyJWT, bcrypt, SQL Server (pyodbc), React 18/Vite, Tailwind CSS, custom i18n (en/ckb)

---

## File Map

**Create:**
- `database/02_student_portal_migration.sql` — ALTER TABLE + new StudentInviteTokens table
- `frontend/src/components/student/PasswordSetup.jsx` — forced password setup screen
- `frontend/src/components/student/StudentPortal.jsx` — student dashboard

**Modify:**
- `backend/app/config.py` — add `FRONTEND_URL` env var
- `backend/app/auth.py` — `create_student_token`, `get_current_student`, `get_current_student_invite`
- `backend/app/schemas.py` — update `LoginRequest`, `LoginResponse`, `StudentCreateRequest`; add `SetPasswordRequest`, `StudentPortalResponse`
- `backend/app/repos.py` — student auth, invite tokens, portal data, face deletion, list_course_students
- `backend/app/services/email_service.py` — `send_invite_email`
- `backend/app/services/enrollment_service.py` — clear `FaceDeletedBySelf` on enrollment completion
- `backend/app/main.py` — update login, new student routes, updated student creation
- `frontend/src/lib/translations.js` — new translation keys
- `frontend/src/App.jsx` — invite param detection, role-based routing, student state
- `frontend/src/components/auth/LoginPage.jsx` — label "Username or Email"
- `frontend/src/components/enrollment/EnrollmentTab.jsx` — "Student deleted" badge + "Add Student" modal

---

## Task 1: Database Migration

**Files:**
- Create: `database/02_student_portal_migration.sql`

- [ ] **Step 1: Write the migration SQL**

Create `database/02_student_portal_migration.sql` with this exact content:

```sql
-- Student Portal Migration
-- Run once against the AttendanceAI database after 01_init_schema.sql

-- 1. Add new columns to dbo.Students
ALTER TABLE dbo.Students
    ADD FullNameKurdish  NVARCHAR(120) NULL,
        PasswordHash     NVARCHAR(255) NULL,
        FaceDeletedBySelf BIT NOT NULL CONSTRAINT DF_Students_FaceDeletedBySelf DEFAULT (0),
        FaceDeletedAt    DATETIME2(0)  NULL;

-- 2. Create invite-token table
CREATE TABLE dbo.StudentInviteTokens
(
    TokenID   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_StudentInviteTokens PRIMARY KEY DEFAULT NEWID(),
    StudentID INT              NOT NULL,
    Token     NVARCHAR(128)    NOT NULL CONSTRAINT UQ_StudentInviteTokens_Token UNIQUE,
    ExpiresAt DATETIME2(0)     NOT NULL,
    UsedAt    DATETIME2(0)     NULL,
    CreatedAt DATETIME2(0)     NOT NULL CONSTRAINT DF_StudentInviteTokens_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_StudentInviteTokens_Students
        FOREIGN KEY (StudentID) REFERENCES dbo.Students(StudentID)
);
```

- [ ] **Step 2: Run the migration**

Connect to the SQL Server instance and run the file:
```bash
sqlcmd -S localhost -d AttendanceAI -U sa -P "YourStrong!Passw0rd" -i database/02_student_portal_migration.sql
```

Expected output: no errors. Verify with:
```bash
sqlcmd -S localhost -d AttendanceAI -U sa -P "YourStrong!Passw0rd" -Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Students' AND COLUMN_NAME IN ('FullNameKurdish','PasswordHash','FaceDeletedBySelf','FaceDeletedAt');"
```
Expected: 4 rows returned.

```bash
sqlcmd -S localhost -d AttendanceAI -U sa -P "YourStrong!Passw0rd" -Q "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='StudentInviteTokens';"
```
Expected: 1 row returned.

- [ ] **Step 3: Commit**

```bash
git add database/02_student_portal_migration.sql
git commit -m "feat: add student portal DB migration (new Students columns + StudentInviteTokens)"
```

---

## Task 2: Config — Add FRONTEND_URL

**Files:**
- Modify: `backend/app/config.py`

- [ ] **Step 1: Add the setting**

In `backend/app/config.py`, inside the `Settings` dataclass, add after the `resend_timeout_sec` line (line 70):

```python
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
```

- [ ] **Step 2: Add to .env.example**

Open `backend/.env.example` and append:
```
FRONTEND_URL=https://your-domain.com
```

- [ ] **Step 3: Verify**

Start a Python shell inside the backend:
```bash
cd backend && python -c "from app.config import settings; print(settings.frontend_url)"
```
Expected: `http://localhost:5173`

- [ ] **Step 4: Commit**

```bash
git add backend/app/config.py backend/.env.example
git commit -m "feat: add FRONTEND_URL config setting for invite magic links"
```

---

## Task 3: Schemas — Update & Add

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Update `LoginRequest` — extend max_length for email addresses**

In `backend/app/schemas.py`, replace:
```python
class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)
```
With:
```python
class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128)
```

- [ ] **Step 2: Update `LoginResponse` — support both professor and student**

Replace:
```python
class LoginResponse(BaseModel):
    professor_id: int
    username: str
    full_name: str
    course_id: int
    course_name: Optional[str] = None
    course_code: Optional[str] = None
    access_token: str = ""
```
With:
```python
class LoginResponse(BaseModel):
    access_token: str = ""
    role: str = "professor"
    # Professor-only fields
    professor_id: Optional[int] = None
    username: Optional[str] = None
    course_id: Optional[int] = None
    course_name: Optional[str] = None
    course_code: Optional[str] = None
    # Student-only fields
    student_id: Optional[int] = None
    full_name: Optional[str] = None
    full_name_kurdish: Optional[str] = None
```

- [ ] **Step 3: Update `StudentCreateRequest` — make student_code optional, add Kurdish name**

Replace:
```python
class StudentCreateRequest(BaseModel):
    student_code: str = Field(min_length=1, max_length=30)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    profile_photo_url: Optional[str] = None
    course_id: int
    grades: GradesPayload = Field(default_factory=GradesPayload)
```
With:
```python
class StudentCreateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    full_name_kurdish: Optional[str] = Field(default=None, max_length=120)
    email: EmailStr
    course_id: int
    grades: GradesPayload = Field(default_factory=GradesPayload)
```

- [ ] **Step 4: Add new schemas at the end of the file**

Append to `backend/app/schemas.py`:
```python

class SetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class StudentPortalCourse(BaseModel):
    course_name: str
    hours_absent: float


class StudentPortalResponse(BaseModel):
    full_name: str
    full_name_kurdish: Optional[str] = None
    courses: List[StudentPortalCourse]
    face_enrolled: bool
    face_deleted_by_self: bool
    face_deleted_at: Optional[str] = None
```

- [ ] **Step 5: Verify schemas load**

```bash
cd backend && python -c "from app.schemas import LoginResponse, SetPasswordRequest, StudentPortalResponse; print('OK')"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat: update schemas for student portal (LoginResponse, StudentCreateRequest, new student schemas)"
```

---

## Task 4: Repos — Student Auth & Invite Token Methods

**Files:**
- Modify: `backend/app/repos.py`

- [ ] **Step 1: Add imports at the top of repos.py**

At the top of `backend/app/repos.py`, the existing imports include `from datetime import datetime, timedelta, timezone`. Verify `secrets` and `uuid` are not already imported, then add after the existing imports block:

```python
import secrets
import uuid
```

- [ ] **Step 2: Add student auth methods**

Inside the `Repository` class, after the `authenticate_professor` method (after line ~41), add:

```python
    @staticmethod
    def get_student_by_email(email: str) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT StudentID, FullName, FullNameKurdish, Email,
                   PasswordHash, FaceDeletedBySelf, FaceDeletedAt
            FROM dbo.Students
            WHERE Email = ? AND IsActive = 1;
            """,
            (email,),
        )

    @staticmethod
    def set_student_password(student_id: int, password_hash: str) -> None:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE dbo.Students SET PasswordHash = ? WHERE StudentID = ?;",
                (password_hash, student_id),
            )
            conn.commit()
```

- [ ] **Step 3: Add invite token methods**

Still inside `Repository`, after the student auth methods:

```python
    @staticmethod
    def create_invite_token(student_id: int) -> str:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=48)
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO dbo.StudentInviteTokens (StudentID, Token, ExpiresAt)
                VALUES (?, ?, ?);
                """,
                (student_id, token, expires_at),
            )
            conn.commit()
        return token

    @staticmethod
    def get_invite_token(token: str) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT t.TokenID, t.StudentID, t.Token, t.ExpiresAt, t.UsedAt,
                   s.FullName, s.FullNameKurdish, s.Email
            FROM dbo.StudentInviteTokens t
            JOIN dbo.Students s ON s.StudentID = t.StudentID
            WHERE t.Token = ?;
            """,
            (token,),
        )

    @staticmethod
    def mark_all_tokens_used_for_student(student_id: int) -> None:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE dbo.StudentInviteTokens
                SET UsedAt = SYSUTCDATETIME()
                WHERE StudentID = ? AND UsedAt IS NULL;
                """,
                (student_id,),
            )
            conn.commit()
```

- [ ] **Step 4: Verify the methods are importable**

```bash
cd backend && python -c "from app.repos import Repository; print(dir(Repository))" 2>&1 | grep -E "student|invite|token"
```
Expected: lines containing `get_student_by_email`, `set_student_password`, `create_invite_token`, `get_invite_token`, `mark_all_tokens_used_for_student`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/repos.py
git commit -m "feat: add student auth and invite token repo methods"
```

---

## Task 5: Repos — Student Portal Data & Face Deletion

**Files:**
- Modify: `backend/app/repos.py`

- [ ] **Step 1: Add portal data and face deletion methods**

Inside `Repository`, after the invite token methods from Task 4:

```python
    @staticmethod
    def get_student_portal_data(student_id: int) -> Dict[str, Any]:
        student = fetch_one(
            """
            SELECT StudentID, FullName, FullNameKurdish,
                   FaceDeletedBySelf, FaceDeletedAt
            FROM dbo.Students WHERE StudentID = ?;
            """,
            (student_id,),
        )
        courses = fetch_all(
            """
            SELECT c.CourseName, e.HoursAbsentTotal
            FROM dbo.Enrollments e
            JOIN dbo.Courses c ON c.CourseID = e.CourseID
            WHERE e.StudentID = ?;
            """,
            (student_id,),
        )
        face_row = fetch_one(
            "SELECT COUNT(*) AS cnt FROM dbo.StudentFaceEmbeddings WHERE StudentID = ?;",
            (student_id,),
        )
        deleted_at = student["FaceDeletedAt"]
        return {
            "full_name": student["FullName"],
            "full_name_kurdish": student["FullNameKurdish"],
            "courses": [
                {
                    "course_name": row["CourseName"],
                    "hours_absent": float(row["HoursAbsentTotal"]),
                }
                for row in courses
            ],
            "face_enrolled": (face_row["cnt"] > 0),
            "face_deleted_by_self": bool(student["FaceDeletedBySelf"]),
            "face_deleted_at": deleted_at.isoformat() if deleted_at else None,
        }

    @staticmethod
    def delete_student_face(student_id: int) -> None:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM dbo.StudentFaceEmbeddings WHERE StudentID = ?;",
                (student_id,),
            )
            cursor.execute(
                """
                UPDATE dbo.Students
                SET FaceDeletedBySelf = 1,
                    FaceDeletedAt     = SYSUTCDATETIME(),
                    EnrollmentStatus  = N'pending'
                WHERE StudentID = ?;
                """,
                (student_id,),
            )
            conn.commit()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repos.py
git commit -m "feat: add student portal data and face deletion repo methods"
```

---

## Task 6: Repos — Update list_course_students & mark_student_enrolled

**Files:**
- Modify: `backend/app/repos.py`

- [ ] **Step 1: Update `list_course_students` to include face deletion fields**

Find the existing `list_course_students` method (around line 216). Replace its SQL with:

```python
    @staticmethod
    def list_course_students(course_id: int) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT s.StudentID, s.StudentCode, s.FullName, s.FullNameKurdish, s.Email,
                   ISNULL(s.EnrollmentStatus, N'pending') AS EnrollmentStatus,
                   s.FaceDeletedBySelf, s.FaceDeletedAt
            FROM dbo.Students s
            INNER JOIN dbo.Enrollments e ON e.StudentID = s.StudentID
            WHERE e.CourseID = ? AND s.IsActive = 1
            ORDER BY s.FullName;
            """,
            (course_id,),
        )
```

- [ ] **Step 2: Update `mark_student_enrolled` to clear the deletion flag**

Find the existing `mark_student_enrolled` method (around line 198). Replace its body:

```python
    @staticmethod
    def mark_student_enrolled(student_id: int) -> None:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE dbo.Students
                SET EnrollmentStatus  = N'enrolled',
                    FaceDeletedBySelf = 0,
                    FaceDeletedAt     = NULL
                WHERE StudentID = ?;
                """,
                (student_id,),
            )
            conn.commit()
```

- [ ] **Step 3: Update `create_student_and_enroll` to auto-generate student_code and accept Kurdish name**

Find `create_student_and_enroll` (around line 103). Replace the first part of the method body:

```python
    @staticmethod
    def create_student_and_enroll(payload: Dict[str, Any]) -> Dict[str, Any]:
        full_name = payload["full_name"]
        full_name_kurdish = payload.get("full_name_kurdish")
        email = payload["email"]
        profile_photo_url = payload.get("profile_photo_url")
        course_id = payload["course_id"]
        # Auto-generate a unique student code
        student_code = f"STU-{uuid.uuid4().hex[:8].upper()}"

        grades = payload.get("grades", {})
        grade_tuple: Tuple[Any, ...] = (
            grades.get("quiz1", 0),
            grades.get("quiz2", 0),
            grades.get("project", 0),
            grades.get("assignment", 0),
            grades.get("midterm", 0),
            grades.get("final_exam", 0),
        )

        with get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute(
                """
                INSERT INTO dbo.Students
                    (StudentCode, FullName, FullNameKurdish, Email, ProfilePhotoUrl)
                OUTPUT INSERTED.StudentID
                VALUES (?, ?, ?, ?, ?);
                """,
                (student_code, full_name, full_name_kurdish, email, profile_photo_url),
            )
            student_id = cursor.fetchone()[0]

            cursor.execute(
                """
                INSERT INTO dbo.Enrollments
                    (StudentID, CourseID, Quiz1, Quiz2, ProjectGrade,
                     AssignmentGrade, MidtermGrade, FinalExamGrade)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (student_id, course_id, *grade_tuple),
            )

            conn.commit()

        return {
            "student_id": int(student_id),
            "course_id": int(course_id),
        }
```

- [ ] **Step 4: Verify module still imports**

```bash
cd backend && python -c "from app.repos import Repository; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/repos.py
git commit -m "feat: update list_course_students, mark_student_enrolled, and create_student_and_enroll for student portal"
```

---

## Task 7: Auth — Student Token & Dependencies

**Files:**
- Modify: `backend/app/auth.py`

- [ ] **Step 1: Replace the full contents of auth.py**

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import jwt
from fastapi import Header, HTTPException, status

from .config import settings


def create_access_token(professor_id: int, username: str, course_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    payload: Dict = {
        "sub": str(professor_id),
        "role": "professor",
        "username": username,
        "course_id": course_id,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_student_token(
    student_id: int,
    full_name: str,
    full_name_kurdish: Optional[str],
    password_set: bool = True,
    expire_minutes: Optional[int] = None,
) -> str:
    if expire_minutes is None:
        expire_minutes = settings.jwt_access_token_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    payload: Dict = {
        "sub": str(student_id),
        "role": "student",
        "full_name": full_name,
        "full_name_kurdish": full_name_kurdish,
        "password_set": password_set,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[Dict]:
    """Decode and validate a JWT. Returns the payload dict or None on failure."""
    try:
        return jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_professor(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency — validates Bearer token, asserts professor role."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("role", "professor") != "professor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Professor access only.",
        )
    return payload


def get_current_student(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency — validates Bearer token, asserts student role with password set."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("role") != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access only.",
        )
    if not payload.get("password_set", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password setup required before accessing this resource.",
        )
    return payload


def get_current_student_invite(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency — one-time invite JWT for the set-password endpoint only."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("role") != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access only.",
        )
    if payload.get("password_set", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is for first-time password setup only.",
        )
    return payload
```

- [ ] **Step 2: Verify auth module**

```bash
cd backend && python -c "from app.auth import create_access_token, create_student_token, get_current_professor, get_current_student, get_current_student_invite; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/auth.py
git commit -m "feat: add student token creation and student auth dependencies"
```

---

## Task 8: Email Service — Invite Email

**Files:**
- Modify: `backend/app/services/email_service.py`

- [ ] **Step 1: Add `send_invite_email` method to the `EmailService` class**

Find the end of the `EmailService` class in `backend/app/services/email_service.py` and append this method before the closing of the class:

```python
    def send_invite_email(
        self,
        student_email: str,
        full_name: str,
        full_name_kurdish: Optional[str],
        magic_link: str,
    ) -> None:
        kurdish_name = full_name_kurdish or full_name
        html = f"""<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;">
    <div style="background:#fff;padding:24px 32px;">
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#0f0f0f;letter-spacing:-0.5px;">Attendify</h1>
    </div>

    <!-- English -->
    <div style="padding:32px;">
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#fff;">Hello, {full_name}</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;line-height:1.6;">
        Your professor has added you to Attendify. Click the button below to set up your account and access your attendance portal.
      </p>
      <a href="{magic_link}" style="display:inline-block;padding:12px 28px;background:#fff;color:#0f0f0f;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        Set Up My Account
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
        This link expires in 48 hours. If you did not expect this email, you can safely ignore it.
      </p>
    </div>

    <hr style="border:none;border-top:1px solid #2a2a2a;margin:0;">

    <!-- Kurdish (RTL) -->
    <div style="padding:32px;" dir="rtl">
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#fff;">سڵاو، {kurdish_name}</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;line-height:1.6;">
        مامۆستاکەت تۆی زیاد کردووە بۆ سیستەمی ئەتێندیفای. کلیک بکە لەسەر دووگمەی خوارەوە بۆ دامەزراندنی ئەکاونتەکەت و دەستگەیشتن بە پۆرتاڵی ئامادەبوونەکەت.
      </p>
      <a href="{magic_link}" style="display:inline-block;padding:12px 28px;background:#fff;color:#0f0f0f;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
        دامەزراندنی ئەکاونتەکەم
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
        ئەم لینکە ٤٨ کاتژمێر دەمێنێتەوە. ئەگەر چاوەڕوانی ئەم ئیمەیڵەت نەبوو، دەتوانیت پشتگوێیبخەیت.
      </p>
    </div>
  </div>
</body>
</html>"""
        self._send_email(
            student_email,
            "You've been added to Attendify — Set up your account",
            html,
        )
```

- [ ] **Step 2: Ensure `Optional` is imported in email_service.py**

Check the top of `backend/app/services/email_service.py` for `from typing import Optional`. If not present, add it to the existing `from typing import ...` line.

- [ ] **Step 3: Verify the service loads**

```bash
cd backend && python -c "from app.services.email_service import EmailService; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/email_service.py
git commit -m "feat: add send_invite_email to EmailService with bilingual HTML template"
```

---

## Task 9: Backend Routes — Updated Login + Invite/Password Endpoints

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add new imports to main.py**

In `backend/app/main.py`, find the existing auth imports line (which imports `create_access_token` and `get_current_professor`). Replace it with:

```python
from .auth import (
    create_access_token,
    create_student_token,
    decode_token,
    get_current_professor,
    get_current_student,
    get_current_student_invite,
)
```

Find the existing schemas import line and add `SetPasswordRequest` and `StudentPortalResponse` to it. For example if it currently reads:
```python
from .schemas import (
    LoginRequest,
    LoginResponse,
    GenericMessage,
    StudentCreateRequest,
    BulkEmailRequest,
    BulkEmailResponse,
    EnrollmentStartResponse,
    EnrollmentStatusResponse,
    StartSessionRequest,
    StartSessionResponse,
    FinalizeSessionResponse,
    GradeUpdateRequest,
    ManualAttendanceUpdateRequest,
)
```
Add `SetPasswordRequest` and `StudentPortalResponse` to that list.

- [ ] **Step 2: Update the login endpoint**

Find the existing login endpoint (around line 147). Replace it entirely:

```python
@app.post("/api/auth/login")
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest):
    # Try professor first (by username)
    result = repo.authenticate_professor(payload.username, payload.password)
    if result:
        token = create_access_token(
            professor_id=result["professor_id"],
            username=result["username"],
            course_id=result["course_id"],
        )
        return {
            **result,
            "access_token": token,
            "role": "professor",
        }

    # Try student (by email)
    student = repo.get_student_by_email(payload.username)
    if student:
        if student["PasswordHash"] is None:
            raise HTTPException(status_code=403, detail="account_not_setup")
        import bcrypt as _bcrypt
        if not _bcrypt.checkpw(payload.password.encode(), student["PasswordHash"].encode()):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        token = create_student_token(
            student_id=student["StudentID"],
            full_name=student["FullName"],
            full_name_kurdish=student["FullNameKurdish"],
            password_set=True,
        )
        return {
            "access_token": token,
            "role": "student",
            "student_id": student["StudentID"],
            "full_name": student["FullName"],
            "full_name_kurdish": student["FullNameKurdish"],
        }

    raise HTTPException(status_code=401, detail="Invalid username or password.")
```

- [ ] **Step 3: Add invite token validation endpoint**

After the login endpoint, add:

```python
@app.get("/api/auth/invite")
def validate_invite(token: str):
    """Validate a magic-link token and return a short-lived one-time student JWT."""
    record = repo.get_invite_token(token)
    if not record:
        raise HTTPException(status_code=410, detail="token_expired")
    if record["UsedAt"] is not None:
        raise HTTPException(status_code=410, detail="token_used")
    # Compare timezone-aware datetimes
    from datetime import datetime, timezone
    expires = record["ExpiresAt"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="token_expired")
    one_time = create_student_token(
        student_id=record["StudentID"],
        full_name=record["FullName"],
        full_name_kurdish=record["FullNameKurdish"],
        password_set=False,
        expire_minutes=15,
    )
    return {"access_token": one_time, "role": "student", "password_set": False}
```

- [ ] **Step 4: Add password setup endpoint**

After the invite validation endpoint:

```python
@app.post("/api/auth/student/set-password")
def set_student_password(
    payload: SetPasswordRequest,
    student: dict = Depends(get_current_student_invite),
):
    """First-time password setup — requires the one-time invite JWT."""
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")
    import bcrypt as _bcrypt
    hashed = _bcrypt.hashpw(payload.password.encode(), _bcrypt.gensalt()).decode()
    student_id = int(student["sub"])
    repo.set_student_password(student_id, hashed)
    repo.mark_all_tokens_used_for_student(student_id)
    full_token = create_student_token(
        student_id=student_id,
        full_name=student["full_name"],
        full_name_kurdish=student.get("full_name_kurdish"),
        password_set=True,
    )
    return {
        "access_token": full_token,
        "role": "student",
        "student_id": student_id,
        "full_name": student["full_name"],
        "full_name_kurdish": student.get("full_name_kurdish"),
    }
```

- [ ] **Step 5: Verify the backend starts**

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```
Expected: server starts with no import errors. Stop with Ctrl+C.

- [ ] **Step 6: Test the login endpoint still works for professors**

With the server running:
```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<existing_prof_username>","password":"<password>"}' | python -m json.tool
```
Expected: JSON with `role: "professor"`, `professor_id`, `access_token`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: update login for dual role, add invite token and password setup endpoints"
```

---

## Task 10: Backend Routes — Student Portal & Face Deletion

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add student portal endpoint**

After the password setup endpoint added in Task 9, add:

```python
@app.get("/api/student/portal", response_model=StudentPortalResponse)
def get_student_portal(student: dict = Depends(get_current_student)) -> StudentPortalResponse:
    student_id = int(student["sub"])
    data = repo.get_student_portal_data(student_id)
    return StudentPortalResponse(**data)
```

- [ ] **Step 2: Add face deletion endpoint**

```python
@app.delete("/api/student/face")
def delete_student_face(student: dict = Depends(get_current_student)):
    student_id = int(student["sub"])
    data = repo.get_student_portal_data(student_id)
    if not data["face_enrolled"]:
        raise HTTPException(status_code=400, detail="no_face_enrolled")
    repo.delete_student_face(student_id)
    if recognition_service:
        try:
            recognition_service.reload_embeddings()
        except Exception:
            pass
    return {"message": "Face ID deleted successfully."}
```

- [ ] **Step 3: Add resend invite endpoint**

First add this helper function in `main.py` (outside any class, near the other helper functions at the top of the route section):

```python
def _get_student_by_id(student_id: int):
    from .database import fetch_one as _fetch_one
    return _fetch_one(
        "SELECT StudentID, FullName, FullNameKurdish, Email FROM dbo.Students WHERE StudentID = ? AND IsActive = 1;",
        (student_id,),
    )
```

Then add the endpoint:

```python
@app.post("/api/students/{student_id}/invite/resend")
def resend_invite(
    student_id: int,
    professor: dict = Depends(get_current_professor),
):
    student = _get_student_by_id(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    token = repo.create_invite_token(student_id)
    magic_link = f"{settings.frontend_url}?invite={token}"
    email_service.send_invite_email(
        student_email=student["Email"],
        full_name=student["FullName"],
        full_name_kurdish=student["FullNameKurdish"],
        magic_link=magic_link,
    )
    return {"sent": True}
```

- [ ] **Step 4: Verify server still starts cleanly**

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```
Expected: no import or startup errors. Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add student portal, face deletion, and invite resend endpoints"
```

---

## Task 11: Backend Routes — Update Student Creation

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Update the `POST /api/students` endpoint**

Find the existing create_student endpoint (around line 332). Replace it:

```python
@app.post("/api/students", response_model=GenericMessage)
def create_student(
    payload: StudentCreateRequest,
    professor: dict = Depends(get_current_professor),
) -> GenericMessage:
    _require_course(professor, payload.course_id)
    result = repo.create_student_and_enroll(payload.model_dump())
    # Generate invite token and send email
    token = repo.create_invite_token(result["student_id"])
    magic_link = f"{settings.frontend_url}?invite={token}"
    email_service.send_invite_email(
        student_email=payload.email,
        full_name=payload.full_name,
        full_name_kurdish=payload.full_name_kurdish,
        magic_link=magic_link,
    )
    return GenericMessage(message="Student created and invite sent.", data=result)
```

- [ ] **Step 2: Verify the app still imports and starts**

```bash
cd backend && python -c "from app.main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: update student creation to send invite email after account creation"
```

---

## Task 12: Frontend — Translation Keys

**Files:**
- Modify: `frontend/src/lib/translations.js`

- [ ] **Step 1: Add all new keys to the `en` object**

Open `frontend/src/lib/translations.js`. Inside the `en: { ... }` object, at the end before the closing `}`, add:

```js
    // Student portal
    student_portal_title: 'Student Portal',
    student_absence_title: 'My Attendance',
    student_hours_absent: 'hrs absent',
    student_face_id_title: 'Face ID',
    student_face_active: 'Active',
    student_face_deleted: 'Deleted',
    student_face_not_enrolled: 'Not enrolled',
    student_face_delete_btn: 'Delete Face ID',
    student_face_delete_confirm_title: 'Delete your Face ID?',
    student_face_delete_confirm_body: 'This will remove your face from all courses. Your professors will need to re-enroll you before you can be recognized in class.',
    student_face_delete_contact_msg: 'Contact your course professors to re-enroll your Face ID.',
    student_face_delete_confirm: 'Yes, delete',
    student_face_delete_cancel: 'Cancel',
    // Password setup
    setup_password_title: 'Set up your password',
    setup_password_subtitle: 'Choose a password to access your Attendify portal.',
    setup_password_new: 'New password',
    setup_password_confirm: 'Confirm password',
    setup_password_submit: 'Set password & continue',
    setup_password_mismatch: 'Passwords do not match.',
    setup_password_too_short: 'Password must be at least 8 characters.',
    // Add student modal
    add_student_btn: 'Add Student',
    add_student_title: 'Add New Student',
    add_student_name_en: 'Full name (English)',
    add_student_name_ku: 'Full name (Kurdish)',
    add_student_email: 'Email address',
    add_student_invite_sent: 'Student added — invite email sent.',
    add_student_submit: 'Add & Send Invite',
    // Enrollment page — face deleted badge
    enroll_student_deleted: 'Student deleted',
    enroll_student_deleted_tooltip: 'Student deleted their Face ID on {date}',
    // Login
    login_username_or_email: 'Username or Email',
    login_account_not_setup: 'Your account is not set up yet. Check your email for the setup link.',
```

- [ ] **Step 2: Add the same keys to the `ckb` object**

Inside the `ckb: { ... }` object, add at the end:

```js
    // Student portal
    student_portal_title: 'پۆرتاڵی خوێندکار',
    student_absence_title: 'ئامادەبوونەکەم',
    student_hours_absent: 'کاتژمێر نەبووە',
    student_face_id_title: 'ناسنامەی ڕووخسار',
    student_face_active: 'چالاک',
    student_face_deleted: 'سڕایەوە',
    student_face_not_enrolled: 'تۆمار نەکراوە',
    student_face_delete_btn: 'سڕینەوەی ناسنامەی ڕووخسار',
    student_face_delete_confirm_title: 'ناسنامەی ڕووخسارەکەت بسڕیتەوە؟',
    student_face_delete_confirm_body: 'ئەمە ڕووخسارەکەت لە هەموو وانەکان دەسڕێتەوە. مامۆستاکانت دەبێت دووبارە تۆمارت بکەن پێش ئەوەی لە پۆلدا بناسرێیت.',
    student_face_delete_contact_msg: 'پەیوەندی بکە بە مامۆستاکانی وانەکانت بۆ دووبارە تۆمارکردنی ناسنامەی ڕووخسارەکەت.',
    student_face_delete_confirm: 'بەڵێ، بیسڕەوە',
    student_face_delete_cancel: 'پاشگەزبوونەوە',
    // Password setup
    setup_password_title: 'وشەی نهێنیەکەت دابنێ',
    setup_password_subtitle: 'وشەیەکی نهێنی هەڵبژێرە بۆ دەستگەیشتن بە پۆرتاڵی ئەتێندیفایەکەت.',
    setup_password_new: 'وشەی نهێنی نوێ',
    setup_password_confirm: 'پشتڕاستکردنەوەی وشەی نهێنی',
    setup_password_submit: 'دانانی وشەی نهێنی و بەردەوامبوون',
    setup_password_mismatch: 'وشەکانی نهێنی یەکسان نین.',
    setup_password_too_short: 'وشەی نهێنی دەبێت لانی کەم ٨ پیت بێت.',
    // Add student modal
    add_student_btn: 'خوێندکار زیاد بکە',
    add_student_title: 'خوێندکاری نوێ زیاد بکە',
    add_student_name_en: 'ناوی تەواو (ئینگلیزی)',
    add_student_name_ku: 'ناوی تەواو (کوردی)',
    add_student_email: 'ئیمەیڵ',
    add_student_invite_sent: 'خوێندکار زیادکرا — ئیمەیڵی بانگهێشت نێردرا.',
    add_student_submit: 'زیادکردن و ناردنی بانگهێشت',
    // Enrollment page — face deleted badge
    enroll_student_deleted: 'خوێندکار سڕیەوە',
    enroll_student_deleted_tooltip: 'خوێندکار ناسنامەی ڕووخسارییەکەی سڕیەوە لە {date}',
    // Login
    login_username_or_email: 'ناوی بەکارهێنەر یان ئیمەیڵ',
    login_account_not_setup: 'ئەکاونتەکەت هێشتا دانەنراوە. ئیمەیڵەکەت بپشکنە بۆ لینکی دامەزراندن.',
```

- [ ] **Step 3: Verify frontend still builds**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: no errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/translations.js
git commit -m "feat: add student portal, password setup, and enrollment translation keys (en + ckb)"
```

---

## Task 13: Frontend — LoginPage Label Change

**Files:**
- Modify: `frontend/src/components/auth/LoginPage.jsx`

- [ ] **Step 1: Update the username field label and error handling**

In `frontend/src/components/auth/LoginPage.jsx`, find the JSX that renders the username input. Look for the label or placeholder text that says `{t('login_username')}` (or similar). Replace the label text with `{t('login_username_or_email')}`.

Also find the error handling for the login fetch. Locate where it handles a `403` response or the string `"Invalid username or password"` and add handling for `account_not_setup`:

Find the error-setting code in the login submit handler (look for `setError(`) and update it so that when the response status is `403` and the detail is `account_not_setup`, it sets:
```js
setError(t('login_account_not_setup'))
```

The exact implementation depends on the existing error-handling pattern in the file. Read the full submit handler first, then wrap the existing error with:
```js
if (res.status === 403) {
  const body = await res.json().catch(() => ({}))
  if (body.detail === 'account_not_setup') {
    setError(t('login_account_not_setup'))
    return
  }
}
```

- [ ] **Step 2: Verify in browser**

Start dev server: `cd frontend && npm run dev`
Open the login page — the username field label should read "Username or Email" (English) or the Kurdish equivalent.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/auth/LoginPage.jsx
git commit -m "feat: update login page to accept username or email, handle account_not_setup error"
```

---

## Task 14: Frontend — PasswordSetup Component

**Files:**
- Create: `frontend/src/components/student/PasswordSetup.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/student/PasswordSetup.jsx`:

```jsx
import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export function PasswordSetup({ apiBase, token, onComplete }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError(t('setup_password_too_short')); return }
    if (password !== confirm) { setError(t('setup_password_mismatch')); return }
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/auth/student/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password, confirm_password: confirm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Setup failed.')
      onComplete(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="w-12 h-12 rounded-full bg-fg/10 flex items-center justify-center mx-auto mb-4">
            <Lock size={22} className="text-fg" />
          </div>
          <h1 className="text-xl font-bold text-fg">{t('setup_password_title')}</h1>
          <p className="text-sm text-secondary mt-1">{t('setup_password_subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('setup_password_new')}
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 pe-10 text-sm bg-surface border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-secondary hover:text-fg transition-colors"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('setup_password_confirm')}
            </label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm bg-surface border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-fg text-bg text-sm font-medium rounded-sm hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
          >
            {loading ? '...' : t('setup_password_submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/student/PasswordSetup.jsx
git commit -m "feat: add PasswordSetup component for first-time student login"
```

---

## Task 15: Frontend — StudentPortal Component

**Files:**
- Create: `frontend/src/components/student/StudentPortal.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/student/StudentPortal.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { BookOpen, Clock, ShieldAlert, ShieldCheck, ShieldOff, Loader2, Sun, Moon, Languages, LogOut } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export function StudentPortal({ apiBase, student, onLogout, theme, toggleTheme, language, toggleLanguage }) {
  const { t } = useTranslation()
  const [portal, setPortal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const token = localStorage.getItem('ams_token')

  const apiFetch = async (path, options = {}) => {
    const res = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || res.statusText)
    }
    return res.json()
  }

  useEffect(() => {
    apiFetch('/api/student/portal')
      .then(setPortal)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleDeleteFace = async () => {
    setDeleting(true)
    try {
      await apiFetch('/api/student/face', { method: 'DELETE' })
      setPortal(prev => ({ ...prev, face_enrolled: false, face_deleted_by_self: true, face_deleted_at: new Date().toISOString() }))
      setDeleteModal(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const displayName = language === 'ckb' && portal?.full_name_kurdish
    ? portal.full_name_kurdish
    : portal?.full_name || student?.full_name || ''

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-secondary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div>
            <p className="text-xs text-secondary">{t('student_portal_title')}</p>
            <p className="text-sm font-semibold text-fg leading-tight">{displayName}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleLanguage}
              className="p-2 rounded-sm text-secondary hover:text-fg hover:bg-bg transition-colors cursor-pointer"
              title="Toggle language"
            >
              <Languages size={16} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-sm text-secondary hover:text-fg hover:bg-bg transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-sm text-secondary hover:text-fg hover:bg-bg transition-colors cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-4 py-3">
            {error}
          </div>
        )}

        {/* Absence cards */}
        <section>
          <h2 className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">
            {t('student_absence_title')}
          </h2>
          <div className="space-y-2">
            {portal?.courses?.length === 0 && (
              <p className="text-sm text-secondary text-center py-8">—</p>
            )}
            {portal?.courses?.map((course) => (
              <div key={course.course_name} className="standard-card flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-fg/10 flex items-center justify-center">
                    <BookOpen size={15} className="text-fg" />
                  </div>
                  <p className="text-sm font-medium text-fg">{course.course_name}</p>
                </div>
                <div className="flex items-center gap-1.5 text-secondary">
                  <Clock size={13} />
                  <span className="text-sm font-semibold text-fg">{course.hours_absent}</span>
                  <span className="text-xs">{t('student_hours_absent')}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Face ID section */}
        <section>
          <h2 className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">
            {t('student_face_id_title')}
          </h2>
          <div className="standard-card px-4 py-4 space-y-4">
            {/* Status indicator */}
            <div className="flex items-center gap-3">
              {portal?.face_enrolled ? (
                <>
                  <ShieldCheck size={18} className="text-green-500" />
                  <span className="text-sm font-medium text-green-500">{t('student_face_active')}</span>
                </>
              ) : portal?.face_deleted_by_self ? (
                <>
                  <ShieldAlert size={18} className="text-red-500" />
                  <span className="text-sm font-medium text-red-500">{t('student_face_deleted')}</span>
                </>
              ) : (
                <>
                  <ShieldOff size={18} className="text-secondary" />
                  <span className="text-sm font-medium text-secondary">{t('student_face_not_enrolled')}</span>
                </>
              )}
            </div>

            {/* Delete button — only when enrolled */}
            {portal?.face_enrolled && (
              <button
                onClick={() => setDeleteModal(true)}
                className="w-full py-2 border border-red-500/40 text-red-500 text-sm font-medium rounded-sm hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                {t('student_face_delete_btn')}
              </button>
            )}

            {/* Post-deletion message */}
            {portal?.face_deleted_by_self && !portal?.face_enrolled && (
              <p className="text-xs text-secondary leading-relaxed">
                {t('student_face_delete_contact_msg')}
              </p>
            )}
          </div>
        </section>
      </main>

      {/* Delete confirmation modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-sm w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-fg">{t('student_face_delete_confirm_title')}</h3>
            <p className="text-sm text-secondary leading-relaxed">{t('student_face_delete_confirm_body')}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteModal(false)}
                disabled={deleting}
                className="flex-1 py-2 border border-border text-secondary text-sm rounded-sm hover:text-fg transition-colors cursor-pointer disabled:opacity-40"
              >
                {t('student_face_delete_cancel')}
              </button>
              <button
                onClick={handleDeleteFace}
                disabled={deleting}
                className="flex-1 py-2 bg-red-500 text-white text-sm font-medium rounded-sm hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-40"
              >
                {deleting ? '...' : t('student_face_delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/student/StudentPortal.jsx
git commit -m "feat: add StudentPortal component with absence cards and face ID management"
```

---

## Task 16: Frontend — App.jsx Role Routing & Invite Param

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add student state and imports**

At the top of `frontend/src/App.jsx`, add these imports alongside the existing component imports:

```js
import { PasswordSetup } from './components/student/PasswordSetup'
import { StudentPortal } from './components/student/StudentPortal'
```

Inside the `App` component function, after the `professor` state declaration (around line 97), add the `student` state:

```js
const [student, setStudent] = useState(() => {
  try {
    const saved = localStorage.getItem('ams_student')
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
})

// One-time invite token state (set when user lands via magic link)
const [inviteToken, setInviteToken] = useState(null)
```

- [ ] **Step 2: Add invite param detection in a useEffect**

Add a new `useEffect` near the top of the component (after the theme/language effects):

```js
useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  const invite = params.get('invite')
  if (!invite) return
  // Clean URL immediately so refresh doesn't re-trigger
  window.history.replaceState({}, '', '/')
  fetch(`${apiBase}/api/auth/invite?token=${encodeURIComponent(invite)}`)
    .then(async (res) => {
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Invalid link')
      // Store one-time token for PasswordSetup
      localStorage.setItem('ams_token', data.access_token)
      setInviteToken(data.access_token)
    })
    .catch((err) => {
      console.error('Invite link error:', err.message)
    })
}, [])
```

- [ ] **Step 3: Update `handleLogin` to handle both roles**

Find the existing `handleLogin` function (around line 106). Replace it:

```js
const handleLogin = (data) => {
  const { access_token, role, ...profile } = data
  if (access_token) localStorage.setItem('ams_token', access_token)
  if (role === 'student') {
    localStorage.setItem('ams_student', JSON.stringify({ ...profile, role }))
    setStudent({ ...profile, role })
  } else {
    localStorage.setItem('ams_professor', JSON.stringify({ ...profile, role: 'professor' }))
    setProfessor({ ...profile, role: 'professor' })
  }
}
```

- [ ] **Step 4: Add `handleStudentLogout`**

After `handleLogout`, add:

```js
const handleStudentLogout = () => {
  localStorage.removeItem('ams_token')
  localStorage.removeItem('ams_student')
  setStudent(null)
  setInviteToken(null)
}
```

- [ ] **Step 5: Update the render section for role-based routing**

Find the existing role check (around line 605):
```js
if (!professor) {
  return (
    <I18nProvider language={language}>
      <LoginPage apiBase={apiBase} onLogin={handleLogin} />
    </I18nProvider>
  );
}
```

Replace with:

```js
// Magic link invite — show password setup before anything else
if (inviteToken) {
  return (
    <I18nProvider language={language}>
      <PasswordSetup
        apiBase={apiBase}
        token={inviteToken}
        onComplete={(data) => {
          setInviteToken(null)
          handleLogin(data)
        }}
      />
    </I18nProvider>
  )
}

// Student portal
if (student) {
  return (
    <I18nProvider language={language}>
      <StudentPortal
        apiBase={apiBase}
        student={student}
        onLogout={handleStudentLogout}
        theme={theme}
        toggleTheme={() => {
          const next = theme === 'dark' ? 'light' : 'dark'
          setTheme(next)
          localStorage.setItem('ams_theme', next)
          localStorage.setItem('ams_theme_manual', 'true')
        }}
        language={language}
        toggleLanguage={() => {
          const next = language === 'en' ? 'ckb' : 'en'
          setLanguage(next)
          localStorage.setItem('ams_language', next)
        }}
      />
    </I18nProvider>
  )
}

// Professor login gate
if (!professor) {
  return (
    <I18nProvider language={language}>
      <LoginPage apiBase={apiBase} onLogin={handleLogin} />
    </I18nProvider>
  )
}
```

- [ ] **Step 6: Verify the app builds**

```bash
cd frontend && npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add role-based routing in App.jsx (invite param, student portal, professor dashboard)"
```

---

## Task 17: Frontend — EnrollmentTab Updates (Deleted Badge + Add Student Modal)

**Files:**
- Modify: `frontend/src/components/enrollment/EnrollmentTab.jsx`

- [ ] **Step 1: Add new imports**

At the top of `EnrollmentTab.jsx`, update the import line to include new icons and useState:

```js
import { useState, useEffect, useCallback } from 'react'
import { ScanFace, CheckCircle2, Loader2, RefreshCw, Search, UserPlus, AlertTriangle, X } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { tName } from '../../lib/nameTranslation'
```

- [ ] **Step 2: Add `addModal` state and `handleAddStudent` inside the component**

At the top of the `EnrollmentTab` function body, after the existing state declarations, add:

```js
const [addModal, setAddModal] = useState(false)
const [addForm, setAddForm] = useState({ full_name: '', full_name_kurdish: '', email: '' })
const [addLoading, setAddLoading] = useState(false)
const [addError, setAddError] = useState('')
const [addSuccess, setAddSuccess] = useState('')

const handleAddStudent = async (e) => {
  e.preventDefault()
  setAddError('')
  setAddSuccess('')
  setAddLoading(true)
  try {
    await apiFetch('/api/students', {
      method: 'POST',
      body: JSON.stringify({ ...addForm, course_id: courseId }),
    })
    setAddSuccess(t('add_student_invite_sent'))
    setAddForm({ full_name: '', full_name_kurdish: '', email: '' })
    await loadStudents()
    setTimeout(() => { setAddModal(false); setAddSuccess('') }, 1500)
  } catch (err) {
    setAddError(err.message || 'Failed to add student.')
  } finally {
    setAddLoading(false)
  }
}
```

Note: `apiFetch` is not currently a prop of `EnrollmentTab`. It receives `apiFetch` as a prop (check the parent call site in App.jsx to confirm). If the component currently uses a bare `fetch` with token, adapt accordingly — but the prop name is `apiFetch` based on the existing code pattern.

- [ ] **Step 3: Add "Add Student" button next to the refresh button**

In the search + refresh row (around line 64 of the original file), after the `<button onClick={loadStudents} ...>` refresh button, add:

```jsx
<button
  onClick={() => { setAddModal(true); setAddError(''); setAddSuccess('') }}
  className="p-2 rounded-sm border border-border text-secondary hover:text-fg hover:bg-surface transition-colors cursor-pointer"
  title={t('add_student_btn')}
>
  <UserPlus size={14} />
</button>
```

- [ ] **Step 4: Update the student row to show "Student deleted" badge**

In the `filtered.map(...)` section (around line 99 of the original), replace:

```js
const enrolled = student.EnrollmentStatus === 'enrolled'
```

With:

```js
const enrolled = student.EnrollmentStatus === 'enrolled'
const faceDeletedBySelf = Boolean(student.FaceDeletedBySelf)
const deletedAt = student.FaceDeletedAt
  ? new Date(student.FaceDeletedAt).toLocaleDateString()
  : ''
```

Then replace the existing icon+button section — the part that checks `enrolled` to show `CheckCircle2` or `ScanFace`, and the enroll button:

```jsx
<div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
  <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 ${
    enrolled
      ? 'bg-green-500/10 text-green-500'
      : faceDeletedBySelf
      ? 'bg-red-500/10 text-red-500'
      : 'bg-surface text-secondary'
  }`}>
    {enrolled ? <CheckCircle2 size={16} /> : faceDeletedBySelf ? <AlertTriangle size={16} /> : <ScanFace size={16} />}
  </div>
  <div className="min-w-0 flex-1">
    <p className="text-sm font-semibold text-fg truncate">{tName(student.FullName, language)}</p>
    {faceDeletedBySelf && !enrolled && (
      <p className="text-[11px] text-red-500 leading-tight" title={t('enroll_student_deleted_tooltip').replace('{date}', deletedAt)}>
        {t('enroll_student_deleted')}
      </p>
    )}
  </div>
</div>

<div className="flex items-center gap-2 sm:gap-3 shrink-0">
  <button
    onClick={() => onEnrollStudent(student.StudentID, tName(student.FullName, language))}
    className={`relative min-w-[108px] px-3 sm:px-4 py-1.5 rounded-sm text-xs font-medium transition-all cursor-pointer whitespace-nowrap text-center ${
      enrolled
        ? 'group border border-green-500/40 text-green-500 hover:bg-fg hover:border-fg'
        : faceDeletedBySelf
        ? 'bg-red-500/10 border border-red-500/40 text-red-500 hover:bg-fg hover:border-fg hover:text-bg'
        : 'bg-fg text-bg hover:opacity-80'
    }`}
  >
    {enrolled ? (
      <>
        <span className="transition-opacity duration-150 group-hover:opacity-0">{t('enroll_enrolled')}</span>
        <span className="absolute inset-0 flex items-center justify-center text-bg opacity-0 transition-opacity duration-150 group-hover:opacity-100">{t('enroll_reenroll')}</span>
      </>
    ) : faceDeletedBySelf ? (
      <span>{t('enroll_reenroll')}</span>
    ) : (
      t('enroll_add')
    )}
  </button>
</div>
```

- [ ] **Step 5: Add the "Add Student" modal at the bottom of the component return**

Just before the final closing `</div>` of the component's return:

```jsx
{/* Add Student Modal */}
{addModal && (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div className="bg-surface border border-border rounded-sm w-full max-w-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-fg">{t('add_student_title')}</h3>
        <button
          onClick={() => setAddModal(false)}
          className="text-secondary hover:text-fg transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>
      <form onSubmit={handleAddStudent} className="px-5 py-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('add_student_name_en')} *
          </label>
          <input
            type="text"
            required
            value={addForm.full_name}
            onChange={(e) => setAddForm(f => ({ ...f, full_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('add_student_name_ku')}
          </label>
          <input
            type="text"
            value={addForm.full_name_kurdish}
            onChange={(e) => setAddForm(f => ({ ...f, full_name_kurdish: e.target.value }))}
            dir="rtl"
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('add_student_email')} *
          </label>
          <input
            type="email"
            required
            value={addForm.email}
            onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
          />
        </div>

        {addError && (
          <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-3 py-2">
            {addError}
          </p>
        )}
        {addSuccess && (
          <p className="text-xs text-green-500 bg-green-500/10 border border-green-500/20 rounded-sm px-3 py-2">
            {addSuccess}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setAddModal(false)}
            className="flex-1 py-2 border border-border text-secondary text-sm rounded-sm hover:text-fg transition-colors cursor-pointer"
          >
            {t('student_face_delete_cancel')}
          </button>
          <button
            type="submit"
            disabled={addLoading}
            className="flex-1 py-2 bg-fg text-bg text-sm font-medium rounded-sm hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
          >
            {addLoading ? '...' : t('add_student_submit')}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
```

- [ ] **Step 6: Check how `apiFetch` is passed into EnrollmentTab**

Search `App.jsx` for `<EnrollmentTab` to confirm the prop names. The component signature is `EnrollmentTab({ apiFetch, courseId, onEnrollStudent })`. Ensure `apiFetch` is being passed — if the parent passes a different name, align them.

- [ ] **Step 7: Build and verify**

```bash
cd frontend && npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/enrollment/EnrollmentTab.jsx
git commit -m "feat: add 'Student deleted' badge and 'Add Student' modal to EnrollmentTab"
```

---

## End-to-End Verification

Once all tasks are committed, run this full flow to confirm everything works:

- [ ] **1. Start backend**
  ```bash
  cd backend && uvicorn app.main:app --reload
  ```

- [ ] **2. Start frontend**
  ```bash
  cd frontend && npm run dev
  ```

- [ ] **3. Professor adds a student**
  - Log in as professor
  - Go to Enrollment tab
  - Click "Add Student" → fill English name, Kurdish name (optional), email → submit
  - Expected: success message, student appears in list

- [ ] **4. Student receives invite email**
  - Check the student's email inbox (or check SMTP dry-run logs in backend console)
  - Expected: bilingual email with a link containing `?invite=<token>`

- [ ] **5. Student clicks magic link**
  - Open the link in browser
  - Expected: password setup screen appears immediately

- [ ] **6. Student sets password**
  - Enter password (≥8 chars), confirm, submit
  - Expected: redirected to student portal showing courses + absence hours

- [ ] **7. Student deletes Face ID**
  - Click "Delete Face ID" → confirm in modal
  - Expected: status changes to "Deleted (red)", delete button disappears, contact message shown

- [ ] **8. Professor sees "Student deleted" badge**
  - Professor logs in, goes to Enrollment tab
  - Expected: student row shows red "Student deleted" label instead of "Unassigned"
  - Hover tooltip shows the deletion date

- [ ] **9. Professor re-enrolls student**
  - Professor clicks Re-enroll on that student → completes enrollment flow
  - Expected: student deleted badge disappears, student portal shows face as "Active" again
