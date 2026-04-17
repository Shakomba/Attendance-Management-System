from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


class GradesPayload(BaseModel):
    quiz1: float = Field(default=0, ge=0, le=100)
    quiz2: float = Field(default=0, ge=0, le=100)
    project: float = Field(default=0, ge=0, le=100)
    assignment: float = Field(default=0, ge=0, le=100)
    midterm: float = Field(default=0, ge=0, le=100)
    final_exam: float = Field(default=0, ge=0, le=100)


class StudentCreateRequest(BaseModel):
    student_code: str = Field(min_length=1, max_length=30)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    profile_photo_url: Optional[str] = None
    course_id: int
    grades: GradesPayload = Field(default_factory=GradesPayload)


class StartSessionRequest(BaseModel):
    course_id: int
    started_at: Optional[datetime] = None


class StartSessionResponse(BaseModel):
    session_id: str
    course_id: int
    started_at: Optional[str] = None


class FinalizeSessionResponse(BaseModel):
    session_id: str
    emails_sent: int
    email_failures: int


class GradeUpdateRequest(BaseModel):
    quiz1: Optional[float] = Field(default=None, ge=0, le=100)
    quiz2: Optional[float] = Field(default=None, ge=0, le=100)
    project: Optional[float] = Field(default=None, ge=0, le=100)
    assignment: Optional[float] = Field(default=None, ge=0, le=100)
    midterm: Optional[float] = Field(default=None, ge=0, le=100)
    final_exam: Optional[float] = Field(default=None, ge=0, le=100)
    hours_absent_total: Optional[float] = Field(default=None, ge=0)


class ManualAttendanceUpdateRequest(BaseModel):
    is_present: bool
    marked_at: Optional[datetime] = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    professor_id: int
    username: str
    full_name: str
    course_id: int
    course_name: Optional[str] = None
    course_code: Optional[str] = None
    access_token: str = ""


class GenericMessage(BaseModel):
    message: str
    data: Optional[Dict] = None


class BulkEmailRequest(BaseModel):
    student_ids: List[int]
    email_type: str  # "grade_report" or "absence_report"
    lang: str = "en"


class BulkEmailResponse(BaseModel):
    total: int
    sent: int
    failed: int
    results: List[Dict[str, Any]]


class EnrollmentStartResponse(BaseModel):
    student_id: int
    current_pose: str
    message: str
    total_poses: int


class EnrollmentStatusResponse(BaseModel):
    student_id: int
    enrollment_status: str  # 'pending' or 'enrolled'
    captured_poses: List[str]
    remaining_poses: List[str]
