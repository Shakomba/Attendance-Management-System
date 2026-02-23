from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .database import execute, fetch_all, fetch_one, get_connection


class Repository:
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
        student_code = payload["student_code"]
        full_name = payload["full_name"]
        email = payload["email"]
        profile_photo_url = payload.get("profile_photo_url")
        course_id = payload["course_id"]

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
                INSERT INTO dbo.Students (StudentCode, FullName, Email, ProfilePhotoUrl)
                OUTPUT INSERTED.StudentID
                VALUES (?, ?, ?, ?);
                """,
                (student_code, full_name, email, profile_photo_url),
            )
            student_id = cursor.fetchone()[0]

            cursor.execute(
                """
                INSERT INTO dbo.Enrollments
                    (StudentID, CourseID, Quiz1, Quiz2, ProjectGrade, AssignmentGrade, MidtermGrade, FinalExamGrade)
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
    def upsert_face_embedding(student_id: int, model_name: str, embedding_data: bytes) -> None:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE dbo.StudentFaceEmbeddings
                SET IsPrimary = 0
                WHERE StudentID = ? AND ModelName = ?;
                """,
                (student_id, model_name),
            )

            cursor.execute(
                """
                INSERT INTO dbo.StudentFaceEmbeddings (StudentID, ModelName, EmbeddingData, IsPrimary)
                VALUES (?, ?, ?, 1);
                """,
                (student_id, model_name, embedding_data),
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
                sfe.EmbeddingData
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
                sa.IsPresent,
                sa.IsLate,
                sa.ArrivalDelayMinutes
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
    def get_attendance_row(session_id: str, student_id: int) -> Optional[Dict[str, Any]]:
        return fetch_one(
            """
            SELECT TOP 1
                IsPresent,
                IsLate,
                ArrivalDelayMinutes,
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
