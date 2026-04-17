import re

TRANSLATIONS = """
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
"""

with open("backend/app/services/email_service.py", "r", encoding="utf-8") as f:
    text = f.read()

# Insert T
text = text.replace("class EmailService:\n", TRANSLATIONS + "\nclass EmailService:\n")

# Replace _STYLE_BODY
text = text.replace(
    '_STYLE_BODY = \'font-family: "Segoe UI", Arial, sans-serif; color: #1f2937; background: #f9fafb; margin: 0; padding: 32px 0;\'',
    '_STYLE_BODY = \'font-family: "Vazirmatn", "Segoe UI", Arial, sans-serif; color: #1f2937; background: #f9fafb; margin: 0; padding: 32px 0;\''
)

# Replace status_banner
text = re.sub(
    r"@staticmethod\n\s+def _status_banner\(student: Dict\) -> str:\n.*?return \"\"(?:(?!\s*# ──).)*",
    """@staticmethod
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
""",
    text, flags=re.DOTALL
)

# replace _build_session_notification_html
text = re.sub(
    r"@classmethod\n\s+def _build_session_notification_html\(cls, student: Dict\) -> str:\n.*?</body></html>\"\"\"",
    """@classmethod
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

        return f'''<html {direction}><head><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="{{cls._STYLE_BODY}}">
<div style="{{cls._STYLE_CARD}}">
  <div style="{{cls._STYLE_HEADER}}">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">{{td["attend_notice"]}} — {{status_label}}</h2>
    <p style="margin:0; font-size:13px; color:#6b7280;">{{course_name}}</p>
  </div>
  <div style="{{cls._STYLE_SECTION}}">
    <p style="margin:0 0 16px; font-size:14px;">{{td["dear"]}} <strong>{{name}}</strong>,</p>
    <p style="margin:0 0 16px; font-size:14px; color:#374151;">{{session_desc}}</p>
    {{banner}}
    <table style="{{cls._STYLE_TABLE}}">
      <tr><th style="{{cls._STYLE_TH}}">{{td["detail"]}}</th><th style="{{cls._STYLE_TH}}">{{td["value"]}}</th></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["status_session"]}}</td><td style="{{cls._STYLE_TD}}; font-weight:700; color:#b45309;">{{status_label}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["hrs_session"]}}</td><td style="{{cls._STYLE_TD}}; font-weight:700; color:#ef4444;">{{session_hours:.1f}} {{td["hr_s"]}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["deducted_session"]}}</td><td style="{{cls._STYLE_TD}}; color:#ef4444;">−{{session_penalty:.2f}} {{td["pts"]}}</td></tr>
      <tr><td style="{{cls._STYLE_TD_BOLD}}">{{td["total_hrs"]}}</td><td style="{{cls._STYLE_TD_BOLD}}">{{total_hours:.1f}} {{td["hr_s"]}}</td></tr>
    </table>
    <p style="margin:16px 0 4px; font-size:13px; color:#6b7280;">{{td["penalty_rule"]}}</p>
    <p style="margin:0; font-size:13px; color:#6b7280;">{{td["contact"]}}</p>
  </div>
</div>
</body></html>'''""",
    text, flags=re.DOTALL
)

# Replace _build_grade_report_html
text = re.sub(
    r"@classmethod\n\s+def _build_grade_report_html\(cls, student: Dict\) -> str:\n.*?</body></html>\"\"\"",
    """@classmethod
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
        penalty_text = f"−{penalty:.2f} {{td['pts']}}" if penalty > 0 else f"{penalty:.2f} {{td['pts']}}"

        return f'''<html {direction}><head><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="{{cls._STYLE_BODY}}">
<div style="{{cls._STYLE_CARD}}">
  <div style="{{cls._STYLE_HEADER}}">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">{{td["grade_report"]}}</h2>
    <p style="margin:0; font-size:13px; color:#6b7280;">{{student['CourseName']}}</p>
  </div>
  <div style="{{cls._STYLE_SECTION}}">
    <p style="margin:0 0 16px; font-size:14px;">{{td["dear"]}} <strong>{{student['FullName']}}</strong>,</p>
    {{banner}}
    <table style="{{cls._STYLE_TABLE}}">
      <tr><th style="{{cls._STYLE_TH}}">{{td["component"]}}</th><th style="{{cls._STYLE_TH}}">{{td["grade"]}}</th></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["quiz1"]}}</td><td style="{{q1_style}}">{{student['Quiz1']}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["quiz2"]}}</td><td style="{{q2_style}}">{{student['Quiz2']}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["project"]}}</td><td style="{{proj_style}}">{{student['ProjectGrade']}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["assignment"]}}</td><td style="{{assn_style}}">{{student['AssignmentGrade']}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["midterm"]}}</td><td style="{{mid_style}}">{{student['MidtermGrade']}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["total_absence_hours"]}}</td><td style="{{hours_style}}">{{hours:.1f}} {{td["hr_s"]}}</td></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["attendance_penalty"]}}</td><td style="{{penalty_style}}">{{penalty_text}}</td></tr>
      <tr><td style="{{cls._STYLE_TD_BOLD}}">{{td["total_50"]}}</td><td style="{{adj_style}}">{{adjusted}} / 50</td></tr>
    </table>
    <p style="margin:16px 0 0; font-size:13px; color:#6b7280;">{{td["contact"]}}</p>
  </div>
</div>
</body></html>'''""",
    text, flags=re.DOTALL
)

# Replace _build_absence_report_html
text = re.sub(
    r"@classmethod\n\s+def _build_absence_report_html\(cls, student: Dict\) -> str:\n.*?</body></html>\"\"\"",
    """@classmethod
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
        penalty_text = f"−{penalty:.2f} {{td['pts']}}" if penalty > 0 else f"{penalty:.2f} {{td['pts']}}"
        
        summary = td["absence_summary"].format(course=course_name)

        return f'''<html {direction}><head><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="{{cls._STYLE_BODY}}">
<div style="{{cls._STYLE_CARD}}">
  <div style="{{cls._STYLE_HEADER}}">
    <h2 style="margin:0 0 4px; font-size:18px; color:#111827;">{{td["absence_report"]}}</h2>
    <p style="margin:0; font-size:13px; color:#6b7280;">{{course_name}}</p>
  </div>
  <div style="{{cls._STYLE_SECTION}}">
    <p style="margin:0 0 16px; font-size:14px;">{{td["dear"]}} <strong>{{name}}</strong>,</p>
    <p style="margin:0 0 16px; font-size:14px; color:#374151;">
      {{summary}}
    </p>
    {{banner}}
    <table style="{{cls._STYLE_TABLE}}">
      <tr><th style="{{cls._STYLE_TH}}">{{td["detail"]}}</th><th style="{{cls._STYLE_TH}}">{{td["value"]}}</th></tr>
      <tr><td style="{{cls._STYLE_TD}}">{{td["total_absence_hours"]}}</td><td style="{{hours_style}}">{{hours:.1f}} {{td["hr_s"]}}</td></tr>
      <tr><td style="{{cls._STYLE_TD_BOLD}}">{{td["total_deducted"]}}</td><td style="{{penalty_style}}">{{penalty_text}}</td></tr>
    </table>
    <p style="margin:16px 0 4px; font-size:13px; color:#6b7280;">{{td["penalty_rule"]}}</p>
    <p style="margin:0; font-size:13px; color:#6b7280;">{{td["contact"]}}</p>
  </div>
</div>
</body></html>'''""",
    text, flags=re.DOTALL
)

# Update method signatures in send_absentee_reports
text = text.replace(
    'def send_absentee_reports(self, session_id: str) -> Tuple[int, int]:',
    'def send_absentee_reports(self, session_id: str, lang: str = "en") -> Tuple[int, int]:'
)
text = text.replace(
    'html_body = self._build_session_notification_html(student)',
    'html_body = self._build_session_notification_html(student, lang)'
)

# Update send_bulk_emails
text = text.replace(
    'def send_bulk_emails(\n        self,\n        students: List[Dict[str, Any]],\n        email_type: str,\n    ) -> Dict[str, Any]:',
    'def send_bulk_emails(\n        self,\n        students: List[Dict[str, Any]],\n        email_type: str,\n        lang: str = "en",\n    ) -> Dict[str, Any]:'
)
text = text.replace(
    'html_body = self._build_grade_report_html(student)',
    'html_body = self._build_grade_report_html(student, lang)'
)
text = text.replace(
    'html_body = self._build_absence_report_html(student)',
    'html_body = self._build_absence_report_html(student, lang)'
)


with open("backend/app/services/email_service.py", "w", encoding="utf-8") as fw:
    fw.write(text)

print("Patch applied")
