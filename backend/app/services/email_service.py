from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Dict, List, Tuple

from ..config import settings
from ..repos import Repository


class EmailService:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    @staticmethod
    def _build_subject(course_code: str, student_name: str) -> str:
        return f"Attendance Update - {course_code} - {student_name}"

    @staticmethod
    def _build_html(student: Dict) -> str:
        risk_text = "Yes" if student.get("AtRiskByPolicy") else "No"

        return f"""
        <html>
          <body style=\"font-family: Arial, sans-serif; color: #1f2937;\">
            <h2 style=\"margin-bottom: 8px;\">Attendance & Grade Report</h2>
            <p>Dear {student['FullName']},</p>
            <p>
              You were marked absent in the most recent session for
              <strong>{student['CourseCode']} - {student['CourseName']}</strong>.
            </p>
            <table style=\"border-collapse: collapse; width: 100%; max-width: 560px;\">
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Quiz 1</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['Quiz1']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Quiz 2</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['Quiz2']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Project</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['ProjectGrade']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Assignment</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['AssignmentGrade']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Midterm</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['MidtermGrade']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Final Exam</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['FinalExamGrade']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Total Absent Hours</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{student['HoursAbsentTotal']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">Attendance Penalty</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">-{student['AttendancePenalty']}</td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\"><strong>Adjusted Total</strong></td><td style=\"padding:6px;border:1px solid #e5e7eb;\"><strong>{student['AdjustedTotal']}</strong></td></tr>
              <tr><td style=\"padding:6px;border:1px solid #e5e7eb;\">At Risk</td><td style=\"padding:6px;border:1px solid #e5e7eb;\">{risk_text}</td></tr>
            </table>
            <p style=\"margin-top:16px;\">Please contact your instructor if you have questions.</p>
            <p>Regards,<br/>Attendance Automation System</p>
          </body>
        </html>
        """.strip()

    def _send_email(self, recipient_email: str, subject: str, html_body: str) -> None:
        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = settings.smtp_from
        message["To"] = recipient_email
        message.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.sendmail(settings.smtp_from, [recipient_email], message.as_string())

    def send_absentee_reports(self, session_id: str) -> Tuple[int, int]:
        absentees = self.repository.get_absentees_for_session(session_id)
        sent = 0
        failed = 0

        for student in absentees:
            subject = self._build_subject(str(student["CourseCode"]), str(student["FullName"]))
            html_body = self._build_html(student)
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
