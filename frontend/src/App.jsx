import { useCallback, useEffect, useRef, useState } from "react";

import { useApi, toWsBase } from "./hooks/useApi";
import { useSession } from "./hooks/useSession";
import { useCamera } from "./hooks/useCamera";
import { useDashboardSocket } from "./hooks/useDashboardSocket";
import { useEmail } from "./hooks/useEmail";
import { useEnrollment } from "./hooks/useEnrollment";

import { LoginPage } from "./components/auth/LoginPage";
import { PasswordSetup } from './components/student/PasswordSetup'
import { StudentPortal } from './components/student/StudentPortal'
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { StatCards } from "./components/dashboard/StatCards";
import { CameraFeed } from "./components/dashboard/CameraFeed";
import { AttendanceTable } from "./components/dashboard/AttendanceTable";
import { GradebookTable } from "./components/dashboard/GradebookTable";
import { EmailPanel } from "./components/dashboard/EmailPanel";
import { SessionHistory } from "./components/dashboard/SessionHistory";
import { EnrollmentModal } from "./components/enrollment/EnrollmentModal";
import { EnrollmentTab } from "./components/enrollment/EnrollmentTab";
import { SettingsTab } from "./components/settings/SettingsTab";
import { I18nProvider } from "./lib/i18n";
import { translations } from "./lib/translations";
import { parseDateSafe } from "./lib/dateFormatter";

// Cover: scale to fill the target, cropping the overflow (no black bars)
function coverRect(sourceW, sourceH, targetW, targetH) {
  if (!sourceW || !sourceH || !targetW || !targetH)
    return { x: 0, y: 0, w: targetW || 0, h: targetH || 0 };
  const sourceRatio = sourceW / sourceH;
  const targetRatio = targetW / targetH;
  if (sourceRatio > targetRatio) {
    // source is wider — match heights, overflow horizontally
    const h = targetH;
    const w = h * sourceRatio;
    return { x: (targetW - w) / 2, y: 0, w, h };
  }
  // source is taller — match widths, overflow vertically
  const w = targetW;
  const h = w / sourceRatio;
  return { x: 0, y: (targetH - h) / 2, w, h };
}

function parseGradeValue(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function gradeDraftFromRow(row) {
  const fmtGrade = (v) => v == null ? "" : Number(v).toFixed(2);
  return {
    quiz1: fmtGrade(row.Quiz1),
    quiz2: fmtGrade(row.Quiz2),
    project: fmtGrade(row.ProjectGrade),
    assignment: fmtGrade(row.AssignmentGrade),
    midterm: fmtGrade(row.MidtermGrade),
    // Preserved but not shown in the edit UI — keeps the DB value intact on save
    final_exam: fmtGrade(row.FinalExamGrade),
    hours_absent: Number(row.HoursAbsentTotal ?? 0).toFixed(1),
  };
}

export default function App() {
  const [activeTab, _setActiveTab] = useState(() => {
    return localStorage.getItem("ams_active_tab") || 'dashboard';
  });

  const setActiveTab = useCallback((tab) => {
    localStorage.setItem("ams_active_tab", tab);
    _setActiveTab(tab);
  }, []);
  const [theme, setTheme] = useState(() => {
    if (localStorage.getItem("ams_theme_manual") === "true") {
      const saved = localStorage.getItem("ams_theme");
      if (saved === "light" || saved === "dark") return saved;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  const [language, setLanguage] = useState(() => localStorage.getItem("ams_language") || "en");
  const handleChangeLanguage = useCallback((lang) => {
    setLanguage(lang);
    localStorage.setItem("ams_language", lang);
  }, []);

  const [sendEmailsOnFinalize, setSendEmailsOnFinalize] = useState(() => {
    const saved = localStorage.getItem("ams_send_emails_on_finalize");
    return saved === null ? true : saved === "true";
  });
  const handleToggleSendEmails = useCallback((val) => {
    setSendEmailsOnFinalize(val);
    localStorage.setItem("ams_send_emails_on_finalize", String(val));
  }, []);

  const [professor, setProfessor] = useState(() => {
    try {
      const saved = localStorage.getItem("ams_professor");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [student, setStudent] = useState(() => {
    try {
      const saved = localStorage.getItem('ams_student')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [inviteToken, setInviteToken] = useState(null)

  const handleLogin = (data) => {
    const { access_token, role, ...profile } = data
    if (access_token) localStorage.setItem('ams_token', access_token)
    if (role === 'student') {
      localStorage.setItem('ams_student', JSON.stringify({ ...profile, role }))
      setStudent({ ...profile, role })
    } else {
      localStorage.setItem('ams_professor', JSON.stringify({ ...profile, role: 'professor' }))
      setProfessor({ ...profile, role: 'professor' })
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("ams_professor");
    localStorage.removeItem("ams_token");
    setProfessor(null);
  };

  const handleStudentLogout = () => {
    localStorage.removeItem('ams_token')
    localStorage.removeItem('ams_student')
    setStudent(null)
    setInviteToken(null)
  }

  // Global Hooks
  const { apiBase, apiFetch, courseId, setCourseId, loadBootstrap } = useApi();
  const {
    sessionId,
    gradebook,
    setGradebook,
    attendance,
    setAttendance,
    busy: sessionBusy,
    startSession: apiStartSession,
    finalizeSession: apiFinalizeSession,
    loadGradebook,
    refreshAttendance,
  } = useSession(apiFetch, courseId);

  const {
    cameraRunning,
    startCamera,
    stopCamera,
    videoWorkerRef,
    captureCanvasRef,
    cameraActiveRef,
  } = useCamera(toWsBase, apiBase);

  const { overlayRef, connectDashboardSocket, closeDashboardSocket } =
    useDashboardSocket(toWsBase, apiBase);

  const { sending: emailSending, sendBulkEmail, clearResult: clearEmailResult } = useEmail(apiFetch);

  const enrollment = useEnrollment(apiBase);
  const [enrollmentTarget, setEnrollmentTarget] = useState(null); // { studentId, fullName }

  const openEnrollment = useCallback((studentId, fullName) => {
    setEnrollmentTarget({ studentId, fullName });
  }, []);

  const navigationLocked = Boolean(enrollmentTarget);

  const closeEnrollment = useCallback(() => {
    enrollment.stopEnrollment();
    enrollment.setComplete(false);
    enrollment.setError(null);
    setEnrollmentTarget(null);
  }, [enrollment]);

  const handleStartEnrollment = useCallback(() => {
    if (enrollmentTarget) {
      enrollment.startEnrollment(enrollmentTarget.studentId);
    }
  }, [enrollment, enrollmentTarget]);

  // Local State
  const [gradeEditor, setGradeEditor] = useState(null);
  const [gradeBusyByStudent, setGradeBusyByStudent] = useState({});
  const [attendanceBusyByStudent, setAttendanceBusyByStudent] = useState({});
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [sessionEndTime, setSessionEndTime] = useState(null);
  // Canvas Refs
  const viewportRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);

  // Ref mirrors so drawOverlay can read current values without re-creating the callback
  const attendanceRef = useRef([]);
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);
  const sessionStartTimeRef = useRef(null);
  useEffect(() => { sessionStartTimeRef.current = sessionStartTime; }, [sessionStartTime]);

  const t = useCallback((key) => translations[language]?.[key] || translations['en']?.[key] || key, [language]);

  // Derived Stats
  const enrolledCount = attendance ? attendance.length : gradebook.length;
  const presentCount = attendance.filter((r) => r.IsPresent).length;
  const absentCount = sessionId ? attendance.filter((r) => !r.IsPresent).length : 0;

  const renderRef = useRef({ lastImageWidth: 0, lastImageHeight: 0 });

  // Theme: follow prefers-color-scheme unless the user has toggled manually
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (localStorage.getItem("ams_theme_manual") === "true") {
      localStorage.setItem("ams_theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (localStorage.getItem("ams_theme_manual") === "true") return;
      setTheme(mq.matches ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("ams_theme_manual", "true");
      localStorage.setItem("ams_theme", next);
      return next;
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (!invite) return
    window.history.replaceState({}, '', '/')
    fetch(`${apiBase}/api/auth/invite?token=${encodeURIComponent(invite)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Invalid link')
        setInviteToken(data.access_token)
      })
      .catch((err) => console.error('Invite link error:', err.message))
  }, [])

  // Sync course from logged-in professor
  useEffect(() => {
    if (professor?.course_id) {
      setCourseId(String(professor.course_id));
    }
  }, [professor, setCourseId]);

  // Bootstrap & Polling — only run when authenticated
  useEffect(() => {
    if (!professor) return;
    loadBootstrap();
  }, [professor, loadBootstrap]);
  useEffect(() => {
    if (!professor) return;
    if (courseId) loadGradebook();
  }, [professor, courseId, loadGradebook]);
  useEffect(() => {
    if (!professor) return;
    const timer = setInterval(() => {
      loadBootstrap({ silent: true });
      if (courseId) loadGradebook();
      if (sessionId) refreshAttendance();
    }, 15000);
    return () => clearInterval(timer);
  }, [professor, courseId, loadBootstrap, loadGradebook, refreshAttendance, sessionId]);

  // Events
  const appendEvent = useCallback((level, message, details = null) => {
    if (level === "error")
      console.error(`[dashboard] ${message}`, details || "");
    else if (level === "warning")
      console.warn(`[dashboard] ${message}`, details || "");
    else console.log(`[dashboard] ${message}`, details || "");
  }, []);

  // Canvas Drawing
  const syncCanvas = useCallback((canvas) => {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    return { cssW, cssH, dpr };
  }, []);

  const drawOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const info = syncCanvas(overlayCanvas);
    if (!info) return;
    const ctx = overlayCanvas.getContext("2d");
    if (!ctx) return;
    const { cssW, cssH, dpr } = info;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const payload = overlayRef.current;
    if (!payload?.faces?.length || !cameraActiveRef.current) return;
    const isRtl = language === "ckb";

    const sourceW = payload.frameWidth || renderRef.current.lastImageWidth;
    const sourceH = payload.frameHeight || renderRef.current.lastImageHeight;
    if (!sourceW || !sourceH) return;

    const fit = coverRect(sourceW, sourceH, cssW, cssH);
    for (const face of payload.faces) {
      const left = fit.x + (Number(face.left || 0) / sourceW) * fit.w;
      const top = fit.y + (Number(face.top || 0) / sourceH) * fit.h;
      const right = fit.x + (Number(face.right || 0) / sourceW) * fit.w;
      const bottom = fit.y + (Number(face.bottom || 0) / sourceH) * fit.h;
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);

      const recognized = face.event_type === "recognized";
      const isSpoof = face.event_type === "spoof";
      const isVerifying = face.event_type === "verifying";
      const absentHours = Number(face.session_absent_hours ?? 0);
      const isLate = recognized && absentHours > 0;

      let label;
      if (isSpoof) {
        label = face.full_name || t("status_spoof");
      } else if (isVerifying) {
        label = face.full_name || t("status_verifying");
      } else if (!recognized) {
        label = t("status_unknown");
      } else if (isLate) {
        label = `${face.full_name || "Student"} — ${t("status_late")} (${absentHours}h)`;
      } else {
        label = face.full_name || "Student";
      }

      let strokeColor;
      if (isSpoof) {
        strokeColor = "#dc2626"; // spoof → red-600
      } else if (isVerifying) {
        strokeColor = "#3b82f6"; // verifying → blue-500
      } else if (!recognized) {
        strokeColor = "#f59e0b"; // unknown → amber
      } else if (isLate) {
        strokeColor = "#ef4444"; // late arrival → red
      } else {
        const row = attendanceRef.current.find(r => Number(r.StudentID) === Number(face.student_id));
        if (row && row.ManualOverride && !row.IsPresent) {
          strokeColor = "#ef4444"; // manually marked absent → red
        } else {
          strokeColor = "#10b981"; // on time → green
        }
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isSpoof ? 3 : 2;
      ctx.lineJoin = "round";
      ctx.strokeRect(left, top, width, height);

      // Diagonal stripes for spoof detections.
      if (isSpoof) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.strokeStyle = "rgba(220,38,38,0.3)";
        ctx.lineWidth = 1;
        const step = 12;
        for (let d = -height; d < width; d += step) {
          ctx.beginPath();
          ctx.moveTo(left + d, top);
          ctx.lineTo(left + d + height, top + height);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.font = '500 12px "Inter", sans-serif';
      const textWidth = ctx.measureText(label).width;
      const padX = 8;
      const tagW = textWidth + padX * 2;
      const tagH = 24;
      const preferredX = isRtl ? (right - tagW) : left;
      const tagX = Math.min(Math.max(preferredX, 2), Math.max(2, cssW - tagW - 2));
      const tagY = Math.max(2, top - tagH - 4);

      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 4);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      // Keep camera labels visually aligned in both LTR and RTL languages.
      ctx.textAlign = isRtl ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, isRtl ? (tagX + tagW - padX) : (tagX + padX), tagY + 16);
      ctx.textAlign = "left";
    }
  }, [syncCanvas, overlayRef, cameraActiveRef, language, t]);

  const drawFrame = useCallback(
    (img) => {
      const frameCanvas = frameCanvasRef.current;
      if (!frameCanvas) return;
      const info = syncCanvas(frameCanvas);
      if (!info) return;
      const ctx = frameCanvas.getContext("2d");
      if (!ctx) return;
      const { cssW, cssH, dpr } = info;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const sourceW = img.videoWidth || img.naturalWidth || img.width;
      const sourceH = img.videoHeight || img.naturalHeight || img.height;
      if (!sourceW || !sourceH) return;

      renderRef.current.lastImageWidth = sourceW;
      renderRef.current.lastImageHeight = sourceH;

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, cssW, cssH);

      const fit = coverRect(sourceW, sourceH, cssW, cssH);
      ctx.save();
      ctx.translate(cssW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
      ctx.restore();
      drawOverlay();
    },
    [drawOverlay, syncCanvas],
  );

  const clearFrameCanvases = useCallback(() => {
    overlayRef.current = { frameWidth: 0, frameHeight: 0, faces: [] };
    for (const canvas of [frameCanvasRef.current, overlayCanvasRef.current]) {
      if (!canvas) continue;
      const info = syncCanvas(canvas);
      if (!info) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(info.dpr, 0, 0, info.dpr, 0, 0);
      ctx.clearRect(0, 0, info.cssW, info.cssH);
      if (canvas === frameCanvasRef.current) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, info.cssW, info.cssH);
      }
    }
  }, [syncCanvas, overlayRef]);

  // Clear canvas to black whenever camera is turned off
  useEffect(() => {
    if (!cameraRunning) clearFrameCanvases();
  }, [cameraRunning, clearFrameCanvases]);

  const applyPresenceToAttendance = useCallback(
    (presencePayload) => {
      const studentId = Number(presencePayload?.student_id);
      if (!Number.isFinite(studentId)) return;
      const eventAt = presencePayload?.recognized_at
        ? parseDateSafe(presencePayload.recognized_at).toISOString()
        : new Date().toISOString();
      setAttendance((prev) =>
        prev.map((row) => {
          if (Number(row.StudentID) !== studentId) return row;
          return {
            ...row,
            IsPresent: presencePayload?.is_present === false ? 0 : 1,
            FirstSeenAt: row.FirstSeenAt || eventAt,
            LastSeenAt: eventAt,
          };
        }),
      );
    },
    [setAttendance],
  );

  // Render Loop — draws directly from local <video> element (zero network latency)
  useEffect(() => {
    let rafId = 0;

    const frameLoop = () => {
      const video = videoWorkerRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0)
        drawFrame(video);
      rafId = requestAnimationFrame(frameLoop);
    };
    rafId = requestAnimationFrame(frameLoop);

    const resizeObserver = new ResizeObserver(() => {
      const video = videoWorkerRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0)
        drawFrame(video);
      else clearFrameCanvases();
      drawOverlay();
    });
    if (viewportRef.current) resizeObserver.observe(viewportRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [clearFrameCanvases, drawFrame, drawOverlay, videoWorkerRef]);

  // Session Handlers
  const handleStartSession = async () => {
    if (!courseId) return appendEvent("warning", "Select a course first");
    try {
      const now = new Date();
      const sid = await apiStartSession();
      setSessionStartTime(now);
      setSessionEndTime(null);
      clearFrameCanvases();
      if (cameraActiveRef.current) stopCamera();
      connectDashboardSocket(sid, {
        appendEvent,
        applyPresenceToAttendance,
        refreshAttendance,
        drawOverlay,
      });
      await Promise.all([refreshAttendance(sid), loadGradebook()]);
      await startCamera(sid, appendEvent);
      appendEvent("success", `Lecture started at ${now.toLocaleTimeString()} for course ${courseId}`);
    } catch (err) { }
  };

  const handleFinalizeSession = async () => {
    try {
      const endedAt = new Date();
      const result = await apiFinalizeSession(sendEmailsOnFinalize);
      setSessionEndTime(endedAt);
      appendEvent(
        "success",
        sendEmailsOnFinalize
          ? `Lecture ended at ${endedAt.toLocaleTimeString()}. Absence emails queued.`
          : `Lecture ended at ${endedAt.toLocaleTimeString()}. Email notifications are disabled.`,
      );
      await Promise.all([loadGradebook(), refreshAttendance()]);
      stopCamera();
    } catch (err) { }
  };

  const toggleCamera = () => {
    if (cameraRunning) stopCamera();
    else startCamera(sessionId, appendEvent);
  };

  // Attendance & Grade Handlers
  const markManualAttendance = async (studentId, fullName, mode) => {
    if (!sessionId)
      return appendEvent(
        "warning",
        "Start a lecture before marking attendance",
      );
    const payload = mode === "absent"
      ? { is_present: false }
      : { is_present: true };
    setAttendanceBusyByStudent((prev) => ({ ...prev, [studentId]: true }));
    try {
      await apiFetch(
        `/api/sessions/${sessionId}/students/${studentId}/attendance`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      await refreshAttendance();
      appendEvent("success", `Attendance marked ${mode} for ${fullName}`);
    } catch (err) {
      appendEvent("error", `Manual attendance update failed: ${err.message}`);
    } finally {
      setAttendanceBusyByStudent((prev) => ({ ...prev, [studentId]: false }));
    }
  };

  const saveGradeEdit = async (studentId) => {
    if (
      !courseId ||
      !gradeEditor ||
      Number(gradeEditor.studentId) !== Number(studentId)
    )
      return;
    const payload = {
      quiz1: parseGradeValue(gradeEditor.values.quiz1),
      quiz2: parseGradeValue(gradeEditor.values.quiz2),
      project: parseGradeValue(gradeEditor.values.project),
      assignment: parseGradeValue(gradeEditor.values.assignment),
      midterm: parseGradeValue(gradeEditor.values.midterm),
      final_exam: parseGradeValue(gradeEditor.values.final_exam),
      hours_absent_total: parseGradeValue(gradeEditor.values.hours_absent),
    };
    setGradeBusyByStudent((prev) => ({ ...prev, [studentId]: true }));
    try {
      const result = await apiFetch(
        `/api/courses/${courseId}/students/${studentId}/grades`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      if (result?.data)
        setGradebook((prev) =>
          prev.map((row) =>
            Number(row.StudentID) === Number(studentId) ? result.data : row,
          ),
        );
      else await loadGradebook();
      appendEvent(
        "success",
        `Grades updated for ${gradeEditor.fullName || `Student ${studentId}`}`,
      );
      setGradeEditor(null);
    } catch (err) {
      appendEvent("error", `Manual grade update failed: ${err.message}`);
    } finally {
      setGradeBusyByStudent((prev) => ({ ...prev, [studentId]: false }));
    }
  };

  const updateGradeDraftField = (field, value) => {
    setGradeEditor((prev) =>
      prev ? { ...prev, values: { ...prev.values, [field]: value } } : prev,
    );
  };

  // Magic link invite — show password setup
  if (inviteToken) {
    return (
      <I18nProvider language={language}>
        <PasswordSetup
          apiBase={apiBase}
          token={inviteToken}
          onComplete={(data) => {
            setInviteToken(null)
            handleLogin(data)
          }}
        />
      </I18nProvider>
    )
  }

  // Student portal
  if (student) {
    return (
      <I18nProvider language={language}>
        <StudentPortal
          apiBase={apiBase}
          student={student}
          onLogout={handleStudentLogout}
          theme={theme}
          toggleTheme={() => {
            const next = theme === 'dark' ? 'light' : 'dark'
            setTheme(next)
            localStorage.setItem('ams_theme', next)
            localStorage.setItem('ams_theme_manual', 'true')
          }}
          language={language}
          toggleLanguage={() => {
            const next = language === 'en' ? 'ckb' : 'en'
            setLanguage(next)
            localStorage.setItem('ams_language', next)
          }}
        />
      </I18nProvider>
    )
  }

  // Professor login gate
  if (!professor) {
    return (
      <I18nProvider language={language}>
        <LoginPage apiBase={apiBase} onLogin={handleLogin} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={language}>
      <DashboardLayout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      professor={professor}
      onLogout={handleLogout}
      navigationLocked={navigationLocked}
      headerAction={
        <button
          className={`h-8 px-3 sm:px-4 rounded-sm font-medium text-[11px] sm:text-xs transition-all duration-300 ease-in-out cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${sessionId
            ? "bg-bg text-fg border border-fg hover:bg-fg hover:text-bg"
            : "bg-fg text-bg hover:opacity-80"
            }`}
          onClick={sessionId ? handleFinalizeSession : handleStartSession}
          disabled={navigationLocked || sessionBusy.starting || sessionBusy.finalizing || (!sessionId && !courseId)}
        >
          {sessionBusy.starting ? t("session_starting") : sessionBusy.finalizing ? t("session_ending") : sessionId ? t("session_end") : t("session_start")}
        </button>
      }
    >
      {activeTab === 'dashboard' ? (
        <div className="space-y-4 sm:space-y-6 animate-fade-in">
          <div className="mb-1 sm:mb-2">
            <StatCards
              stats={[
                {
                  label: t("stat_enrolled"),
                  value: enrolledCount,
                  hint: t("stat_enrolled_hint"),
                  variant: "default",
                },
                {
                  label: t("stat_present"),
                  value: presentCount,
                  hint: t("stat_present_hint"),
                  variant: "primary",
                },
                {
                  label: t("stat_absent"),
                  value: absentCount,
                  hint: sessionId ? t("stat_absent_hint") : t("stat_absent_inactive"),
                  variant: "danger",
                },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:gap-6 grid-cols-1 xl:grid-cols-12 min-h-[300px] sm:min-h-[400px]">
            <div className="xl:col-span-5 h-full">
              <CameraFeed
                cameraRunning={cameraRunning}
                viewportRef={viewportRef}
                frameCanvasRef={frameCanvasRef}
                overlayCanvasRef={overlayCanvasRef}
                toggleCamera={toggleCamera}
                sessionId={sessionId}
              />
            </div>

            <div className="xl:col-span-7 h-full">
              <AttendanceTable
                attendance={attendance}
                sessionId={sessionId}
                sessionStartTime={sessionStartTime}
                sessionEndTime={sessionEndTime}
                markManualAttendance={markManualAttendance}
                attendanceBusyByStudent={attendanceBusyByStudent}
              />
            </div>
          </div>
        </div>
      ) : activeTab === 'enrollment' ? (
        <div className="animate-fade-in">
          <EnrollmentTab
            apiFetch={apiFetch}
            courseId={courseId}
            onEnrollStudent={openEnrollment}
          />
        </div>
      ) : activeTab === 'gradebook' ? (
        <div className="animate-fade-in">
          <div className="mt-2">

            <GradebookTable
              gradebook={gradebook}
              gradeEditor={gradeEditor}
              gradeBusyByStudent={gradeBusyByStudent}
              startGradeEdit={(row) =>
                setGradeEditor({
                  studentId: Number(row.StudentID),
                  fullName: row.FullName,
                  values: gradeDraftFromRow(row),
                })
              }
              cancelGradeEdit={() => setGradeEditor(null)}
              updateGradeDraftField={updateGradeDraftField}
              saveGradeEdit={saveGradeEdit}
            />
          </div>

        </div>
      ) : activeTab === 'email' ? (
        <div className="animate-fade-in">
          <div className="mt-2">
            <EmailPanel
              gradebook={gradebook}
              courseId={courseId}
              sending={emailSending}
              sendBulkEmail={sendBulkEmail}
              clearResult={clearEmailResult}
            />
          </div>
        </div>
      ) : activeTab === 'history' ? (
        <div className="animate-fade-in">
          <div className="mt-2">
            <SessionHistory apiFetch={apiFetch} courseId={courseId} activeSessionId={sessionId} />
          </div>
        </div>
      ) : activeTab === 'settings' ? (
        <SettingsTab
          theme={theme}
          onToggleTheme={toggleTheme}
          language={language}
          onChangeLanguage={handleChangeLanguage}
          sendEmailsOnFinalize={sendEmailsOnFinalize}
          onToggleSendEmails={handleToggleSendEmails}
          apiFetch={apiFetch}
          courseId={courseId}
          professor={professor}
          onProfileUpdate={handleLogin}
          onReset={() => { loadGradebook(); refreshAttendance(); }}
        />
      ) : null}
      <video ref={videoWorkerRef} style={{ display: "none" }} playsInline />
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />

      {enrollmentTarget && (
        <EnrollmentModal
          studentName={enrollmentTarget.fullName}
          enrolling={enrollment.enrolling}
          currentPose={enrollment.currentPose}
          poseMessage={enrollment.poseMessage}
          progress={enrollment.progress}
          totalPoses={enrollment.totalPoses}
          error={enrollment.error}
          complete={enrollment.complete}
          rejected={enrollment.rejected}
          onStart={handleStartEnrollment}
          onClose={closeEnrollment}
          videoRef={enrollment.videoRef}
          canvasRef={enrollment.canvasRef}
        />
      )}
    </DashboardLayout>
    </I18nProvider>
  );
}
