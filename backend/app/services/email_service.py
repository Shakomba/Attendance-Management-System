from __future__ import annotations

import smtplib
import json
import requests
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Tuple

from ..config import settings
from ..repos import Repository



T = {
    "en": {
        "at_risk_title": "⚠ At Risk",
        "at_risk_body": "Your current standing places you at academic risk. Please reach out to your instructor to discuss how to improve.",
        "dropped_title": "🚫 Dropped — Excessive Absences",
        "dropped_body": "You have exceeded the maximum allowed absent hours for this course. You are considered dropped from the course. Please contact your academic advisor immediately to discuss your options.",
        "notice_late": "Late Arrival",
        "notice_absent": "Absent",
        "dear": "Dear",
        "detail": "Detail",
        "value": "Value",
        "status_session": "Status this session",
        "hrs_session": "Absence hours this session",
        "deducted_session": "Grade deducted this session",
        "total_hrs": "Total absence hours (cumulative)",
        "penalty_rule": "Each absent hour deducts <strong>0.5 grade points</strong> from your final grade.",
        "contact": "Please contact your instructor if you have any questions.",
        "attend_notice": "Attendance Notice",
        "desc_late": "You arrived late to the most recent session of <strong>{course}</strong>, recording <strong>{hrs:.1f} absence hours</strong>.",
        "desc_absent": "You were marked absent in the most recent session of <strong>{course}</strong>, recording <strong>{hrs:.1f} absence hour(s)</strong>.",
        "grade_report": "Grade Report",
        "component": "Component",
        "grade": "Grade",
        "quiz1": "Quiz 1",
        "quiz2": "Quiz 2",
        "project": "Project",
        "assignment": "Assignment",
        "midterm": "Midterm",
        "total_absence_hours": "Total absence hours",
        "attendance_penalty": "Attendance penalty",
        "total_50": "Total (out of 50)",
        "absence_report": "Absence Report",
        "absence_summary": "Below is a summary of your current absence record for <strong>{course}</strong>.",
        "total_deducted": "Total grade deducted",
        "pts": "pts",
        "hr_s": "hr(s)",
    },
    "ku": {
        "at_risk_title": "⚠ مەترسی",
        "at_risk_body": "دۆخی ئێستات تۆ دەخاتە مەترسی ئەکادیمییەوە. تکایە پەیوەندی بە مامۆستاکەتەوە بکە بۆ تاوتوێکردنی چۆنیەتی باشترکردنی.",
        "dropped_title": "🚫 دەرکراو - نەهاتووی زۆر",
        "dropped_body": "تۆ سنوری ڕێگەپێدراوی نەهاتووت تێپەڕاندووە لەم وانەیەدا. تۆ بە دەرکراو هەژمار دەکرێیت لە وانەکە. تکایە دەستبەجێ پەیوەندی بە ڕاوێژکارە ئەکادیمییەکەتەوە بکە بۆ تاوتوێکردنی هەڵبژاردەکانت.",
        "notice_late": "دواکەوتن",
        "notice_absent": "نەهاتوو",
        "dear": "بەڕێز",
        "detail": "وردەکاری",
        "value": "بەها",
        "status_session": "دۆخی ئەم وانەیە",
        "hrs_session": "کاتژمێرەکانی نەهاتووی ئەم وانەیە",
        "deducted_session": "نمرەی کەمکراوەی ئەم وانەیە",
        "total_hrs": "کۆی گشتی کاتژمێرەکانی نەهاتوو",
        "penalty_rule": "هەر کاتژمێرێکی نەهاتوو <strong>0.5 نمرە</strong> لە نمرەی کۆتاییت کەم دەکاتەوە.",
        "contact": "تکایە پەیوەندی بە مامۆستاکەتەوە بکە ئەگەر هەر پرسیارێکت هەیە.",
        "attend_notice": "ئاگاداری ئامادەنەبوون",
        "desc_late": "تۆ درەنگ گەیشتیتە دواهەمین وانەی <strong>{course}</strong>، کە تۆمار دەکرێت <strong>{hrs:.1f} کاتژمێری نەهاتوو</strong>.",
        "desc_absent": "تۆ وەک ئامادەنەبوو تۆمارکراویت لە دواهەمین وانەی <strong>{course}</strong>، کە تۆمار دەکرێت <strong>{hrs:.1f} کاتژمێری نەهاتوو</strong>.",
        "grade_report": "ڕاپۆرتی نمرە",
        "component": "پێکهاتە",
        "grade": "نمرە",
        "quiz1": "کوستی ١",
        "quiz2": "کوستی ٢",
        "project": "پرۆژە",
        "assignment": "ئەرک",
        "midterm": "نیوەی وەرز",
        "total_absence_hours": "کۆی گشتی کاتژمێرەکانی نەهاتوو",
        "attendance_penalty": "سزای ئامادەنەبوون",
        "total_50": "کۆی گشتی (لە ٥٠)",
        "absence_report": "ڕاپۆرتی نەهاتوو",
        "absence_summary": "لە خوارەوە پوختەی تۆماری نەهاتووەکانی ئێستاتە بۆ <strong>{course}</strong>.",
        "total_deducted": "کۆی گشتی نمرەی کەمکراوە",
        "pts": "خاڵ",
        "hr_s": "کاتژمێر",
    }
}

class EmailService:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    @staticmethod
    def _build_subject(course_code: str, student_name: str) -> str:
        return f"Attendance Update - {course_code} - {student_name}"

    # ── Shared style constants ───────────────────────────────────────

    _STYLE_BODY = 'font-family: "Vazirmatn", "Segoe UI", Arial, sans-serif; color: #1f2937; background: #f9fafb; margin: 0; padding: 32px 0;'
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
    def _status_banner(student: Dict, lang: str = "en") -> str:
        hours_absent = float(student.get("HoursAbsentTotal", 0) or 0)
        is_dropped = hours_absent >= 5
        is_at_risk = not is_dropped and bool(student.get("AtRiskByPolicy") or student.get("AtRisk"))
        td = T.get(lang, T["en"])
        if is_dropped:
            return f'''
            <div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
                <strong style="color: #991b1b;">{td["dropped_title"]}</strong>
                <p style="margin: 4px 0 0; font-size: 13px; color: #991b1b;">
                    {td["dropped_body"]}
                </p>
            </div>
            '''
        if is_at_risk:
            return f'''
            <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
                <strong style="color: #92400e;">{td["at_risk_title"]}</strong>
                <p style="margin: 4px 0 0; font-size: 13px; color: #92400e;">
                    {td["at_risk_body"]}
                </p>
            </div>
            '''
        return ""


    # ── Session-end notification (absent / late students only) ──────

    @classmethod
    def _build_session_notification_html(cls, student: Dict, lang: str = "en") -> str:
        banner = cls._status_banner(student, lang)
        td = T.get(lang, T["en"])
        direction = 'dir="rtl"' if lang == "ku" else 'dir="ltr"'
        
        is_late = bool(student.get("IsLate"))
        session_hours = float(student.get("SessionAbsentHours", 1.0) or 1.0)
        session_penalty = float(student.get("SessionPenalty", 0.5) or 0.5)
        total_hours = float(student.get("HoursAbsentTotal", 0) or 0)
        course_name = student.get("CourseName", "")
        name = student.get("FullName", "Student")

        status_label = td["notice_late"] if is_late else td["notice_absent"]
        
        desc_template = td["desc_late"] if is_late else td["desc_absent"]
        session_desc = desc_template.format(course=course_name, hrs=session_hours)

        return f'''<html {direction}><head><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="{cls._STYLE_BODY}">
<div style="{cls._STYLE_CARD}">
    <div style="{cls._STYLE_HEADER}">
        <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">{td["attend_notice"]} — {status_label}</h2>
        <p style="margin:0; font-size:13px; color:#6b7280;">{course_name}</p>
  </div>
    <div style="{cls._STYLE_SECTION}">
        <p style="margin:0 0 16px; font-size:14px;">{td["dear"]} <strong>{name}</strong>,</p>
        <p style="margin:0 0 16px; font-size:14px; color:#374151;">{session_desc}</p>
        {banner}
        <table style="{cls._STYLE_TABLE}">
            <tr><th style="{cls._STYLE_TH}">{td["detail"]}</th><th style="{cls._STYLE_TH}">{td["value"]}</th></tr>
            <tr><td style="{cls._STYLE_TD}">{td["status_session"]}</td><td style="{cls._STYLE_TD}; font-weight:700; color:#b45309;">{status_label}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["hrs_session"]}</td><td style="{cls._STYLE_TD}; font-weight:700; color:#ef4444;">{session_hours:.1f} {td["hr_s"]}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["deducted_session"]}</td><td style="{cls._STYLE_TD}; color:#ef4444;">−{session_penalty:.2f} {td["pts"]}</td></tr>
            <tr><td style="{cls._STYLE_TD_BOLD}">{td["total_hrs"]}</td><td style="{cls._STYLE_TD_BOLD}">{total_hours:.1f} {td["hr_s"]}</td></tr>
    </table>
        <p style="margin:16px 0 4px; font-size:13px; color:#6b7280;">{td["penalty_rule"]}</p>
        <p style="margin:0; font-size:13px; color:#6b7280;">{td["contact"]}</p>
  </div>
</div>
</body></html>'''

    # ── New: Grade Report Email ──────────────────────────────────────

    @classmethod
    def _build_grade_report_html(cls, student: Dict, lang: str = "en") -> str:
        banner = cls._status_banner(student, lang)
        td = T.get(lang, T["en"])
        direction = 'dir="rtl"' if lang == "ku" else 'dir="ltr"'
        
        penalty = float(student.get("AttendancePenalty", 0) or 0)
        hours = float(student.get("HoursAbsentTotal", 0) or 0)
        
        quiz1 = float(student.get("Quiz1", 0) or 0)
        quiz2 = float(student.get("Quiz2", 0) or 0)
        proj = float(student.get("ProjectGrade", 0) or 0)
        assn = float(student.get("AssignmentGrade", 0) or 0)
        midterm = float(student.get("MidtermGrade", 0) or 0)

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
        penalty_text = f"−{penalty:.2f} {td['pts']}" if penalty > 0 else f"{penalty:.2f} {td['pts']}"

        return f'''<html {direction}><head><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="{cls._STYLE_BODY}">
<div style="{cls._STYLE_CARD}">
    <div style="{cls._STYLE_HEADER}">
        <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">{td["grade_report"]}</h2>
        <p style="margin:0; font-size:13px; color:#6b7280;">{student['CourseName']}</p>
  </div>
    <div style="{cls._STYLE_SECTION}">
        <p style="margin:0 0 16px; font-size:14px;">{td["dear"]} <strong>{student['FullName']}</strong>,</p>
        {banner}
        <table style="{cls._STYLE_TABLE}">
            <tr><th style="{cls._STYLE_TH}">{td["component"]}</th><th style="{cls._STYLE_TH}">{td["grade"]}</th></tr>
            <tr><td style="{cls._STYLE_TD}">{td["quiz1"]}</td><td style="{q1_style}">{student['Quiz1']}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["quiz2"]}</td><td style="{q2_style}">{student['Quiz2']}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["project"]}</td><td style="{proj_style}">{student['ProjectGrade']}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["assignment"]}</td><td style="{assn_style}">{student['AssignmentGrade']}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["midterm"]}</td><td style="{mid_style}">{student['MidtermGrade']}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["total_absence_hours"]}</td><td style="{hours_style}">{hours:.1f} {td["hr_s"]}</td></tr>
            <tr><td style="{cls._STYLE_TD}">{td["attendance_penalty"]}</td><td style="{penalty_style}">{penalty_text}</td></tr>
            <tr><td style="{cls._STYLE_TD_BOLD}">{td["total_50"]}</td><td style="{adj_style}">{adjusted} / 50</td></tr>
    </table>
        <p style="margin:16px 0 0; font-size:13px; color:#6b7280;">{td["contact"]}</p>
  </div>
</div>
</body></html>'''


    # ── New: Absence Report Email ────────────────────────────────────

    @classmethod
    def _build_absence_report_html(cls, student: Dict, lang: str = "en") -> str:
        banner = cls._status_banner(student, lang)
        td = T.get(lang, T["en"])
        direction = 'dir="rtl"' if lang == "ku" else 'dir="ltr"'
        
        hours = float(student.get("HoursAbsentTotal", 0) or 0)
        penalty = float(student.get("AttendancePenalty", 0) or 0)
        course_name = student.get("CourseName", "")
        name = student.get("FullName", "Student")

        hours_style = f"{cls._STYLE_TD}; font-weight:700;" + (" color:#ef4444;" if hours > 0 else "")
        penalty_style = f"{cls._STYLE_TD_BOLD};" + (" color:#ef4444;" if penalty > 0 else "")
        penalty_text = f"−{penalty:.2f} {td['pts']}" if penalty > 0 else f"{penalty:.2f} {td['pts']}"
        
        summary = td["absence_summary"].format(course=course_name)

        return f'''<html {direction}><head><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="{cls._STYLE_BODY}">
<div style="{cls._STYLE_CARD}">
    <div style="{cls._STYLE_HEADER}">
        <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">{td["absence_report"]}</h2>
        <p style="margin:0; font-size:13px; color:#6b7280;">{course_name}</p>
  </div>
    <div style="{cls._STYLE_SECTION}">
        <p style="margin:0 0 16px; font-size:14px;">{td["dear"]} <strong>{name}</strong>,</p>
    <p style="margin:0 0 16px; font-size:14px; color:#374151;">
            {summary}
    </p>
        {banner}
        <table style="{cls._STYLE_TABLE}">
            <tr><th style="{cls._STYLE_TH}">{td["detail"]}</th><th style="{cls._STYLE_TH}">{td["value"]}</th></tr>
            <tr><td style="{cls._STYLE_TD}">{td["total_absence_hours"]}</td><td style="{hours_style}">{hours:.1f} {td["hr_s"]}</td></tr>
            <tr><td style="{cls._STYLE_TD_BOLD}">{td["total_deducted"]}</td><td style="{penalty_style}">{penalty_text}</td></tr>
    </table>
        <p style="margin:16px 0 4px; font-size:13px; color:#6b7280;">{td["penalty_rule"]}</p>
        <p style="margin:0; font-size:13px; color:#6b7280;">{td["contact"]}</p>
  </div>
</div>
</body></html>'''


    # ── Send single email ────────────────────────────────────────────

    def _send_email(self, recipient_email: str, subject: str, html_body: str) -> None:
        if settings.email_provider == "resend_api":
            if not settings.resend_api_key:
                raise RuntimeError("RESEND_API_KEY is required when EMAIL_PROVIDER=resend_api")

            payload = {
                "from": settings.smtp_from,
                "to": [recipient_email],
                "subject": subject,
                "html": html_body,
            }
            body = json.dumps(payload).encode("utf-8")
            try:
                response = requests.post(
                    settings.resend_api_url,
                    data=body,
                    headers={
                        "Authorization": f"Bearer {settings.resend_api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=settings.resend_timeout_sec,
                )
            except requests.RequestException as exc:
                raise RuntimeError(f"Resend API network error: {exc}") from exc

            if response.status_code not in (200, 201, 202):
                raise RuntimeError(f"Resend API HTTP {response.status_code}: {response.text}")
            return

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

    def send_absentee_reports(self, session_id: str, lang: str = "en") -> Tuple[int, int]:
        students = self.repository.get_absent_and_late_for_session(session_id)
        sent = 0
        failed = 0

        for student in students:
            name = str(student.get("FullName", "Student"))
            is_late = bool(student.get("IsLate"))
            status_label = "Late Arrival" if is_late else "Absent"

            subject = f"Attendance Notice ({status_label}) — {name}"
            html_body = self._build_session_notification_html(student, lang)
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
        lang: str = "en",
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
                html_body = self._build_grade_report_html(student, lang)
            else:
                subject = f"Absence Report — {student_name}"
                html_body = self._build_absence_report_html(student, lang)

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

    def send_invite_email(
        self,
        student_email: str,
        full_name: str,
        full_name_kurdish,
        magic_link: str,
    ) -> None:
        if settings.smtp_dry_run:
            import logging
            logging.getLogger(__name__).info(
                "DRY RUN: invite email to %s suppressed", student_email
            )
            return
        import html as _html
        full_name = _html.escape(full_name)
        kurdish_name = _html.escape(full_name_kurdish or full_name)
        html = f"""<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #2a2a2a;">
    <div style="background:#fff;padding:24px 32px;">
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#0f0f0f;letter-spacing:-0.5px;">Attendify</h1>
    </div>
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
