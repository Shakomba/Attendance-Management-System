import { useCallback, useEffect, useRef, useState } from "react";

import { useApi, toWsBase } from "./hooks/useApi";
import { useSession } from "./hooks/useSession";
import { useCamera } from "./hooks/useCamera";
import { useDashboardSocket } from "./hooks/useDashboardSocket";

import { DashboardLayout } from "./components/layout/DashboardLayout";
import { StatCards } from "./components/dashboard/StatCards";
import { CameraFeed } from "./components/dashboard/CameraFeed";
import { AttendanceTable } from "./components/dashboard/AttendanceTable";
import { GradebookTable } from "./components/dashboard/GradebookTable";
import { cn } from "./lib/utils";

const DASH_DRAW_FPS = 30;

// Utility for scaling overlay
function containRect(sourceW, sourceH, targetW, targetH) {
  if (!sourceW || !sourceH || !targetW || !targetH)
    return { x: 0, y: 0, w: targetW || 0, h: targetH || 0 };
  const sourceRatio = sourceW / sourceH;
  const targetRatio = targetW / targetH;
  if (sourceRatio > targetRatio) {
    const w = targetW;
    const h = w / sourceRatio;
    return { x: 0, y: (targetH - h) / 2, w, h };
  }
  const h = targetH;
  const w = h * sourceRatio;
  return { x: (targetW - w) / 2, y: 0, w, h };
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
    final_exam: Number(row.FinalExamGrade ?? 0).toFixed(2),
  };
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("ams_theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

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

  // Local State
  const [gradeEditor, setGradeEditor] = useState(null);
  const [gradeBusyByStudent, setGradeBusyByStudent] = useState({});
  const [attendanceBusyByStudent, setAttendanceBusyByStudent] = useState({});
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

  // Derived Stats
  const enrolledCount = attendance ? attendance.length : gradebook.length;
  const presentCount = attendance.filter((r) => r.IsPresent).length;
  const lateCount = attendance.filter((r) => r.IsPresent && r.IsLate).length;
  const atRiskCount = gradebook.filter((r) => r.AtRiskByPolicy).length;

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

  // Theme Sync
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("ams_theme", theme);
  }, [theme]);

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
    if (!payload?.faces?.length) return;

    const sourceW = payload.frameWidth || renderRef.current.lastImageWidth;
    const sourceH = payload.frameHeight || renderRef.current.lastImageHeight;
    if (!sourceW || !sourceH) return;

    const fit = containRect(sourceW, sourceH, cssW, cssH);
    for (const face of payload.faces) {
      const left = fit.x + (Number(face.left || 0) / sourceW) * fit.w;
      const top = fit.y + (Number(face.top || 0) / sourceH) * fit.h;
      const right = fit.x + (Number(face.right || 0) / sourceW) * fit.w;
      const bottom = fit.y + (Number(face.bottom || 0) / sourceH) * fit.h;
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);

      const recognized = face.event_type === "recognized";
      const strokeColor = recognized ? "#10b981" : "#f59e0b";
      const label = recognized ? `${face.full_name || "Student"}` : "Unknown";

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
  }, [syncCanvas, overlayRef]);

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
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, cssW, cssH);

      const sourceW = img.videoWidth || img.naturalWidth || img.width;
      const sourceH = img.videoHeight || img.naturalHeight || img.height;
      if (!sourceW || !sourceH) return;

      renderRef.current.lastImageWidth = sourceW;
      renderRef.current.lastImageHeight = sourceH;

      const fit = containRect(sourceW, sourceH, cssW, cssH);
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
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, info.cssW, info.cssH);
      }
    }
  }, [syncCanvas, overlayRef]);

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
            IsPresent: 1,
            IsLate: presencePayload?.is_late ? 1 : 0,
            ArrivalDelayMinutes:
              presencePayload?.arrival_delay_minutes ?? row.ArrivalDelayMinutes,
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
      const sid = await apiStartSession();
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
      appendEvent("success", `Session started for course ${courseId}`);
    } catch (err) { }
  };

  const handleFinalizeSession = async () => {
    try {
      const result = await apiFinalizeSession();
      appendEvent(
        "success",
        `Session finalized. Emails sent=${result?.emails_sent}, failed=${result?.email_failures}`,
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
        "Start a session before marking attendance",
      );
    const payload =
      mode === "absent"
        ? { is_present: false, is_late: false }
        : mode === "late"
          ? { is_present: true, is_late: true, arrival_delay_minutes: 11 }
          : { is_present: true, is_late: false };
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

  return (
    <DashboardLayout
      header={
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                Attendance Management
                <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800 uppercase tracking-wide">
                  AI: {health?.ai_mode || '-'} ({health?.ai_model || '-'})
                </span>
              </h1>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
                Classroom administration and grade tracking
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                className="w-9 h-9 flex items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm text-slate-600 dark:text-slate-400"
                onClick={() =>
                  setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                }
                title="Toggle Theme"
              >
                {theme === "dark" ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2" />
                    <path d="M12 20v2" />
                    <path d="m4.93 4.93 1.41 1.41" />
                    <path d="m17.66 17.66 1.41 1.41" />
                    <path d="M2 12h2" />
                    <path d="M20 12h2" />
                    <path d="m6.34 17.66-1.41 1.41" />
                    <path d="m19.07 4.93-1.41 1.41" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-12 items-end">
            <label className="lg:col-span-5 relative">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Active Course
              </span>
              <div className="relative">
                <select
                  className="w-full h-10 appearance-none rounded-md standard-input pl-3 pr-10 py-2 text-sm text-slate-900 dark:text-slate-100 font-medium cursor-pointer"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                >
                  {courses.map((course) => (
                    <option
                      key={course.CourseID}
                      value={String(course.CourseID)}
                    >
                      {course.CourseCode} - {course.CourseName}
                    </option>
                  ))}
                  {!courses.length && (
                    <option value="">Loading courses...</option>
                  )}
                </select>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="absolute right-3 top-3 text-slate-500 pointer-events-none"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </label>

            <div className="lg:col-span-7 flex flex-wrap gap-3 justify-end items-center h-10">
              <label
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer transition-colors user-select-none",
                  sessionId
                    ? "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                    : "border-transparent opacity-50 cursor-not-allowed",
                )}
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Camera Scanner
                </span>
                <div
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    cameraRunning
                      ? "bg-blue-600"
                      : "bg-slate-300 dark:bg-slate-600",
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
                      cameraRunning && "translate-x-4",
                    )}
                  ></div>
                </div>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={cameraRunning}
                  onChange={toggleCamera}
                  disabled={!sessionId}
                />
              </label>

              <button
                className={cn(
                  "h-10 w-[130px] flex items-center justify-center px-4 rounded-md font-medium text-sm shadow-sm transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed",
                  sessionId
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-green-600 text-white hover:bg-green-700",
                )}
                onClick={sessionId ? handleFinalizeSession : handleStartSession}
                disabled={
                  sessionBusy.starting ||
                  sessionBusy.finalizing ||
                  (!sessionId && !courseId)
                }
              >
                {sessionBusy.starting
                  ? "Starting..."
                  : sessionBusy.finalizing
                    ? "Ending..."
                    : sessionId
                      ? "End Session"
                      : "Start Session"}
              </button>
            </div>
          </div>
        </div>
      }
    >
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
              label: "Late Arrival",
              value: lateCount,
              hint: "Checked in past cutoff",
              variant: "warning",
            },
            {
              label: "Needs Review",
              value: atRiskCount,
              hint: "Missing or low scores",
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
          />
        </div>

        <div className="xl:col-span-7 h-full">
          <AttendanceTable
            attendance={attendance}
            sessionId={sessionId}
            markManualAttendance={markManualAttendance}
            attendanceBusyByStudent={attendanceBusyByStudent}
          />
        </div>
      </div>

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

      <video
        ref={videoWorkerRef}
        style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
        autoPlay
        muted
        playsInline
      />
      <canvas ref={captureCanvasRef} className="hidden" aria-hidden="true" />
    </DashboardLayout>
  );
}
