import { useState, useCallback } from "react";

export function useSession(apiFetch, courseId) {
  const [sessionId, setSessionId] = useState("");
  const [gradebook, setGradebook] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [busy, setBusy] = useState({ starting: false, finalizing: false });

  const startSession = useCallback(async () => {
    if (!courseId) return null;
    setBusy((prev) => ({ ...prev, starting: true }));
    try {
      const data = await apiFetch("/api/sessions/start", {
        method: "POST",
        body: JSON.stringify({ course_id: Number(courseId) }),
      });
      const sid = data.session_id;
      setSessionId(sid);
      setAttendance([]);
      return sid;
    } catch (err) {
      console.error("Session start failed:", err.message);
      throw err;
    } finally {
      setBusy((prev) => ({ ...prev, starting: false }));
    }
  }, [apiFetch, courseId]);

  const finalizeSession = useCallback(async () => {
    if (!sessionId) return null;
    setBusy((prev) => ({ ...prev, finalizing: true }));
    try {
      const result = await apiFetch(
        `/api/sessions/${sessionId}/finalize-send-emails`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setSessionId("");
      return result;
    } catch (err) {
      console.error("Finalize session failed:", err.message);
      throw err;
    } finally {
      setBusy((prev) => ({ ...prev, finalizing: false }));
    }
  }, [apiFetch, sessionId]);

  const loadGradebook = useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await apiFetch(`/api/courses/${courseId}/gradebook`);
      setGradebook(data?.items || []);
    } catch (err) {
      console.error("Gradebook load failed:", err.message);
    }
  }, [apiFetch, courseId]);

  const refreshAttendance = useCallback(
    async (activeSessionId = null) => {
      const targetSessionId = activeSessionId || sessionId;
      if (!targetSessionId) return;
      try {
        const data = await apiFetch(
          `/api/sessions/${targetSessionId}/attendance`,
        );
        setAttendance(data?.items || []);
      } catch (err) {
        console.error("Attendance refresh failed:", err.message);
      }
    },
    [apiFetch, sessionId],
  );

  return {
    sessionId,
    setSessionId,
    gradebook,
    setGradebook,
    attendance,
    setAttendance,
    busy,
    startSession,
    finalizeSession,
    loadGradebook,
    refreshAttendance,
  };
}
