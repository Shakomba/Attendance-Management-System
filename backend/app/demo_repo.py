from __future__ import annotations

from datetime import datetime
from math import ceil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4


class DemoRepository:
    def __init__(self) -> None:
        self._student_seq = 1

        self.courses: Dict[int, Dict[str, Any]] = {
            1: {
                "CourseID": 1,
                "CourseCode": "CS101",
                "CourseName": "Distributed AI Systems",
                "ScheduledStartTime": "09:00:00",
                "LateGraceMinutes": 10,
                "MaxAllowedAbsentHours": 8,
                "IsActive": 1,
            },
            2: {
                "CourseID": 2,
                "CourseCode": "CS102",
                "CourseName": "Applied Machine Vision",
                "ScheduledStartTime": "13:00:00",
                "LateGraceMinutes": 10,
                "MaxAllowedAbsentHours": 8,
                "IsActive": 1,
            },
        }

        self.students: Dict[int, Dict[str, Any]] = {}
        self.enrollments: Dict[Tuple[int, int], Dict[str, Any]] = {}
        self.embeddings: List[Dict[str, Any]] = []

        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.recognitions: List[Dict[str, Any]] = []
        self.session_attendance: Dict[Tuple[str, int], Dict[str, Any]] = {}
        self.session_hour_log: Dict[Tuple[str, int, int], Dict[str, Any]] = {}

        self.email_logs: List[Dict[str, Any]] = []
        self._seed_demo_data()

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.utcnow().replace(microsecond=0)

    def _seed_demo_data(self) -> None:
        self.create_student_and_enroll(
            {
                "student_code": "S001",
                "full_name": "Amina Noor",
                "email": "amina.noor@example.com",
                "course_id": 1,
                "grades": {
                    "quiz1": 8.5,
                    "quiz2": 9.0,
                    "project": 18.0,
                    "assignment": 17.5,
                    "midterm": 16.0,
                    "final_exam": 20.0,
                },
            }
        )
        self.create_student_and_enroll(
            {
                "student_code": "S002",
                "full_name": "Leo Carter",
                "email": "leo.carter@example.com",
                "course_id": 1,
                "grades": {
                    "quiz1": 7.0,
                    "quiz2": 7.5,
                    "project": 15.0,
                    "assignment": 14.5,
                    "midterm": 13.0,
                    "final_exam": 16.0,
                },
            }
        )
        self.create_student_and_enroll(
            {
                "student_code": "S003",
                "full_name": "Redeen Sirwan",
                "email": "redeen.sirwan@example.com",
                "course_id": 1,
                "grades": {
                    "quiz1": 9.0,
                    "quiz2": 8.5,
                    "project": 19.0,
                    "assignment": 18.0,
                    "midterm": 17.5,
                    "final_exam": 19.0,
                },
            }
        )

    def _find_student_by_code(self, student_code: str) -> Optional[Dict[str, Any]]:
        target = student_code.strip().upper()
        for student in self.students.values():
            if str(student.get("StudentCode", "")).strip().upper() == target:
                return student
        return None

    def bootstrap_embeddings_from_folder(self, face_engine: Any, folder: Optional[str] = None) -> Dict[str, int]:
        root = Path(__file__).resolve().parents[2]
        photos_dir = Path(folder) if folder else (root / "student_photos")

        stats = {
            "files_seen": 0,
            "students_matched": 0,
            "embeddings_created": 0,
            "already_present": 0,
            "no_face_in_photo": 0,
            "decode_failed": 0,
        }

        if not photos_dir.exists() or not photos_dir.is_dir():
            return stats

        image_files = sorted(
            [
                p
                for p in photos_dir.iterdir()
                if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
            ]
        )

        for image_path in image_files:
            stats["files_seen"] += 1
            student_code = image_path.stem
            student = self._find_student_by_code(student_code)
            if not student:
                continue

            stats["students_matched"] += 1
            student_id = int(student["StudentID"])
            model_name = str(face_engine.model_name)

            exists = any(
                emb["StudentID"] == student_id and emb["ModelName"] == model_name and emb.get("IsPrimary") == 1
                for emb in self.embeddings
            )
            if exists:
                stats["already_present"] += 1
                continue

            raw = image_path.read_bytes()
            frame = face_engine.decode_image_bytes(raw)
            if frame is None:
                stats["decode_failed"] += 1
                continue

            embedding = face_engine.extract_embedding(frame)
            if embedding is None:
                stats["no_face_in_photo"] += 1
                continue

            self.upsert_face_embedding(student_id, model_name, face_engine.embedding_to_bytes(embedding))
            stats["embeddings_created"] += 1

        return stats

    @staticmethod
    def _compute_metrics(enrollment: Dict[str, Any], max_absent: int) -> Dict[str, Any]:
        raw_total = (
            float(enrollment["Quiz1"])
            + float(enrollment["Quiz2"])
            + float(enrollment["ProjectGrade"])
            + float(enrollment["AssignmentGrade"])
            + float(enrollment["MidtermGrade"])
            + float(enrollment["FinalExamGrade"])
        )
        penalty = float(enrollment["HoursAbsentTotal"]) * 0.25
        adjusted = max(0.0, raw_total - penalty)
        at_risk = adjusted < 60 or float(enrollment["HoursAbsentTotal"]) >= 8
        at_risk_policy = adjusted < 60 or float(enrollment["HoursAbsentTotal"]) >= max_absent
        return {
            "RawTotal": round(raw_total, 2),
            "AttendancePenalty": round(penalty, 2),
            "AdjustedTotal": round(adjusted, 2),
            "AtRisk": bool(at_risk),
            "AtRiskByPolicy": bool(at_risk_policy),
        }

    def healthcheck(self) -> Dict[str, Any]:
        return {"DbName": "DEMO_MODE", "UtcNow": self._utcnow()}

    def list_courses(self) -> List[Dict[str, Any]]:
        return [self.courses[k] for k in sorted(self.courses.keys()) if self.courses[k]["IsActive"] == 1]

    def create_student_and_enroll(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        student_id = self._student_seq
        self._student_seq += 1

        course_id = int(payload["course_id"])
        grades = payload.get("grades", {})

        self.students[student_id] = {
            "StudentID": student_id,
            "StudentCode": payload["student_code"],
            "FullName": payload["full_name"],
            "Email": payload["email"],
            "ProfilePhotoUrl": payload.get("profile_photo_url"),
            "IsActive": 1,
            "CreatedAt": self._utcnow(),
        }

        self.enrollments[(student_id, course_id)] = {
            "StudentID": student_id,
            "CourseID": course_id,
            "Quiz1": float(grades.get("quiz1", 0)),
            "Quiz2": float(grades.get("quiz2", 0)),
            "ProjectGrade": float(grades.get("project", 0)),
            "AssignmentGrade": float(grades.get("assignment", 0)),
            "MidtermGrade": float(grades.get("midterm", 0)),
            "FinalExamGrade": float(grades.get("final_exam", 0)),
            "HoursAbsentTotal": 0.0,
            "UpdatedAt": self._utcnow(),
        }

        return {"student_id": student_id, "course_id": course_id}

    def upsert_face_embedding(self, student_id: int, model_name: str, embedding_data: bytes) -> None:
        for emb in self.embeddings:
            if emb["StudentID"] == student_id and emb["ModelName"] == model_name:
                emb["IsPrimary"] = 0

        self.embeddings.append(
            {
                "StudentID": student_id,
                "ModelName": model_name,
                "EmbeddingData": embedding_data,
                "IsPrimary": 1,
                "CreatedAt": self._utcnow(),
            }
        )

    def list_known_embeddings(self, course_id: int, model_name: str) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        enrolled_ids = [sid for (sid, cid) in self.enrollments.keys() if cid == course_id]

        for emb in self.embeddings:
            if emb["ModelName"] != model_name or emb.get("IsPrimary") != 1:
                continue
            sid = int(emb["StudentID"])
            if sid not in enrolled_ids:
                continue

            student = self.students.get(sid)
            if not student:
                continue

            items.append(
                {
                    "StudentID": sid,
                    "FullName": student["FullName"],
                    "ModelName": model_name,
                    "EmbeddingData": emb["EmbeddingData"],
                }
            )

        return items

    def get_gradebook(self, course_id: int) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        course = self.courses.get(course_id)
        if not course:
            return rows

        for (student_id, cid), enrollment in self.enrollments.items():
            if cid != course_id:
                continue

            student = self.students.get(student_id)
            if not student:
                continue

            metrics = self._compute_metrics(enrollment, int(course["MaxAllowedAbsentHours"]))
            rows.append(
                {
                    "CourseID": course_id,
                    "CourseCode": course["CourseCode"],
                    "CourseName": course["CourseName"],
                    "StudentID": student_id,
                    "StudentCode": student["StudentCode"],
                    "FullName": student["FullName"],
                    "Email": student["Email"],
                    "Quiz1": enrollment["Quiz1"],
                    "Quiz2": enrollment["Quiz2"],
                    "ProjectGrade": enrollment["ProjectGrade"],
                    "AssignmentGrade": enrollment["AssignmentGrade"],
                    "MidtermGrade": enrollment["MidtermGrade"],
                    "FinalExamGrade": enrollment["FinalExamGrade"],
                    "HoursAbsentTotal": enrollment["HoursAbsentTotal"],
                    "AttendancePenalty": metrics["AttendancePenalty"],
                    "RawTotal": metrics["RawTotal"],
                    "AdjustedTotal": metrics["AdjustedTotal"],
                    "AtRisk": metrics["AtRisk"],
                    "AtRiskByPolicy": metrics["AtRiskByPolicy"],
                    "UpdatedAt": enrollment["UpdatedAt"],
                }
            )

        rows.sort(key=lambda row: row["FullName"])
        return rows

    def start_session(self, course_id: int, started_at: Optional[datetime]) -> Dict[str, Any]:
        sid = str(uuid4())
        started = started_at or self._utcnow()

        self.sessions[sid] = {
            "SessionID": sid,
            "CourseID": course_id,
            "StartedAt": started,
            "EndedAt": None,
            "Status": "active",
        }

        return {
            "session_id": sid,
            "course_id": course_id,
            "started_at": started.isoformat(),
        }

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        s = self.sessions.get(session_id)
        if not s:
            return None
        return {
            "SessionID": s["SessionID"],
            "CourseID": s["CourseID"],
            "StartedAt": s["StartedAt"],
            "EndedAt": s["EndedAt"],
            "Status": s["Status"],
        }

    def add_recognition_event(
        self,
        session_id: str,
        student_id: Optional[int],
        confidence: Optional[float],
        engine_mode: str,
        notes: Optional[str] = None,
        recognized_at: Optional[datetime] = None,
    ) -> None:
        self.recognitions.append(
            {
                "SessionID": session_id,
                "StudentID": student_id,
                "RecognizedAt": recognized_at or self._utcnow(),
                "Confidence": confidence,
                "EngineMode": engine_mode,
                "Notes": notes,
            }
        )

    def upsert_attendance_from_recognition(self, session_id: str, student_id: int, recognized_at: datetime) -> None:
        session = self.sessions.get(session_id)
        if not session:
            return

        course = self.courses.get(int(session["CourseID"]))
        if not course:
            return

        delay = int((recognized_at - session["StartedAt"]).total_seconds() // 60)
        if delay < 0:
            delay = 0

        grace = int(course["LateGraceMinutes"])
        key = (session_id, student_id)
        existing = self.session_attendance.get(key)

        if not existing:
            self.session_attendance[key] = {
                "SessionID": session_id,
                "StudentID": student_id,
                "FirstSeenAt": recognized_at,
                "LastSeenAt": recognized_at,
                "IsPresent": 1,
                "IsLate": 1 if delay > grace else 0,
                "ArrivalDelayMinutes": delay,
            }
        else:
            existing["FirstSeenAt"] = min(existing["FirstSeenAt"], recognized_at)
            existing["LastSeenAt"] = max(existing["LastSeenAt"], recognized_at)
            existing["IsPresent"] = 1

        hour_index = delay // 60
        hour_key = (session_id, student_id, hour_index)
        self.session_hour_log[hour_key] = {
            "SessionID": session_id,
            "StudentID": student_id,
            "HourIndex": hour_index,
            "HourStart": session["StartedAt"],
            "IsPresent": 1,
            "Source": "recognizer",
        }

    def get_session_attendance(self, session_id: str) -> List[Dict[str, Any]]:
        session = self.sessions.get(session_id)
        if not session:
            return []

        course_id = int(session["CourseID"])
        rows: List[Dict[str, Any]] = []

        for (student_id, cid), _ in self.enrollments.items():
            if cid != course_id:
                continue

            student = self.students.get(student_id)
            if not student:
                continue

            attendance = self.session_attendance.get((session_id, student_id), {})
            rows.append(
                {
                    "StudentID": student_id,
                    "StudentCode": student["StudentCode"],
                    "FullName": student["FullName"],
                    "FirstSeenAt": attendance.get("FirstSeenAt"),
                    "LastSeenAt": attendance.get("LastSeenAt"),
                    "IsPresent": attendance.get("IsPresent", 0),
                    "IsLate": attendance.get("IsLate", 0),
                    "ArrivalDelayMinutes": attendance.get("ArrivalDelayMinutes"),
                }
            )

        rows.sort(key=lambda row: row["FullName"])
        return rows

    def get_attendance_row(self, session_id: str, student_id: int) -> Optional[Dict[str, Any]]:
        row = self.session_attendance.get((session_id, student_id))
        if not row:
            return None
        return {
            "IsPresent": row.get("IsPresent", 0),
            "IsLate": row.get("IsLate", 0),
            "ArrivalDelayMinutes": row.get("ArrivalDelayMinutes"),
            "FirstSeenAt": row.get("FirstSeenAt"),
            "LastSeenAt": row.get("LastSeenAt"),
        }

    def finalize_session(self, session_id: str) -> None:
        session = self.sessions.get(session_id)
        if not session:
            return

        if session["Status"] == "finalized":
            return

        end_at = session["EndedAt"] or self._utcnow()
        session["EndedAt"] = end_at
        session["Status"] = "finalized"

        start_at = session["StartedAt"]
        duration_minutes = int((end_at - start_at).total_seconds() // 60)
        if duration_minutes <= 0:
            duration_minutes = 1

        total_hours = max(1, ceil(duration_minutes / 60.0))
        course_id = int(session["CourseID"])

        enrolled_ids = [sid for (sid, cid) in self.enrollments.keys() if cid == course_id]

        for student_id in enrolled_ids:
            att_key = (session_id, student_id)
            if att_key not in self.session_attendance:
                self.session_attendance[att_key] = {
                    "SessionID": session_id,
                    "StudentID": student_id,
                    "FirstSeenAt": None,
                    "LastSeenAt": None,
                    "IsPresent": 0,
                    "IsLate": 0,
                    "ArrivalDelayMinutes": None,
                }

            for hour_index in range(total_hours):
                hour_key = (session_id, student_id, hour_index)
                if hour_key not in self.session_hour_log:
                    self.session_hour_log[hour_key] = {
                        "SessionID": session_id,
                        "StudentID": student_id,
                        "HourIndex": hour_index,
                        "HourStart": start_at,
                        "IsPresent": 0,
                        "Source": "system",
                    }

        for student_id in enrolled_ids:
            absent_hours = 0
            for hour_index in range(total_hours):
                hour_key = (session_id, student_id, hour_index)
                if self.session_hour_log[hour_key]["IsPresent"] == 0:
                    absent_hours += 1

            enr = self.enrollments.get((student_id, course_id))
            if enr:
                enr["HoursAbsentTotal"] = float(enr["HoursAbsentTotal"]) + float(absent_hours)
                enr["UpdatedAt"] = self._utcnow()

    def get_absentees_for_session(self, session_id: str) -> List[Dict[str, Any]]:
        session = self.sessions.get(session_id)
        if not session:
            return []

        course_id = int(session["CourseID"])
        course = self.courses.get(course_id)
        if not course:
            return []

        rows: List[Dict[str, Any]] = []

        for (student_id, cid), enrollment in self.enrollments.items():
            if cid != course_id:
                continue

            attendance = self.session_attendance.get((session_id, student_id))
            is_present = attendance.get("IsPresent", 0) if attendance else 0
            if is_present:
                continue

            student = self.students.get(student_id)
            if not student:
                continue

            metrics = self._compute_metrics(enrollment, int(course["MaxAllowedAbsentHours"]))
            rows.append(
                {
                    "StudentID": student_id,
                    "FullName": student["FullName"],
                    "Email": student["Email"],
                    "CourseCode": course["CourseCode"],
                    "CourseName": course["CourseName"],
                    "Quiz1": enrollment["Quiz1"],
                    "Quiz2": enrollment["Quiz2"],
                    "ProjectGrade": enrollment["ProjectGrade"],
                    "AssignmentGrade": enrollment["AssignmentGrade"],
                    "MidtermGrade": enrollment["MidtermGrade"],
                    "FinalExamGrade": enrollment["FinalExamGrade"],
                    "HoursAbsentTotal": enrollment["HoursAbsentTotal"],
                    "AttendancePenalty": metrics["AttendancePenalty"],
                    "RawTotal": metrics["RawTotal"],
                    "AdjustedTotal": metrics["AdjustedTotal"],
                    "AtRiskByPolicy": metrics["AtRiskByPolicy"],
                }
            )

        rows.sort(key=lambda row: row["FullName"])
        return rows

    def insert_email_log(
        self,
        session_id: str,
        student_id: int,
        recipient_email: str,
        subject_line: str,
        status: str,
        error_message: Optional[str],
    ) -> None:
        self.email_logs.append(
            {
                "SessionID": session_id,
                "StudentID": student_id,
                "RecipientEmail": recipient_email,
                "SubjectLine": subject_line,
                "Status": status,
                "ErrorMessage": error_message,
                "SentAt": self._utcnow(),
            }
        )
