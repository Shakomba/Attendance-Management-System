from datetime import datetime
from typing import Dict, Optional

from pydantic import BaseModel, EmailStr, Field


class GradesPayload(BaseModel):
    quiz1: float = 0
    quiz2: float = 0
    project: float = 0
    assignment: float = 0
    midterm: float = 0
    final_exam: float = 0


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


class GenericMessage(BaseModel):
    message: str
    data: Optional[Dict] = None
