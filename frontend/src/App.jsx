import { useCallback, useEffect, useRef, useState } from "react";

import { useApi, toWsBase } from "./hooks/useApi";
import { useSession } from "./hooks/useSession";
import { useCamera } from "./hooks/useCamera";
import { useDashboardSocket } from "./hooks/useDashboardSocket";
import { useEmail } from "./hooks/useEmail";

import { LoginPage } from "./components/LoginPage";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { StatCards } from "./components/dashboard/StatCards";
import { CameraFeed } from "./components/dashboard/CameraFeed";
import { AttendanceTable } from "./components/dashboard/AttendanceTable";
import { GradebookTable } from "./components/dashboard/GradebookTable";
import { EmailPanel } from "./components/dashboard/EmailPanel";
import { SessionHistory } from "./components/dashboard/SessionHistory";
import { cn } from "./lib/utils";

const DASH_DRAW_FPS = 30;

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
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function gradeDraftFromRow(row) {
  return {
    quiz1: Number(row.Quiz1 ?? 0).toFixed(2),
    quiz2: Number(row.Quiz2 ?? 0).toFixed(2),
    project: Number(row.ProjectGrade ?? 0).toFixed(2),
    assignment: Number(row.AssignmentGrade ?? 0).toFixed(2),
    midterm: Number(row.MidtermGrade ?? 0).toFixed(2),
    // Preserved but not shown in the edit UI — keeps the DB value intact on save
    final_exam: Number(row.FinalExamGrade ?? 0).toFixed(2),
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

  const [professor, setProfessor] = useState(() => {
    try {
      const saved = localStorage.getItem("ams_professor");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const handleLogin = (data) => {
    localStorage.setItem("ams_professor", JSON.stringify(data));
    setProfessor(data);
  };

  const handleLogout = () => {
    localStorage.removeItem("ams_professor");
    setProfessor(null);
  };

  // Global Hooks
  const { apiBase, apiFetch, courses, courseId, setCourseId, loadBootstrap, health } =
    useApi();
  const {
    sessionId,
    setSessionId,
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
    cameraDrops,
    startCamera,
    stopCamera,
    videoWorkerRef,
    captureCanvasRef,
    cameraActiveRef,
    setCameraDrops,
  } = useCamera(toWsBase, apiBase);

  const { overlayRef, connectDashboardSocket, closeDashboardSocket } =
    useDashboardSocket(toWsBase, apiBase);

  const { sending: emailSending, lastResult: emailLastResult, sendBulkEmail, clearResult: clearEmailResult } =
    useEmail(apiFetch);

  // Local State
  const [gradeEditor, setGradeEditor] = useState(null);
  const [gradeBusyByStudent, setGradeBusyByStudent] = useState({});
  const [attendanceBusyByStudent, setAttendanceBusyByStudent] = useState({});
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [sessionEndTime, setSessionEndTime] = useState(null);
  const [streamMetrics, setStreamMetrics] = useState({
    incomingFps: 0,
    drawFps: 0,
    renderDrops: 0,
    outgoingDrops: 0
  });

  // Canvas Refs
  const viewportRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);

  // Ref mirrors so drawOverlay can read current values without re-creating the callback
  const attendanceRef = useRef([]);
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);
  const sessionStartTimeRef = useRef(null);
  useEffect(() => { sessionStartTimeRef.current = sessionStartTime; }, [sessionStartTime]);

  // Derived Stats
  const enrolledCount = attendance ? attendance.length : gradebook.length;
  const presentCount = attendance.filter((r) => r.IsPresent).length;
  const absentCount = sessionId ? attendance.filter((r) => !r.IsPresent).length : 0;

  const renderRef = useRef({
    pendingFrame: null,
    drawBusy: false,
    lastDrawAt: 0,
    lastImageWidth: 0,
    lastImageHeight: 0,
    incomingWindow: 0,
    drawnWindow: 0,
    droppedWindow: 0,
  });

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

  // Sync course from logged-in professor
  useEffect(() => {
    if (professor?.course_id) {
      setCourseId(String(professor.course_id));
    }
  }, [professor, setCourseId]);

  // Bootstrap & Polling
  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);
  useEffect(() => {
    if (courseId) loadGradebook();
  }, [courseId, loadGradebook]);
  useEffect(() => {
    const timer = setInterval(() => {
      loadBootstrap({ silent: true });
      if (courseId) loadGradebook();
      if (sessionId) refreshAttendance();
    }, 15000);
    return () => clearInterval(timer);
  }, [courseId, loadBootstrap, loadGradebook, refreshAttendance, sessionId]);

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
      const label = recognized ? `${face.full_name || "Student"}` : "Unknown";

      let strokeColor;
      if (!recognized) {
        strokeColor = "#f59e0b"; // unknown face → amber
      } else {
        const row = attendanceRef.current.find(r => Number(r.StudentID) === Number(face.student_id));
        if (row && row.IsPresent) {
          strokeColor = "#10b981"; // present → green
        } else {
          if (row && row.ManualOverride) {
            // Manually marked absent — always red
            strokeColor = "#ef4444";
          } else {
            // Not yet arrived: yellow within the 10-min grace window, red after
            const start = sessionStartTimeRef.current;
            const sessionAgeMs = start ? Date.now() - start.getTime() : Infinity;
            strokeColor = sessionAgeMs <= 10 * 60 * 1000 ? "#f59e0b" : "#ef4444";
          }
        }
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.strokeRect(left, top, width, height);

      ctx.font = '500 12px "Inter", sans-serif';
      const textWidth = ctx.measureText(label).width;
      const padX = 8;
      const tagW = textWidth + padX * 2;
      const tagH = 24;
      const tagX = Math.min(Math.max(left, 2), Math.max(2, cssW - tagW - 2));
      const tagY = Math.max(2, top - tagH - 4);

      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 4);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, tagX + padX, tagY + 16);
    }
  }, [syncCanvas, overlayRef, cameraActiveRef]);

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
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
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
        ? new Date(presencePayload.recognized_at).toISOString()
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
    const render = renderRef.current;
    let rafId = 0;

    const frameLoop = () => {
      const video = videoWorkerRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        drawFrame(video);
        render.drawnWindow += 1;
      }
      rafId = requestAnimationFrame(frameLoop);
    };
    rafId = requestAnimationFrame(frameLoop);

    const metricTimer = setInterval(() => {
      const state = renderRef.current;
      setStreamMetrics({
        incomingFps: 0,
        drawFps: state.drawnWindow,
        renderDrops: 0,
        outgoingDrops: cameraDrops,
      });
      state.drawnWindow = 0;
      setCameraDrops(0);
    }, 1000);

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
      clearInterval(metricTimer);
      resizeObserver.disconnect();
    };
  }, [clearFrameCanvases, drawFrame, drawOverlay, setCameraDrops, cameraDrops, videoWorkerRef]);

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
      const result = await apiFinalizeSession();
      setSessionEndTime(endedAt);
      appendEvent(
        "success",
        `Lecture ended at ${endedAt.toLocaleTimeString()}. Emails sent=${result?.emails_sent}, failed=${result?.email_failures}`,
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

  if (!professor) {
    return <LoginPage apiBase={apiBase} onLogin={handleLogin} />;
  }

  return (
    <DashboardLayout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      theme={theme}
      onToggleTheme={toggleTheme}
      professor={professor}
      onLogout={handleLogout}
      headerAction={
        <button
          className={`h-8 px-4 rounded-sm font-medium text-xs transition-all duration-300 ease-in-out disabled:opacity-40 disabled:cursor-not-allowed ${sessionId
            ? "bg-bg text-fg border border-fg hover:bg-fg hover:text-bg"
            : "bg-fg text-bg hover:opacity-80"
            }`}
          onClick={sessionId ? handleFinalizeSession : handleStartSession}
          disabled={sessionBusy.starting || sessionBusy.finalizing || (!sessionId && !courseId)}
        >
          {sessionBusy.starting ? "Starting…" : sessionBusy.finalizing ? "Ending…" : sessionId ? "End Lecture" : "Start Lecture"}
        </button>
      }
    >
      {activeTab === 'dashboard' ? (
        <div className="space-y-6 animate-in fade-in duration-300">

          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="mb-2">
              <StatCards
                stats={[
                  {
                    label: "Enrolled",
                    value: enrolledCount,
                    hint: "Total students registered",
                    variant: "default",
                  },
                  {
                    label: "Present",
                    value: presentCount,
                    hint: "Detected & checked-in",
                    variant: "primary",
                  },
                  {
                    label: "Absent",
                    value: absentCount,
                    hint: sessionId ? "Not yet present" : "No active lecture",
                    variant: "danger",
                  },
                ]}
              />
            </div>

            <div className="grid gap-6 grid-cols-1 xl:grid-cols-12 min-h-[400px]">
              <div className="xl:col-span-5 h-full">
                <CameraFeed
                  cameraRunning={cameraRunning}
                  viewportRef={viewportRef}
                  frameCanvasRef={frameCanvasRef}
                  overlayCanvasRef={overlayCanvasRef}
                  streamMetrics={streamMetrics}
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
        </div>
      ) : activeTab === 'gradebook' ? (
        <div className="animate-in fade-in duration-300">
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
        <div className="animate-in fade-in duration-300">
          <div className="mt-2">
            <EmailPanel
              gradebook={gradebook}
              courseId={courseId}
              apiFetch={apiFetch}
              sending={emailSending}
              lastResult={emailLastResult}
              sendBulkEmail={sendBulkEmail}
              clearResult={clearEmailResult}
            />
          </div>
        </div>
      ) : activeTab === 'history' ? (
        <div className="animate-in fade-in duration-300">
          <div className="mt-2">
            <SessionHistory apiFetch={apiFetch} courseId={courseId} />
          </div>
        </div>
      ) : null}
      <video ref={videoWorkerRef} style={{ display: "none" }} playsInline />
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />
    </DashboardLayout>
  );
}
