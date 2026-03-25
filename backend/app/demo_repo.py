from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from math import ceil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

_DEFAULT_STATE_FILE = Path(__file__).resolve().parent.parent / "demo_data" / "state.json"


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


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
                "MaxAllowedAbsentHours": 4,
                "IsActive": 1,
            },
            2: {
                "CourseID": 2,
                "CourseCode": "CS102",
                "CourseName": "Applied Machine Vision",
                "ScheduledStartTime": "13:00:00",
                "LateGraceMinutes": 10,
                "MaxAllowedAbsentHours": 4,
                "IsActive": 1,
            },
        }

        self.professors: Dict[str, Dict[str, Any]] = {
            "dr.ahmed": {
                "ProfessorID": 1,
                "Username": "dr.ahmed",
                "PasswordHash": _hash_password("admin123"),
                "FullName": "Dr. Ahmed Hassan",
                "CourseID": 1,
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

        _env = os.environ.get("DEMO_STATE_FILE", "")
        self._state_file = Path(_env) if _env else _DEFAULT_STATE_FILE

        self._seed_demo_data()
        self._load_state()

    @staticmethod
    def _utcnow() -> datetime:
        """Return the current UTC time as a naive datetime (consistent with DB expectations)."""
        return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

    # ------------------------------------------------------------------ #
    #  Persistence helpers                                                 #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _enc(v: Any) -> Any:
        """Encode a value for JSON storage."""
        if isinstance(v, datetime):
            return {"_dt": v.isoformat()}
        return v

    @staticmethod
    def _dec(v: Any) -> Any:
        """Decode a value read from JSON storage."""
        if isinstance(v, dict) and list(v.keys()) == ["_dt"]:
            return datetime.fromisoformat(v["_dt"])
        if isinstance(v, dict):
            return {k: DemoRepository._dec(val) for k, val in v.items()}
        if isinstance(v, list):
            return [DemoRepository._dec(item) for item in v]
        return v

    def _save_state(self) -> None:
        """Write mutable in-memory state to disk (atomic rename)."""
        try:
            self._state_file.parent.mkdir(parents=True, exist_ok=True)

            def enc_row(d: Dict[str, Any]) -> Dict[str, Any]:
                return {k: self._enc(v) for k, v in d.items() if not isinstance(v, bytes)}

            state = {
                "_student_seq": self._student_seq,
                "students": {str(k): enc_row(v) for k, v in self.students.items()},
                "enrollments": {
                    f"{k[0]}|{k[1]}": enc_row(v) for k, v in self.enrollments.items()
                },
                "sessions": {k: enc_row(v) for k, v in self.sessions.items()},
                "session_attendance": {
                    f"{k[0]}|{k[1]}": enc_row(v)
                    for k, v in self.session_attendance.items()
                },
                "session_hour_log": {
                    f"{k[0]}|{k[1]}|{k[2]}": enc_row(v)
                    for k, v in self.session_hour_log.items()
                },
            }

            tmp = self._state_file.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f)
            tmp.rename(self._state_file)
        except Exception as exc:
            print(f"[demo_repo] State save failed: {exc}")

    def _load_state(self) -> None:
        """Restore mutable state from disk if a state file exists."""
        if not self._state_file.exists():
            return
        try:
            with open(self._state_file, encoding="utf-8") as f:
                state = json.load(f)

            d = self._dec  # shorthand

            if "_student_seq" in state:
                self._student_seq = int(state["_student_seq"])

            for str_id, student in state.get("students", {}).items():
                self.students[int(str_id)] = d(student)

            for key_str, enr in state.get("enrollments", {}).items():
                sid_s, cid_s = key_str.split("|", 1)
                self.enrollments[(int(sid_s), int(cid_s))] = d(enr)

            for session_id, session in state.get("sessions", {}).items():
                self.sessions[session_id] = d(session)

            for key_str, att in state.get("session_attendance", {}).items():
                sess_id, sid_s = key_str.split("|", 1)
                self.session_attendance[(sess_id, int(sid_s))] = d(att)

            for key_str, log in state.get("session_hour_log", {}).items():
                parts = key_str.split("|", 2)
                self.session_hour_log[(parts[0], int(parts[1]), int(parts[2]))] = d(log)

            print(
                f"[demo_repo] Loaded state: {len(self.sessions)} sessions, "
                f"{len(self.session_attendance)} attendance records"
            )
        except Exception as exc:
            print(f"[demo_repo] State load failed (starting fresh): {exc}")

    def _seed_demo_data(self) -> None:
        new_students = [
            ("S001", "Redeen Sirwan", "redeen.611224020@uor.edu.krd"),
            ("S002", "Rebin Hussain", "rebin.611224019@uor.edu.krd"),
            ("S003", "Drwd Samal", "drwd.611224013@uor.edu.krd"),
            ("S004", "Arsh Khasraw", "arsh.611224002@uor.edu.krd"),
            ("S005", "Abdulla Sleman", "abdulla.611224030@uor.edu.krd"),
        ]

        for code, name, email in new_students:
            student_id = self._student_seq
            self._student_seq += 1

            self.students[student_id] = {
                "StudentID": student_id,
                "StudentCode": code,
                "FullName": name,
                "Email": email,
                "ProfilePhotoUrl": None,
                "IsActive": 1,
                "CreatedAt": self._utcnow(),
            }

            for course_id in [1, 2]:
                modifier = int(code[-1])
                self.enrollments[(student_id, course_id)] = {
                    "StudentID": student_id,
                    "CourseID": course_id,
                    "Quiz1": max(3.0, 6.0 - modifier * 0.5),
                    "Quiz2": max(3.0, 6.0 - modifier * 0.5),
                    "ProjectGrade": max(6.0, 12.0 - modifier),
                    "AssignmentGrade": max(3.0, 6.0 - modifier * 0.5),
                    "MidtermGrade": max(10.0, 20.0 - modifier),
                    "FinalExamGrade": max(25.0, 50.0 - modifier * 2.5),
                    "HoursAbsentTotal": 0.0,
                    "UpdatedAt": self._utcnow(),
                }

    def _find_student_by_code(self, student_code: str) -> Optional[Dict[str, Any]]:
        target = student_code.strip().upper()
        for student in self.students.values():
            if str(student.get("StudentCode", "")).strip().upper() == target:
                return student
        return None

    def bootstrap_embeddings_from_folder(self, face_engine: Any, folder: Optional[str] = None) -> Dict[str, int]:
        root = Path(__file__).resolve().parents[1]
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
        penalty = float(enrollment["HoursAbsentTotal"]) * 0.5
        adjusted = max(0.0, raw_total - penalty)
        at_risk_policy = adjusted < 60 or float(enrollment["HoursAbsentTotal"]) >= max_absent
        return {
            "RawTotal": round(raw_total, 2),
            "AttendancePenalty": round(penalty, 2),
            "AdjustedTotal": round(adjusted, 2),
            "AtRisk": bool(at_risk_policy),
            "AtRiskByPolicy": bool(at_risk_policy),
        }

    def authenticate_professor(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        prof = self.professors.get(username)
        if not prof or prof["IsActive"] != 1:
            return None
        if _hash_password(password) != prof["PasswordHash"]:
            return None
        course = self.courses.get(prof["CourseID"])
        return {
            "professor_id": prof["ProfessorID"],
            "username": prof["Username"],
            "full_name": prof["FullName"],
            "course_id": prof["CourseID"],
            "course_name": course["CourseName"] if course else None,
            "course_code": course["CourseCode"] if course else None,
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

        self._save_state()
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

    def list_sessions_with_summary(self, course_id: int) -> List[Dict[str, Any]]:
        """Return all sessions for a course with attendance summary and absentee list."""
        course = self.courses.get(course_id, {})
        course_name = course.get("CourseName", "")
        enrolled_ids = [sid for (sid, cid) in self.enrollments.keys() if cid == course_id]
        total_enrolled = len(enrolled_ids)

        result = []
        for session_id, session in self.sessions.items():
            if int(session["CourseID"]) != course_id:
                continue

            present_count = 0
            absentees = []

            for student_id in enrolled_ids:
                att = self.session_attendance.get((session_id, student_id), {})
                if att.get("IsPresent"):
                    present_count += 1
                else:
                    student = self.students.get(student_id, {})
                    absentees.append({
                        "student_id": student_id,
                        "full_name": student.get("FullName", "Unknown"),
                    })

            started = session.get("StartedAt")
            ended = session.get("EndedAt")
            status = str(session.get("Status", "unknown")).lower()
            if ended is not None:
                status = "finalized"
            result.append({
                "session_id": session_id,
                "course_name": course_name,
                "started_at": started.isoformat() if started else None,
                "ended_at": ended.isoformat() if ended else None,
                "status": status,
                "total_enrolled": total_enrolled,
                "present_count": present_count,
                "absent_count": total_enrolled - present_count,
                "absentees": sorted(absentees, key=lambda x: x["full_name"]),
            })

        result.sort(key=lambda x: x["started_at"] or "", reverse=True)
        return result

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

    def get_gradebook_for_students(self, course_id: int, student_ids: list) -> List[Dict[str, Any]]:
        all_rows = self.get_gradebook(course_id)
        id_set = set(int(sid) for sid in student_ids)
        return [r for r in all_rows if int(r["StudentID"]) in id_set]

    def update_student_grades(self, course_id: int, student_id: int, grades: Dict[str, Any]) -> Dict[str, Any]:
        enrollment = self.enrollments.get((student_id, course_id))
        if not enrollment:
            raise ValueError("Enrollment was not found for grade update.")

        enrollment["Quiz1"] = float(grades["quiz1"])
        enrollment["Quiz2"] = float(grades["quiz2"])
        enrollment["ProjectGrade"] = float(grades["project"])
        enrollment["AssignmentGrade"] = float(grades["assignment"])
        enrollment["MidtermGrade"] = float(grades["midterm"])
        enrollment["FinalExamGrade"] = float(grades["final_exam"])
        if grades.get("hours_absent_total") is not None:
            enrollment["HoursAbsentTotal"] = max(0.0, float(grades["hours_absent_total"]))
        enrollment["UpdatedAt"] = self._utcnow()

        self._save_state()
        for row in self.get_gradebook(course_id):
            if int(row["StudentID"]) == int(student_id):
                return row

        raise ValueError("Updated grade row was not found.")

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

        self._save_state()
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

        key = (session_id, student_id)
        existing = self.session_attendance.get(key)

        # Respect manual overrides — don't let camera recognition overwrite them.
        if existing and existing.get("_ManualLock"):
            return

        delay = int((recognized_at - session["StartedAt"]).total_seconds() // 60)
        if delay < 0:
            delay = 0
        grace = int(course["LateGraceMinutes"])
        within_grace = delay <= grace

        if not existing:
            self.session_attendance[key] = {
                "SessionID": session_id,
                "StudentID": student_id,
                "FirstSeenAt": recognized_at,
                "LastSeenAt": recognized_at,
                "IsPresent": 1 if within_grace else 0,
            }
            if within_grace:
                self._save_state()
        else:
            last = existing.get("LastSeenAt")
            existing["LastSeenAt"] = recognized_at if last is None else max(last, recognized_at)
            if existing.get("IsPresent"):
                # Already present — just update timestamps, don't change status
                if existing.get("FirstSeenAt") is None:
                    existing["FirstSeenAt"] = recognized_at
            elif within_grace:
                # Still within grace window — mark present now
                first = existing.get("FirstSeenAt")
                existing["FirstSeenAt"] = recognized_at if first is None else min(first, recognized_at)
                existing["IsPresent"] = 1
                self._save_state()
            # else: after grace, student stays absent

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
                    "ManualOverride": bool(attendance.get("_ManualLock", False)),
                }
            )

        rows.sort(key=lambda row: row["FullName"])
        return rows

    def set_manual_attendance(
        self,
        session_id: str,
        student_id: int,
        is_present: bool,
        marked_at: Optional[datetime],
    ) -> Dict[str, Any]:
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError("Session not found.")

        course_id = int(session["CourseID"])
        if (student_id, course_id) not in self.enrollments:
            raise ValueError("Student is not enrolled in this session course.")

        now_value = marked_at or self._utcnow()
        key = (session_id, student_id)

        if is_present:
            existing = self.session_attendance.get(key)
            if not existing:
                self.session_attendance[key] = {
                    "SessionID": session_id,
                    "StudentID": student_id,
                    "FirstSeenAt": now_value,
                    "LastSeenAt": now_value,
                    "IsPresent": 1,
                    "_ManualLock": True,
                }
            else:
                first_seen = existing.get("FirstSeenAt")
                last_seen = existing.get("LastSeenAt")
                existing["FirstSeenAt"] = now_value if first_seen is None else min(first_seen, now_value)
                existing["LastSeenAt"] = now_value if last_seen is None else max(last_seen, now_value)
                existing["IsPresent"] = 1
                existing["_ManualLock"] = True
        else:
            self.session_attendance[key] = {
                "SessionID": session_id,
                "StudentID": student_id,
                "FirstSeenAt": None,
                "LastSeenAt": None,
                "IsPresent": 0,
                "_ManualLock": True,
            }

        row = self.get_attendance_row(session_id, student_id)
        if not row:
            raise ValueError("Attendance row could not be updated.")

        self._save_state()
        student = self.students.get(student_id, {})
        return {
            "StudentID": student_id,
            "StudentCode": student.get("StudentCode"),
            "FullName": student.get("FullName"),
            "FirstSeenAt": row.get("FirstSeenAt"),
            "LastSeenAt": row.get("LastSeenAt"),
            "IsPresent": row.get("IsPresent", 0),
        }

    def get_attendance_row(self, session_id: str, student_id: int) -> Optional[Dict[str, Any]]:
        row = self.session_attendance.get((session_id, student_id))
        if not row:
            return None
        return {
            "IsPresent": row.get("IsPresent", 0),
            "FirstSeenAt": row.get("FirstSeenAt"),
            "LastSeenAt": row.get("LastSeenAt"),
            "_ManualLock": row.get("_ManualLock", False),
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

        course = self.courses.get(course_id)
        grace_minutes = int(course.get("LateGraceMinutes", 10)) if course else 10

        for student_id in enrolled_ids:
            att = self.session_attendance.get((session_id, student_id))
            first_seen = att.get("FirstSeenAt") if att else None

            # Normalise to timezone-naive for consistent comparison with start_at
            if first_seen is not None and getattr(first_seen, "tzinfo", None) is not None:
                first_seen = first_seen.replace(tzinfo=None)

            absent_weight = 0.0
            for hour_index in range(total_hours):
                hour_start = start_at + timedelta(hours=hour_index)
                grace_end = hour_start + timedelta(minutes=grace_minutes)

                if first_seen is None or first_seen > grace_end:
                    # Never arrived or arrived after the grace window — absent for this hour
                    absent_weight += 1.0
                # else: arrived within grace window — present for this hour

            enr = self.enrollments.get((student_id, course_id))
            if enr:
                enr["HoursAbsentTotal"] = float(enr["HoursAbsentTotal"]) + absent_weight
                enr["UpdatedAt"] = self._utcnow()

        self._save_state()

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

    def get_absent_and_late_for_session(self, session_id: str) -> List[Dict[str, Any]]:
        """Return absent students with per-session hours for session-end emails."""
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
                    "HoursAbsentTotal": enrollment["HoursAbsentTotal"],
                    "AttendancePenalty": metrics["AttendancePenalty"],
                    "AtRiskByPolicy": metrics["AtRiskByPolicy"],
                    "IsLate": 0,
                    "SessionAbsentHours": 1.0,
                    "SessionPenalty": 0.5,
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
