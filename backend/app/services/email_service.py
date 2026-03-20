from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Tuple

from ..config import settings
from ..repos import Repository


class EmailService:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    @staticmethod
    def _build_subject(course_code: str, student_name: str) -> str:
        return f"Attendance Update - {course_code} - {student_name}"

    # ── Shared style constants ───────────────────────────────────────

    _STYLE_BODY = 'font-family: "Segoe UI", Arial, sans-serif; color: #1f2937; background: #f9fafb; margin: 0; padding: 32px 0;'
    _STYLE_CARD = "background: #ffffff; max-width: 560px; margin: 0 auto; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;"
    _STYLE_HEADER = "padding: 24px 28px 16px; border-bottom: 1px solid #e5e7eb;"
    _STYLE_SECTION = "padding: 20px 28px;"
    _STYLE_TABLE = "border-collapse: collapse; width: 100%;"
    _STYLE_TH = "padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; text-align: left; font-size: 13px; font-weight: 600; color: #374151;"
    _STYLE_TD = "padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 13px; color: #4b5563;"
    _STYLE_TD_BOLD = "padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 13px; font-weight: 700; color: #111827;"

    _BANNER_AT_RISK = """
    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
        <strong style="color: #92400e;">⚠ At Risk</strong>
        <p style="margin: 4px 0 0; font-size: 13px; color: #92400e;">
            Your current standing places you at academic risk. Please reach out to your instructor to discuss how to improve.
        </p>
    </div>
    """

    _BANNER_DROPPED = """
    <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
        <strong style="color: #991b1b;">🚫 Dropped — Excessive Absences</strong>
        <p style="margin: 4px 0 0; font-size: 13px; color: #991b1b;">
            You have exceeded the maximum allowed absent hours for this course. You are considered dropped from the course.
            Please contact your academic advisor immediately to discuss your options.
        </p>
    </div>
    """

    @staticmethod
    def _status_banner(student: Dict) -> str:
        hours_absent = float(student.get("HoursAbsentTotal", 0) or 0)
        is_dropped = hours_absent >= 5
        is_at_risk = not is_dropped and bool(student.get("AtRiskByPolicy") or student.get("AtRisk"))
        if is_dropped:
            return EmailService._BANNER_DROPPED
        if is_at_risk:
            return EmailService._BANNER_AT_RISK
        return ""

    # ── Session-end notification (absent / late students only) ──────

    @classmethod
    def _build_session_notification_html(cls, student: Dict) -> str:
        """Focused session-end email: hours this session + grade deducted + status warnings."""
        banner = cls._status_banner(student)
        is_late = bool(student.get("IsLate"))
        session_hours = float(student.get("SessionAbsentHours", 1.0) or 1.0)
        session_penalty = float(student.get("SessionPenalty", 0.5) or 0.5)
        total_hours = float(student.get("HoursAbsentTotal", 0) or 0)
        course_code = student.get("CourseCode", "")
        course_name = student.get("CourseName", "")
        name = student.get("FullName", "Student")

        status_label = "Late Arrival" if is_late else "Absent"
        session_desc = (
            f"You arrived late to the most recent session of "
            f"<strong>{course_name}</strong>, recording "
            f"<strong>{session_hours:.1f} absence hours</strong>."
            if is_late else
            f"You were marked absent in the most recent session of "
            f"<strong>{course_name}</strong>, recording "
            f"<strong>{session_hours:.1f} absence hour(s)</strong>."
        )

        return f"""<html><body style="{cls._STYLE_BODY}">
<div style="{cls._STYLE_CARD}">
  <div style="{cls._STYLE_HEADER}">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">Attendance Notice — {status_label}</h2>
    <p style="margin:0; font-size:13px; color:#6b7280;">{course_name}</p>
  </div>
  <div style="{cls._STYLE_SECTION}">
    <p style="margin:0 0 16px; font-size:14px;">Dear <strong>{name}</strong>,</p>
    <p style="margin:0 0 16px; font-size:14px; color:#374151;">{session_desc}</p>
    {banner}
    <table style="{cls._STYLE_TABLE}">
      <tr><th style="{cls._STYLE_TH}">Detail</th><th style="{cls._STYLE_TH}">Value</th></tr>
      <tr><td style="{cls._STYLE_TD}">Status this session</td><td style="{cls._STYLE_TD}; font-weight:700; color:#b45309;">{status_label}</td></tr>
      <tr><td style="{cls._STYLE_TD}">Absence hours this session</td><td style="{cls._STYLE_TD}; font-weight:700; color:#ef4444;">{session_hours:.1f} hr(s)</td></tr>
      <tr><td style="{cls._STYLE_TD}">Grade deducted this session</td><td style="{cls._STYLE_TD}; color:#ef4444;">−{session_penalty:.2f} pts</td></tr>
      <tr><td style="{cls._STYLE_TD_BOLD}">Total absence hours (cumulative)</td><td style="{cls._STYLE_TD_BOLD}">{total_hours:.1f} hr(s)</td></tr>
    </table>
    <p style="margin:16px 0 4px; font-size:13px; color:#6b7280;">Each absent hour deducts <strong>0.5 grade points</strong> from your final grade.</p>
    <p style="margin:0; font-size:13px; color:#6b7280;">Please contact your instructor if you have any questions.</p>
  </div>
</div>
</body></html>"""

    # ── New: Grade Report Email ──────────────────────────────────────

    @classmethod
    def _build_grade_report_html(cls, student: Dict) -> str:
        banner = cls._status_banner(student)
        penalty = float(student.get("AttendancePenalty", 0) or 0)
        hours = float(student.get("HoursAbsentTotal", 0) or 0)
        
        quiz1 = float(student.get("Quiz1", 0) or 0)
        quiz2 = float(student.get("Quiz2", 0) or 0)
        proj = float(student.get("ProjectGrade", 0) or 0)
        assn = float(student.get("AssignmentGrade", 0) or 0)
        midterm = float(student.get("MidtermGrade", 0) or 0)

        # Total out of 50 (Quiz1 + Quiz2 + Project + Assignment + Midterm)
        grade_total = quiz1 + quiz2 + proj + assn + midterm
        adjusted = round(max(0.0, grade_total - penalty), 2)

        q1_style = f"{cls._STYLE_TD};" + (" color:#ef4444;" if quiz1 < 3.0 else "")
        q2_style = f"{cls._STYLE_TD};" + (" color:#ef4444;" if quiz2 < 3.0 else "")
        proj_style = f"{cls._STYLE_TD};" + (" color:#ef4444;" if proj < 6.0 else "")
        assn_style = f"{cls._STYLE_TD};" + (" color:#ef4444;" if assn < 3.0 else "")
        mid_style = f"{cls._STYLE_TD};" + (" color:#ef4444;" if midterm < 10.0 else "")
        adj_style = f"{cls._STYLE_TD_BOLD};" + (" color:#ef4444;" if adjusted < 25.0 else "")

        hours_style = f"{cls._STYLE_TD}; font-weight:700;" + (" color:#ef4444;" if hours > 0 else "")
        penalty_style = f"{cls._STYLE_TD};" + (" color:#ef4444;" if penalty > 0 else "")
        penalty_text = f"−{penalty:.2f} pts" if penalty > 0 else f"{penalty:.2f} pts"

        return f"""<html><body style="{cls._STYLE_BODY}">
<div style="{cls._STYLE_CARD}">
  <div style="{cls._STYLE_HEADER}">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">Grade Report</h2>
    <p style="margin:0; font-size:13px; color:#6b7280;">{student['CourseName']}</p>
  </div>
  <div style="{cls._STYLE_SECTION}">
    <p style="margin:0 0 16px; font-size:14px;">Dear <strong>{student['FullName']}</strong>,</p>
    {banner}
    <table style="{cls._STYLE_TABLE}">
      <tr><th style="{cls._STYLE_TH}">Component</th><th style="{cls._STYLE_TH}">Grade</th></tr>
      <tr><td style="{cls._STYLE_TD}">Quiz 1</td><td style="{q1_style}">{student['Quiz1']}</td></tr>
      <tr><td style="{cls._STYLE_TD}">Quiz 2</td><td style="{q2_style}">{student['Quiz2']}</td></tr>
      <tr><td style="{cls._STYLE_TD}">Project</td><td style="{proj_style}">{student['ProjectGrade']}</td></tr>
      <tr><td style="{cls._STYLE_TD}">Assignment</td><td style="{assn_style}">{student['AssignmentGrade']}</td></tr>
      <tr><td style="{cls._STYLE_TD}">Midterm</td><td style="{mid_style}">{student['MidtermGrade']}</td></tr>
      <tr><td style="{cls._STYLE_TD}">Total absence hours</td><td style="{hours_style}">{hours:.1f} hr(s)</td></tr>
      <tr><td style="{cls._STYLE_TD}">Attendance penalty</td><td style="{penalty_style}">{penalty_text}</td></tr>
      <tr><td style="{cls._STYLE_TD_BOLD}">Total (out of 50)</td><td style="{adj_style}">{adjusted} / 50</td></tr>
    </table>
    <p style="margin:16px 0 0; font-size:13px; color:#6b7280;">Contact your instructor if you have questions.</p>
  </div>
</div>
</body></html>"""


    # ── New: Absence Report Email ────────────────────────────────────

    @classmethod
    def _build_absence_report_html(cls, student: Dict) -> str:
        banner = cls._status_banner(student)
        hours = float(student.get("HoursAbsentTotal", 0) or 0)
        penalty = float(student.get("AttendancePenalty", 0) or 0)
        course_code = student.get("CourseCode", "")
        course_name = student.get("CourseName", "")
        name = student.get("FullName", "Student")

        hours_style = f"{cls._STYLE_TD}; font-weight:700;" + (" color:#ef4444;" if hours > 0 else "")
        penalty_style = f"{cls._STYLE_TD_BOLD};" + (" color:#ef4444;" if penalty > 0 else "")
        penalty_text = f"−{penalty:.2f} pts" if penalty > 0 else f"{penalty:.2f} pts"

        return f"""<html><body style="{cls._STYLE_BODY}">
<div style="{cls._STYLE_CARD}">
  <div style="{cls._STYLE_HEADER}">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">Absence Report</h2>
    <p style="margin:0; font-size:13px; color:#6b7280;">{course_name}</p>
  </div>
  <div style="{cls._STYLE_SECTION}">
    <p style="margin:0 0 16px; font-size:14px;">Dear <strong>{name}</strong>,</p>
    <p style="margin:0 0 16px; font-size:14px; color:#374151;">
      Below is a summary of your current absence record for
      <strong>{course_name}</strong>.
    </p>
    {banner}
    <table style="{cls._STYLE_TABLE}">
      <tr><th style="{cls._STYLE_TH}">Detail</th><th style="{cls._STYLE_TH}">Value</th></tr>
      <tr><td style="{cls._STYLE_TD}">Total absence hours</td><td style="{hours_style}">{hours:.1f} hr(s)</td></tr>
      <tr><td style="{cls._STYLE_TD_BOLD}">Total grade deducted</td><td style="{penalty_style}">{penalty_text}</td></tr>
    </table>
    <p style="margin:16px 0 4px; font-size:13px; color:#6b7280;">Each absent hour deducts <strong>0.5 grade points</strong> from your final grade.</p>
    <p style="margin:0; font-size:13px; color:#6b7280;">Please contact your instructor if you have any questions.</p>
  </div>
</div>
</body></html>"""


    # ── Send single email ────────────────────────────────────────────

    def _send_email(self, recipient_email: str, subject: str, html_body: str) -> None:
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = settings.smtp_from
        message["To"] = recipient_email
        message.attach(MIMEText(html_body, "html"))

        if settings.smtp_port == 465:
            smtp_cls = smtplib.SMTP_SSL
        else:
            smtp_cls = smtplib.SMTP

        with smtp_cls(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            if settings.smtp_port != 465 and settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.sendmail(settings.smtp_from, [recipient_email], message.as_string())

    # ── Session-finalize: send to absent + late students ─────────────

    def send_absentee_reports(self, session_id: str) -> Tuple[int, int]:
        students = self.repository.get_absent_and_late_for_session(session_id)
        sent = 0
        failed = 0

        for student in students:
            name = str(student.get("FullName", "Student"))
            is_late = bool(student.get("IsLate"))
            status_label = "Late Arrival" if is_late else "Absent"

            subject = f"Attendance Notice ({status_label}) — {name}"
            html_body = self._build_session_notification_html(student)
            recipient_email = str(student["Email"])
            student_id = int(student["StudentID"])

            if settings.smtp_dry_run:
                self.repository.insert_email_log(
                    session_id=session_id,
                    student_id=student_id,
                    recipient_email=recipient_email,
                    subject_line=subject,
                    status="DRY_RUN",
                    error_message=None,
                )
                sent += 1
                continue

            try:
                self._send_email(recipient_email, subject, html_body)
                self.repository.insert_email_log(
                    session_id=session_id,
                    student_id=student_id,
                    recipient_email=recipient_email,
                    subject_line=subject,
                    status="SENT",
                    error_message=None,
                )
                sent += 1
            except Exception as exc:  # pragma: no cover
                self.repository.insert_email_log(
                    session_id=session_id,
                    student_id=student_id,
                    recipient_email=recipient_email,
                    subject_line=subject,
                    status="FAILED",
                    error_message=str(exc),
                )
                failed += 1

        return sent, failed

    # ── New: On-demand bulk email ────────────────────────────────────

    def send_bulk_emails(
        self,
        students: List[Dict[str, Any]],
        email_type: str,
    ) -> Dict[str, Any]:
        """Send bulk emails. Returns {total, sent, failed, results}."""
        sent = 0
        failed = 0
        results: List[Dict[str, Any]] = []

        for student in students:
            student_name = str(student.get("FullName", "Student"))
            recipient = str(student.get("Email", ""))
            student_id = int(student.get("StudentID", 0))

            if email_type == "grade_report":
                subject = f"Grade Report — {student_name}"
                html_body = self._build_grade_report_html(student)
            else:
                subject = f"Absence Report — {student_name}"
                html_body = self._build_absence_report_html(student)

            if settings.smtp_dry_run:
                results.append({
                    "student_id": student_id,
                    "full_name": student_name,
                    "email": recipient,
                    "status": "DRY_RUN",
                    "error": None,
                })
                sent += 1
                continue

            try:
                self._send_email(recipient, subject, html_body)
                results.append({
                    "student_id": student_id,
                    "full_name": student_name,
                    "email": recipient,
                    "status": "SENT",
                    "error": None,
                })
                sent += 1
            except Exception as exc:
                results.append({
                    "student_id": student_id,
                    "full_name": student_name,
                    "email": recipient,
                    "status": "FAILED",
                    "error": str(exc),
                })
                failed += 1

        return {
            "total": len(students),
            "sent": sent,
            "failed": failed,
            "results": results,
        }
