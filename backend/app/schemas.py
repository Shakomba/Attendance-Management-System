from datetime import datetime
from typing import Dict, Optional

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
    quiz1: float = Field(ge=0, le=100)
    quiz2: float = Field(ge=0, le=100)
    project: float = Field(ge=0, le=100)
    assignment: float = Field(ge=0, le=100)
    midterm: float = Field(ge=0, le=100)
    final_exam: float = Field(ge=0, le=100)


class ManualAttendanceUpdateRequest(BaseModel):
    is_present: bool
    is_late: bool = False
    arrival_delay_minutes: Optional[int] = Field(default=None, ge=0)
    marked_at: Optional[datetime] = None


class GenericMessage(BaseModel):
    message: str
    data: Optional[Dict] = None
