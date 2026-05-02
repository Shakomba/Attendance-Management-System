from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import bcrypt as _bcrypt

from .database import execute, fetch_all, fetch_one, get_connection


class Repository:
    @staticmethod
    def authenticate_professor(username: str, password: str) -> Optional[Dict[str, Any]]:
        # Fetch by username only — password verification happens in Python with bcrypt.
        # If the stored hash is a legacy SHA-256 hex (64 chars), reject and require migration.
        row = fetch_one(
            """
            SELECT p.ProfessorID, p.Username, p.FullName, p.CourseID,
                   p.PasswordHash, c.CourseName, c.CourseCode
            FROM dbo.Professors p
            INNER JOIN dbo.Courses c ON c.CourseID = p.CourseID
            WHERE p.Username = ? AND p.IsActive = 1;
            """,
            (username,),
        )
        if not row:
            return None
        stored_hash: str = row["PasswordHash"] or ""
        # Legacy SHA-256 hashes are 64 lowercase hex chars — reject them so admins must rehash.
        if len(stored_hash) == 64 and all(c in "0123456789abcdef" for c in stored_hash):
            return None
        if not _bcrypt.checkpw(password.encode(), stored_hash.encode()):
            return None
        return {
            "professor_id": row["ProfessorID"],
            "username": row["Username"],
            "full_name": row["FullName"],
            "course_id": row["CourseID"],
            "course_name": row["CourseName"],
            "course_code": row["CourseCode"],
        }

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

    @staticmethod
    def get_student_enrollment_by_course(student_id: int, course_id: int) -> Optional[Dict[str, Any]]:
        return fetch_one(
            "SELECT EnrollmentID FROM dbo.Enrollments WHERE StudentID = ? AND CourseID = ?;",
            (student_id, course_id),
        )

    @staticmethod
    def get_student_portal_data(student_id: int) -> Optional[Dict[str, Any]]:
        student = fetch_one(
            """
            SELECT StudentID, FullName, FullNameKurdish,
                   FaceDeletedBySelf, FaceDeletedAt
            FROM dbo.Students WHERE StudentID = ? AND IsActive = 1;
            """,
            (student_id,),
        )
        if not student:
            return None
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

    @staticmethod
    def update_professor_profile(
        professor_id: int,
        course_id: int,
        full_name: Optional[str],
        username: Optional[str],
        course_name: Optional[str],
        new_password_hash: Optional[str],
    ) -> Dict[str, Any]:
        with get_connection() as conn:
            cursor = conn.cursor()
            if full_name or username or new_password_hash:
                parts, params = [], []
                if full_name:
                    parts.append("FullName = ?"); params.append(full_name)
                if username:
                    parts.append("Username = ?"); params.append(username)
                if new_password_hash:
                    parts.append("PasswordHash = ?"); params.append(new_password_hash)
                params.append(professor_id)
                cursor.execute(f"UPDATE dbo.Professors SET {', '.join(parts)} WHERE ProfessorID = ?", params)
            if course_name:
                cursor.execute("UPDATE dbo.Courses SET CourseName = ? WHERE CourseID = ?", [course_name, course_id])
            conn.commit()
        row = fetch_one(
            """
            SELECT p.ProfessorID, p.Username, p.FullName, p.CourseID, c.CourseName, c.CourseCode
            FROM dbo.Professors p
            INNER JOIN dbo.Courses c ON c.CourseID = p.CourseID
            WHERE p.ProfessorID = ?;
            """,
            (professor_id,),
        )
        return {
            "professor_id": row["ProfessorID"],
            "username": row["Username"],
            "full_name": row["FullName"],
            "course_id": row["CourseID"],
            "course_name": row["CourseName"],
            "course_code": row["CourseCode"],
        }

    @staticmethod
    def healthcheck() -> Dict[str, Any]:
        row = fetch_one("SELECT DB_NAME() AS DbName, SYSUTCDATETIME() AS UtcNow;")
        return row or {"DbName": "unknown", "UtcNow": None}

    @staticmethod
    def list_courses() -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT CourseID, CourseCode, CourseName, ScheduledStartTime, LateGraceMinutes,
                   MaxAllowedAbsentHours, IsActive
            FROM dbo.Courses
            WHERE IsActive = 1
            ORDER BY CourseCode;
            """
        )

    @staticmethod
    def create_student_and_enroll(payload: Dict[str, Any]) -> Dict[str, Any]:
        full_name = payload["full_name"]
        full_name_kurdish = payload.get("full_name_kurdish")
        email = payload["email"]
        profile_photo_url = payload.get("profile_photo_url")
        course_id = payload["course_id"]
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

    @staticmethod
    def upsert_face_embedding(
        student_id: int, model_name: str, embedding_data: bytes, pose_label: str = "front",
    ) -> None:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE dbo.StudentFaceEmbeddings
                SET IsPrimary = 0
                WHERE StudentID = ? AND ModelName = ? AND PoseLabel = ?;
                """,
                (student_id, model_name, pose_label),
            )

            cursor.execute(
                """
                INSERT INTO dbo.StudentFaceEmbeddings (StudentID, ModelName, EmbeddingData, IsPrimary, PoseLabel)
                VALUES (?, ?, ?, 1, ?);
                """,
                (student_id, model_name, embedding_data, pose_label),
            )

            conn.commit()

    @staticmethod
    def list_known_embeddings(course_id: int, model_name: str) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT
                s.StudentID,
                s.FullName,
                sfe.ModelName,
                sfe.EmbeddingData,
                sfe.PoseLabel
            FROM dbo.Enrollments e
            INNER JOIN dbo.Students s
                ON s.StudentID = e.StudentID
            INNER JOIN dbo.StudentFaceEmbeddings sfe
                ON sfe.StudentID = s.StudentID
               AND sfe.ModelName = ?
               AND sfe.IsPrimary = 1
            WHERE e.CourseID = ?
              AND s.IsActive = 1;
            """,
            (model_name, course_id),
        )

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

    @staticmethod
    def get_student_enrollment_status(student_id: int) -> str:
        row = fetch_one(
            "SELECT EnrollmentStatus FROM dbo.Students WHERE StudentID = ?;",
            (student_id,),
        )
        return str(row["EnrollmentStatus"]) if row else "pending"

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

    @staticmethod
    def get_gradebook(course_id: int) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT *
            FROM dbo.vw_Gradebook
            WHERE CourseID = ?
            ORDER BY FullName;
            """,
            (course_id,),
        )

    @staticmethod
    def get_gradebook_for_students(course_id: int, student_ids: Sequence[int]) -> List[Dict[str, Any]]:
        if not student_ids:
            return []
        placeholders = ",".join("?" for _ in student_ids)
        return fetch_all(
            f"""
            SELECT *
            FROM dbo.vw_Gradebook
            WHERE CourseID = ? AND StudentID IN ({placeholders})
            ORDER BY FullName;
            """,
            (course_id, *student_ids),
        )

    @staticmethod
    def update_student_grades(course_id: int, student_id: int, grades: Dict[str, Any]) -> Dict[str, Any]:
        hours_absent = grades.get("hours_absent_total")
        if hours_absent is not None:
            execute(
                """
                UPDATE dbo.Enrollments
                SET
                    Quiz1 = ?,
                    Quiz2 = ?,
                    ProjectGrade = ?,
                    AssignmentGrade = ?,
                    MidtermGrade = ?,
                    FinalExamGrade = ?,
                    HoursAbsentTotal = ?,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE CourseID = ? AND StudentID = ?;
                """,
                (
                    grades["quiz1"],
                    grades["quiz2"],
                    grades["project"],
                    grades["assignment"],
                    grades["midterm"],
                    grades["final_exam"],
                    max(0.0, float(hours_absent)),
                    course_id,
                    student_id,
                ),
            )
        else:
            execute(
                """
                UPDATE dbo.Enrollments
                SET
                    Quiz1 = ?,
                    Quiz2 = ?,
                    ProjectGrade = ?,
                    AssignmentGrade = ?,
                    MidtermGrade = ?,
                    FinalExamGrade = ?,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE CourseID = ? AND StudentID = ?;
                """,
                (
                    grades["quiz1"],
                    grades["quiz2"],
                    grades["project"],
                    grades["assignment"],
                    grades["midterm"],
                    grades["final_exam"],
                    course_id,
                    student_id,
                ),
            )

        row = fetch_one(
            """
            SELECT *
            FROM dbo.vw_Gradebook
            WHERE CourseID = ? AND StudentID = ?;
            """,
            (course_id, student_id),
        )
        if not row:
            raise ValueError("Enrollment was not found for grade update.")

        return row

    @staticmethod
    def start_session(course_id: int, started_at: Optional[datetime]) -> Dict[str, Any]:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                DECLARE @SessionID UNIQUEIDENTIFIER;
                EXEC dbo.sp_StartSession @CourseID=?, @StartedAt=?, @SessionID=@SessionID OUTPUT;
                SELECT
                    CAST(cs.SessionID AS NVARCHAR(36)) AS SessionID,
                    cs.StartedAt
                FROM dbo.ClassSessions cs
                WHERE cs.SessionID = @SessionID;
                """,
                (course_id, started_at),
            )
            row = cursor.fetchone()
            conn.commit()

        started_value = row[1]
        return {
            "session_id": row[0],
            "course_id": course_id,
            "started_at": started_value.isoformat() if started_value else None,
        }

    @staticmethod
    def get_session(session_id: str) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT TOP 1
                SessionID,
                CourseID,
                StartedAt,
                EndedAt,
                Status
            FROM dbo.ClassSessions
            WHERE SessionID = ?;
            """,
            (session_id,),
        )

    @staticmethod
    def add_recognition_event(
        session_id: str,
        student_id: Optional[int],
        confidence: Optional[float],
        engine_mode: str,
        notes: Optional[str] = None,
        recognized_at: Optional[datetime] = None,
    ) -> None:
        execute(
            """
            INSERT INTO dbo.SessionRecognitions (SessionID, StudentID, RecognizedAt, Confidence, EngineMode, Notes)
            VALUES (?, ?, ISNULL(?, SYSUTCDATETIME()), ?, ?, ?);
            """,
            (session_id, student_id, recognized_at, confidence, engine_mode, notes),
        )

    @staticmethod
    def upsert_attendance_from_recognition(session_id: str, student_id: int, recognized_at: datetime) -> None:
        execute(
            """
            EXEC dbo.sp_UpsertAttendanceOnRecognition
                @SessionID=?,
                @StudentID=?,
                @RecognizedAt=?;
            """,
            (session_id, student_id, recognized_at),
        )

    @staticmethod
    def get_session_attendance(session_id: str) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT
                s.StudentID,
                s.StudentCode,
                s.FullName,
                sa.FirstSeenAt,
                sa.LastSeenAt,
                sa.IsPresent
            FROM dbo.ClassSessions cs
            INNER JOIN dbo.Enrollments e
                ON e.CourseID = cs.CourseID
            INNER JOIN dbo.Students s
                ON s.StudentID = e.StudentID
            LEFT JOIN dbo.SessionAttendance sa
                ON sa.SessionID = cs.SessionID
               AND sa.StudentID = s.StudentID
            WHERE cs.SessionID = ?
            ORDER BY s.FullName;
            """,
            (session_id,),
        )

    @staticmethod
    def set_manual_attendance(
        session_id: str,
        student_id: int,
        is_present: bool,
        marked_at: Optional[datetime],
    ) -> Dict[str, Any]:
        session = Repository.get_session(session_id)
        if not session:
            raise ValueError("Session not found.")

        course_id = int(session["CourseID"])
        exists = fetch_one(
            """
            SELECT TOP 1 1 AS IsEnrolled
            FROM dbo.Enrollments
            WHERE CourseID = ? AND StudentID = ?;
            """,
            (course_id, student_id),
        )
        if not exists:
            raise ValueError("Student is not enrolled in this session course.")

        started_at = session["StartedAt"]
        if not isinstance(started_at, datetime):
            raise ValueError("Session start time is invalid.")

        now_value = marked_at or datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

        # Apply the same per-hour grace logic as face recognition.
        course_row = fetch_one(
            "SELECT LateGraceMinutes FROM dbo.Courses WHERE CourseID = ?;",
            (course_id,),
        )
        grace = int(course_row["LateGraceMinutes"]) if course_row else 10
        elapsed_seconds = (now_value - started_at).total_seconds()
        if elapsed_seconds < 0:
            elapsed_seconds = 0
        minutes_into_hour = (elapsed_seconds % 3600) / 60
        within_grace = minutes_into_hour <= grace
        is_present_int = 1 if within_grace else 0
        is_late_int = 0 if within_grace else 1
        delay_minutes = int(elapsed_seconds // 60)

        with get_connection() as conn:
            cursor = conn.cursor()

            if is_present:
                cursor.execute(
                    """
                    MERGE dbo.SessionAttendance AS target
                    USING (SELECT ? AS SessionID, ? AS StudentID) AS src
                    ON target.SessionID = src.SessionID AND target.StudentID = src.StudentID
                    WHEN MATCHED THEN
                        UPDATE SET
                            FirstSeenAt = CASE
                                WHEN target.FirstSeenAt IS NULL THEN ?
                                WHEN ? < target.FirstSeenAt THEN ?
                                ELSE target.FirstSeenAt
                            END,
                            LastSeenAt = CASE
                                WHEN target.LastSeenAt IS NULL THEN ?
                                WHEN ? > target.LastSeenAt THEN ?
                                ELSE target.LastSeenAt
                            END,
                            IsPresent = CASE
                                WHEN target.IsPresent = 1 THEN 1
                                ELSE ?
                            END,
                            IsLate = CASE
                                WHEN target.IsPresent = 1 THEN target.IsLate
                                ELSE ?
                            END,
                            ArrivalDelayMinutes = CASE
                                WHEN target.FirstSeenAt IS NULL THEN ?
                                ELSE target.ArrivalDelayMinutes
                            END
                    WHEN NOT MATCHED THEN
                        INSERT (SessionID, StudentID, FirstSeenAt, LastSeenAt, IsPresent, IsLate, ArrivalDelayMinutes)
                        VALUES (?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        session_id, student_id,
                        now_value, now_value, now_value,
                        now_value, now_value, now_value,
                        is_present_int,
                        is_late_int,
                        delay_minutes,
                        session_id, student_id, now_value, now_value,
                        is_present_int, is_late_int, delay_minutes,
                    ),
                )
            else:
                cursor.execute(
                    """
                    MERGE dbo.SessionAttendance AS target
                    USING (SELECT ? AS SessionID, ? AS StudentID) AS src
                    ON target.SessionID = src.SessionID AND target.StudentID = src.StudentID
                    WHEN MATCHED THEN
                        UPDATE SET
                            FirstSeenAt = NULL,
                            LastSeenAt = NULL,
                            IsPresent = 0,
                            IsLate = 0,
                            ArrivalDelayMinutes = NULL
                    WHEN NOT MATCHED THEN
                        INSERT (SessionID, StudentID, FirstSeenAt, LastSeenAt, IsPresent, IsLate, ArrivalDelayMinutes)
                        VALUES (?, ?, NULL, NULL, 0, 0, NULL);
                    """,
                    (session_id, student_id, session_id, student_id),
                )

            conn.commit()

        row = fetch_one(
            """
            SELECT
                s.StudentID,
                s.StudentCode,
                s.FullName,
                sa.FirstSeenAt,
                sa.LastSeenAt,
                sa.IsPresent
            FROM dbo.SessionAttendance sa
            INNER JOIN dbo.Students s
                ON s.StudentID = sa.StudentID
            WHERE sa.SessionID = ? AND sa.StudentID = ?;
            """,
            (session_id, student_id),
        )
        if not row:
            raise ValueError("Attendance row could not be updated.")

        return row

    @staticmethod
    def get_attendance_row(session_id: str, student_id: int) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT TOP 1
                IsPresent,
                FirstSeenAt,
                LastSeenAt
            FROM dbo.SessionAttendance
            WHERE SessionID = ? AND StudentID = ?;
            """,
            (session_id, student_id),
        )

    @staticmethod
    def finalize_session(session_id: str) -> None:
        execute("EXEC dbo.sp_FinalizeSession @SessionID=?;", (session_id,))

    @staticmethod
    def get_absentees_for_session(session_id: str) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT
                s.StudentID,
                s.FullName,
                s.Email,
                g.CourseCode,
                g.CourseName,
                g.Quiz1,
                g.Quiz2,
                g.ProjectGrade,
                g.AssignmentGrade,
                g.MidtermGrade,
                g.FinalExamGrade,
                g.HoursAbsentTotal,
                g.AttendancePenalty,
                g.RawTotal,
                g.AdjustedTotal,
                g.AtRiskByPolicy
            FROM dbo.ClassSessions cs
            INNER JOIN dbo.vw_Gradebook g
                ON g.CourseID = cs.CourseID
            INNER JOIN dbo.Students s
                ON s.StudentID = g.StudentID
            LEFT JOIN dbo.SessionAttendance sa
                ON sa.SessionID = cs.SessionID
               AND sa.StudentID = s.StudentID
            WHERE cs.SessionID = ?
              AND ISNULL(sa.IsPresent, 0) = 0
            ORDER BY s.FullName;
            """,
            (session_id,),
        )

    @staticmethod
    def get_absent_and_late_for_session(session_id: str) -> List[Dict[str, Any]]:
        """Return absent + late students for session-end notification.

        Each row includes:
          SessionAbsentHours  – weight accrued in this session (1.0 absent, 0.5 late)
          SessionPenalty      – grade points deducted this session
          IsLate              – 1 if late, 0 if fully absent
          HoursAbsentTotal    – cumulative total
          AttendancePenalty   – cumulative penalty
          AtRiskByPolicy      – 1 if now at-risk or dropped
        """
        return fetch_all(
            """
            SELECT
                s.StudentID,
                s.FullName,
                s.Email,
                g.CourseCode,
                g.CourseName,
                g.HoursAbsentTotal,
                g.AttendancePenalty,
                g.AtRiskByPolicy,
                ISNULL(sa.IsLate, 0) AS IsLate,
                CASE
                    WHEN ISNULL(sa.IsPresent, 0) = 0 THEN 1.0
                    WHEN ISNULL(sa.IsLate,    0) = 1 THEN 0.5
                    ELSE 0.0
                END AS SessionAbsentHours,
                CASE
                    WHEN ISNULL(sa.IsPresent, 0) = 0 THEN 0.5
                    WHEN ISNULL(sa.IsLate,    0) = 1 THEN 0.25
                    ELSE 0.0
                END AS SessionPenalty
            FROM dbo.ClassSessions cs
            INNER JOIN dbo.vw_Gradebook g
                ON g.CourseID = cs.CourseID
            INNER JOIN dbo.Students s
                ON s.StudentID = g.StudentID
            LEFT JOIN dbo.SessionAttendance sa
                ON sa.SessionID = cs.SessionID
               AND sa.StudentID = s.StudentID
            WHERE cs.SessionID = ?
              AND (ISNULL(sa.IsPresent, 0) = 0 OR ISNULL(sa.IsLate, 0) = 1)
            ORDER BY s.FullName;
            """,
            (session_id,),
        )


    @staticmethod
    def list_sessions_with_summary(course_id: int) -> List[Dict[str, Any]]:
        """Return all sessions for a course with attendance summary and absentee list."""
        sessions = fetch_all(
            """
            SELECT
                CAST(cs.SessionID AS NVARCHAR(36)) AS SessionID,
                c.CourseName,
                cs.StartedAt,
                cs.EndedAt,
                cs.Status,
                COUNT(e.StudentID) AS TotalEnrolled,
                SUM(CASE WHEN ISNULL(sa.IsPresent, 0) = 1 THEN 1 ELSE 0 END) AS PresentCount
            FROM dbo.ClassSessions cs
            INNER JOIN dbo.Courses c ON c.CourseID = cs.CourseID
            LEFT JOIN dbo.Enrollments e ON e.CourseID = cs.CourseID
            LEFT JOIN dbo.SessionAttendance sa
                ON sa.SessionID = cs.SessionID
               AND sa.StudentID = e.StudentID
            WHERE cs.CourseID = ?
            GROUP BY cs.SessionID, c.CourseName, cs.StartedAt, cs.EndedAt, cs.Status
            ORDER BY cs.StartedAt DESC;
            """,
            (course_id,),
        )

        result = []
        for row in sessions:
            session_id = row["SessionID"]
            total = int(row["TotalEnrolled"] or 0)
            present = int(row["PresentCount"] or 0)

            # Fetch absentees for this session
            absentees_rows = fetch_all(
                """
                SELECT s.StudentID, s.FullName
                FROM dbo.Enrollments e
                INNER JOIN dbo.Students s ON s.StudentID = e.StudentID
                LEFT JOIN dbo.SessionAttendance sa
                    ON sa.SessionID = ? AND sa.StudentID = e.StudentID
                WHERE e.CourseID = ?
                  AND ISNULL(sa.IsPresent, 0) = 0
                ORDER BY s.FullName;
                """,
                (session_id, course_id),
            )

            started = row["StartedAt"]
            ended = row["EndedAt"]
            status = str(row["Status"] or "unknown").lower()
            if ended is not None:
                status = "finalized"

            result.append({
                "session_id": session_id,
                "course_name": row["CourseName"],
                "started_at": started.isoformat() if started else None,
                "ended_at": ended.isoformat() if ended else None,
                "status": status,
                "total_enrolled": total,
                "present_count": present,
                "absent_count": total - present,
                "absentees": [
                    {"student_id": r["StudentID"], "full_name": r["FullName"]}
                    for r in absentees_rows
                ],
            })

        return result

    # ── Export / Import helpers ──────────────────────────────────────────────

    @staticmethod
    def export_sessions(course_id: int) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT CAST(SessionID AS NVARCHAR(36)) AS SessionID,
                   StartedAt, EndedAt, Status
            FROM dbo.ClassSessions
            WHERE CourseID = ?
            ORDER BY StartedAt;
            """,
            (course_id,),
        )

    @staticmethod
    def export_session_attendance(course_id: int) -> List[Dict[str, Any]]:
        return fetch_all(
            """
            SELECT CAST(sa.SessionID AS NVARCHAR(36)) AS SessionID,
                   sa.StudentID,
                   s.FullName,
                   sa.IsPresent,
                   sa.FirstSeenAt,
                   sa.LastSeenAt
            FROM dbo.SessionAttendance sa
            JOIN dbo.ClassSessions cs ON cs.SessionID = sa.SessionID
            JOIN dbo.Students s ON s.StudentID = sa.StudentID
            WHERE cs.CourseID = ?
            ORDER BY sa.SessionID, s.FullName;
            """,
            (course_id,),
        )

    @staticmethod
    def bulk_restore_sessions(course_id: int, sessions: List[Dict[str, Any]]) -> int:
        count = 0
        with get_connection() as conn:
            cursor = conn.cursor()
            for s in sessions:
                sid = s.get("SessionID", "").strip()
                if not sid:
                    continue
                started = s.get("StartedAt") or None
                ended = s.get("EndedAt") or None
                status = s.get("Status") or "finalized"
                cursor.execute(
                    """
                    IF NOT EXISTS (SELECT 1 FROM dbo.ClassSessions WHERE SessionID = ?)
                    BEGIN
                        INSERT INTO dbo.ClassSessions (SessionID, CourseID, StartedAt, EndedAt, Status)
                        VALUES (?, ?, ?, ?, ?);
                        INSERT INTO dbo.SessionAttendance (SessionID, StudentID, IsPresent)
                            SELECT ?, StudentID, 0 FROM dbo.Enrollments WHERE CourseID = ?;
                    END
                    """,
                    (sid, sid, course_id, started, ended, status, sid, course_id),
                )
                count += 1
            conn.commit()
        return count

    @staticmethod
    def bulk_restore_attendance(records: List[Dict[str, Any]]) -> int:
        count = 0
        with get_connection() as conn:
            cursor = conn.cursor()
            for r in records:
                sid = r.get("SessionID", "").strip()
                student_id = r.get("StudentID", "")
                if not sid or not student_id:
                    continue
                is_present = 1 if str(r.get("IsPresent", "0")).strip().lower() in ("1", "true", "yes") else 0
                first_seen = r.get("FirstSeenAt") or None
                last_seen = r.get("LastSeenAt") or None
                cursor.execute(
                    """
                    UPDATE dbo.SessionAttendance
                    SET IsPresent=?, FirstSeenAt=?, LastSeenAt=?
                    WHERE SessionID=? AND StudentID=?;
                    """,
                    (is_present, first_seen, last_seen, sid, int(student_id)),
                )
                count += cursor.rowcount
            conn.commit()
        return count

    @staticmethod
    def reset_course_data(course_id: int) -> None:
        """Null out grades, zero absences, and delete all session history for a course."""
        with get_connection() as conn:
            cursor = conn.cursor()
            # 1. NULL grade columns, zero absence hours for every enrolled student
            cursor.execute(
                """
                UPDATE dbo.Enrollments
                SET Quiz1 = NULL, Quiz2 = NULL, ProjectGrade = NULL,
                    AssignmentGrade = NULL, MidtermGrade = NULL, FinalExamGrade = NULL,
                    HoursAbsentTotal = 0, UpdatedAt = SYSUTCDATETIME()
                WHERE CourseID = ?;
                """,
                (course_id,),
            )
            # 2. Collect session IDs for this course
            cursor.execute(
                "SELECT SessionID FROM dbo.ClassSessions WHERE CourseID = ?;",
                (course_id,),
            )
            session_ids = [str(row[0]) for row in cursor.fetchall()]
            # 3. Delete child rows then sessions
            for sid in session_ids:
                cursor.execute("DELETE FROM dbo.EmailDispatchLog WHERE SessionID = ?;", (sid,))
                cursor.execute("DELETE FROM dbo.SessionHourLog WHERE SessionID = ?;", (sid,))
                cursor.execute("DELETE FROM dbo.SessionRecognitions WHERE SessionID = ?;", (sid,))
                cursor.execute("DELETE FROM dbo.SessionAttendance WHERE SessionID = ?;", (sid,))
                cursor.execute("DELETE FROM dbo.ClassSessions WHERE SessionID = ?;", (sid,))
            conn.commit()

    # ── WebAuthn credential storage ──────────────────────────────────────────

    @staticmethod
    def ensure_webauthn_table() -> None:
        """Create WebAuthnCredentials table if it doesn't exist."""
        execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WebAuthnCredentials')
            CREATE TABLE dbo.WebAuthnCredentials (
                CredentialID   NVARCHAR(512)  NOT NULL PRIMARY KEY,
                ProfessorID    INT            NOT NULL,
                PublicKey      VARBINARY(MAX) NOT NULL,
                SignCount      INT            NOT NULL DEFAULT 0,
                DeviceName     NVARCHAR(100)  NULL,
                CreatedAt      DATETIME2(0)   NOT NULL DEFAULT SYSUTCDATETIME()
            );
        """)

    @staticmethod
    def list_webauthn_credentials(professor_id: int) -> List[Dict[str, Any]]:
        return fetch_all(
            "SELECT CredentialID, DeviceName, CreatedAt FROM dbo.WebAuthnCredentials WHERE ProfessorID = ? ORDER BY CreatedAt;",
            (professor_id,),
        )

    @staticmethod
    def get_webauthn_credentials_for_professor(professor_id: int) -> List[Dict[str, Any]]:
        return fetch_all(
            "SELECT CredentialID, PublicKey, SignCount FROM dbo.WebAuthnCredentials WHERE ProfessorID = ?;",
            (professor_id,),
        )

    @staticmethod
    def get_professor_by_id(professor_id: int) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT p.ProfessorID, p.Username, p.FullName, p.CourseID,
                   c.CourseName, c.CourseCode
            FROM dbo.Professors p
            JOIN dbo.Courses c ON c.CourseID = p.CourseID
            WHERE p.ProfessorID = ? AND p.IsActive = 1;
            """,
            (professor_id,),
        )

    @staticmethod
    def get_professor_by_username(username: str) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT p.ProfessorID, p.Username, p.FullName, p.CourseID,
                   p.PasswordHash, c.CourseName, c.CourseCode
            FROM dbo.Professors p
            JOIN dbo.Courses c ON c.CourseID = p.CourseID
            WHERE p.Username = ? AND p.IsActive = 1;
            """,
            (username,),
        )

    @staticmethod
    def get_webauthn_credential_by_id(credential_id: str) -> Optional[Dict[str, Any]]:
        return fetch_one(
            "SELECT CredentialID, ProfessorID, PublicKey, SignCount FROM dbo.WebAuthnCredentials WHERE CredentialID = ?;",
            (credential_id,),
        )

    @staticmethod
    def save_webauthn_credential(professor_id: int, credential_id: str, public_key: bytes, sign_count: int, device_name: str) -> None:
        execute(
            "INSERT INTO dbo.WebAuthnCredentials (CredentialID, ProfessorID, PublicKey, SignCount, DeviceName) VALUES (?, ?, ?, ?, ?);",
            (credential_id, professor_id, public_key, sign_count, device_name),
        )

    @staticmethod
    def update_webauthn_sign_count(credential_id: str, new_sign_count: int) -> None:
        execute(
            "UPDATE dbo.WebAuthnCredentials SET SignCount = ? WHERE CredentialID = ?;",
            (new_sign_count, credential_id),
        )

    @staticmethod
    def delete_webauthn_credential(credential_id: str, professor_id: int) -> bool:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM dbo.WebAuthnCredentials WHERE CredentialID = ? AND ProfessorID = ?;",
                (credential_id, professor_id),
            )
            deleted = cursor.rowcount > 0
            conn.commit()
        return deleted

    def insert_email_log(
        session_id: str,
        student_id: int,
        recipient_email: str,
        subject_line: str,
        status: str,
        error_message: Optional[str],
    ) -> None:

        execute(
            """
            INSERT INTO dbo.EmailDispatchLog
                (SessionID, StudentID, RecipientEmail, SubjectLine, Status, ErrorMessage)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (session_id, student_id, recipient_email, subject_line, status, error_message),
        )
