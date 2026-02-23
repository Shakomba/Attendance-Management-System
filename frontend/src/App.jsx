import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const MAX_EVENTS = 140
const DASH_DRAW_FPS = 18
const CAMERA_SEND_FPS = 6
const CAMERA_BUFFER_LIMIT = 1_500_000
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function toWsBase(apiBase) {
  return normalizeApiBase(apiBase)
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://')
}

function containRect(sourceW, sourceH, targetW, targetH) {
  if (!sourceW || !sourceH || !targetW || !targetH) {
    return { x: 0, y: 0, w: targetW || 0, h: targetH || 0 }
  }

  const sourceRatio = sourceW / sourceH
  const targetRatio = targetW / targetH

  if (sourceRatio > targetRatio) {
    const w = targetW
    const h = w / sourceRatio
    return { x: 0, y: (targetH - h) / 2, w, h }
  }

  const h = targetH
  const w = h * sourceRatio
  return { x: (targetW - w) / 2, y: 0, w, h }
}

function formatClock(isoLike) {
  if (!isoLike) return '--'
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function levelClass(level) {
  if (level === 'error') return 'bad'
  if (level === 'warning') return 'warn'
  return 'ok'
}

function StatCard({ label, value, hint }) {
  return (
    <article className="glass-card rounded-xl p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </article>
  )
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('ams_theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const [apiBase, setApiBase] = useState(() => localStorage.getItem('ams_api_base') || DEFAULT_API_BASE)
  const [health, setHealth] = useState(null)
  const [courses, setCourses] = useState([])
  const [courseId, setCourseId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [gradebook, setGradebook] = useState([])
  const [attendance, setAttendance] = useState([])
  const [events, setEvents] = useState([])
  const [dashboardWsState, setDashboardWsState] = useState('disconnected')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [busy, setBusy] = useState({ loading: false, starting: false, finalizing: false })
  const [streamMetrics, setStreamMetrics] = useState({
    incomingFps: 0,
    drawFps: 0,
    renderDrops: 0,
    outgoingDrops: 0
  })

  const dashboardWsRef = useRef(null)
  const dashboardPingRef = useRef(null)
  const attendanceRefreshGateRef = useRef(0)

  const cameraWsRef = useRef(null)
  const cameraTimerRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const cameraActiveRef = useRef(false)

  const videoWorkerRef = useRef(null)
  const captureCanvasRef = useRef(null)

  const viewportRef = useRef(null)
  const frameCanvasRef = useRef(null)
  const overlayCanvasRef = useRef(null)

  const overlayRef = useRef({ frameWidth: 0, frameHeight: 0, faces: [] })
  const audioContextRef = useRef(null)
  const lastBeepAtRef = useRef(0)

  const renderRef = useRef({
    pendingFrame: null,
    drawBusy: false,
    lastDrawAt: 0,
    image: null,
    lastImageWidth: 0,
    lastImageHeight: 0,
    incomingWindow: 0,
    drawnWindow: 0,
    droppedWindow: 0,
    outgoingDroppedWindow: 0
  })

  const appendEvent = useCallback((level, message, details = null) => {
    setEvents((prev) => {
      const next = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          level,
          message,
          details,
          at: new Date().toISOString()
        },
        ...prev
      ]
      return next.slice(0, MAX_EVENTS)
    })
  }, [])

  const apiFetch = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      })
      const text = await response.text()
      const data = text ? JSON.parse(text) : null
      if (!response.ok) {
        throw new Error(data?.detail || data?.message || text || `HTTP ${response.status}`)
      }
      return data
    },
    [apiBase]
  )

  const applyTheme = useCallback(
    (nextTheme) => {
      const root = document.documentElement
      root.classList.toggle('dark', nextTheme === 'dark')
      localStorage.setItem('ams_theme', nextTheme)
    },
    []
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

  useEffect(() => {
    localStorage.setItem('ams_api_base', normalizeApiBase(apiBase))
  }, [apiBase])

  const syncCanvas = useCallback((canvas) => {
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cssW = Math.max(1, rect.width)
    const cssH = Math.max(1, rect.height)
    const dpr = window.devicePixelRatio || 1
    const pxW = Math.max(1, Math.round(cssW * dpr))
    const pxH = Math.max(1, Math.round(cssH * dpr))

    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW
      canvas.height = pxH
    }

    return { cssW, cssH, dpr }
  }, [])

  const drawOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current
    if (!overlayCanvas) return

    const overlayInfo = syncCanvas(overlayCanvas)
    if (!overlayInfo) return

    const ctx = overlayCanvas.getContext('2d')
    if (!ctx) return

    const { cssW, cssH, dpr } = overlayInfo
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const payload = overlayRef.current
    if (!payload?.faces?.length) return

    const sourceW = payload.frameWidth || renderRef.current.lastImageWidth
    const sourceH = payload.frameHeight || renderRef.current.lastImageHeight
    if (!sourceW || !sourceH) return

    const fit = containRect(sourceW, sourceH, cssW, cssH)
    for (const face of payload.faces) {
      const left = fit.x + (Number(face.left || 0) / sourceW) * fit.w
      const top = fit.y + (Number(face.top || 0) / sourceH) * fit.h
      const right = fit.x + (Number(face.right || 0) / sourceW) * fit.w
      const bottom = fit.y + (Number(face.bottom || 0) / sourceH) * fit.h
      const width = Math.max(1, right - left)
      const height = Math.max(1, bottom - top)

      const recognized = face.event_type === 'recognized'
      const strokeColor = recognized ? '#22c55e' : '#f97316'
      const fillColor = recognized ? 'rgba(34, 197, 94, 0.14)' : 'rgba(249, 115, 22, 0.16)'
      const label = recognized
        ? `${face.full_name || 'Student'} (${Number(face.confidence || 0).toFixed(2)})`
        : 'Unknown'

      ctx.fillStyle = fillColor
      ctx.fillRect(left, top, width, height)

      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 2
      ctx.strokeRect(left, top, width, height)

      ctx.font = '600 12px "IBM Plex Mono", monospace'
      const textWidth = ctx.measureText(label).width
      const padX = 6
      const tagW = textWidth + padX * 2
      const tagH = 20
      const tagX = Math.min(Math.max(left, 2), Math.max(2, cssW - tagW - 2))
      const tagY = Math.max(2, top - tagH - 3)

      ctx.fillStyle = strokeColor
      ctx.fillRect(tagX, tagY, tagW, tagH)
      ctx.fillStyle = '#021012'
      ctx.fillText(label, tagX + padX, tagY + 14)
    }
  }, [syncCanvas])

  const drawFrame = useCallback(
    (img) => {
      const frameCanvas = frameCanvasRef.current
      if (!frameCanvas) return

      const frameInfo = syncCanvas(frameCanvas)
      if (!frameInfo) return

      const ctx = frameCanvas.getContext('2d')
      if (!ctx) return

      const { cssW, cssH, dpr } = frameInfo
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, cssW, cssH)

      const sourceW = img.naturalWidth || img.width
      const sourceH = img.naturalHeight || img.height
      if (!sourceW || !sourceH) return

      renderRef.current.lastImageWidth = sourceW
      renderRef.current.lastImageHeight = sourceH

      const fit = containRect(sourceW, sourceH, cssW, cssH)
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h)
      drawOverlay()
    },
    [drawOverlay, syncCanvas]
  )

  const clearFrameCanvases = useCallback(() => {
    overlayRef.current = { frameWidth: 0, frameHeight: 0, faces: [] }

    for (const canvas of [frameCanvasRef.current, overlayCanvasRef.current]) {
      if (!canvas) continue
      const info = syncCanvas(canvas)
      if (!info) continue
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.setTransform(info.dpr, 0, 0, info.dpr, 0, 0)
      ctx.clearRect(0, 0, info.cssW, info.cssH)
      if (canvas === frameCanvasRef.current) {
        ctx.fillStyle = '#020617'
        ctx.fillRect(0, 0, info.cssW, info.cssH)
      }
    }
  }, [syncCanvas])

  const playBeep = useCallback(async () => {
    const now = Date.now()
    if (now - lastBeepAtRef.current < 450) return
    lastBeepAtRef.current = now

    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (!AudioCtx) return
        audioContextRef.current = new AudioCtx()
      }
      const ctx = audioContextRef.current
      if (ctx.state === 'suspended') await ctx.resume()

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 900
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.13)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.14)
    } catch {
      // Ignore audio initialization issues.
    }
  }, [])

  const refreshAttendance = useCallback(async () => {
    if (!sessionId) return
    try {
      const data = await apiFetch(`/api/sessions/${sessionId}/attendance`)
      setAttendance(data?.items || [])
    } catch (err) {
      appendEvent('warning', `Attendance refresh failed: ${err.message}`)
    }
  }, [apiFetch, appendEvent, sessionId])

  const loadGradebook = useCallback(async () => {
    if (!courseId) return
    try {
      const data = await apiFetch(`/api/courses/${courseId}/gradebook`)
      setGradebook(data?.items || [])
    } catch (err) {
      appendEvent('warning', `Gradebook load failed: ${err.message}`)
    }
  }, [apiFetch, appendEvent, courseId])

  const closeDashboardSocket = useCallback(() => {
    if (dashboardPingRef.current) {
      clearInterval(dashboardPingRef.current)
      dashboardPingRef.current = null
    }
    if (dashboardWsRef.current) {
      try {
        dashboardWsRef.current.close()
      } catch {
        // Ignore close races.
      }
      dashboardWsRef.current = null
    }
    setDashboardWsState('disconnected')
  }, [])

  const stopCamera = useCallback(() => {
    cameraActiveRef.current = false

    if (cameraTimerRef.current) {
      clearInterval(cameraTimerRef.current)
      cameraTimerRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    const worker = videoWorkerRef.current
    if (worker) {
      worker.pause()
      worker.srcObject = null
    }

    if (cameraWsRef.current) {
      try {
        cameraWsRef.current.close()
      } catch {
        // Ignore close races.
      }
      cameraWsRef.current = null
    }

    setCameraRunning(false)
  }, [])

  const connectDashboardSocket = useCallback(
    (activeSessionId) => {
      closeDashboardSocket()

      const ws = new WebSocket(`${toWsBase(apiBase)}/ws/dashboard/${activeSessionId}`)
      dashboardWsRef.current = ws
      setDashboardWsState('connecting')

      ws.onopen = () => {
        setDashboardWsState('connected')
        appendEvent('info', `Dashboard socket attached to session ${activeSessionId}`)
        dashboardPingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 15000)
      }

      ws.onclose = () => {
        setDashboardWsState('disconnected')
      }

      ws.onerror = () => {
        setDashboardWsState('error')
        appendEvent('error', 'Dashboard socket error')
      }

      ws.onmessage = (event) => {
        let message = null
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }

        const render = renderRef.current

        if (message.type === 'frame' && message.image) {
          if (render.pendingFrame) render.droppedWindow += 1
          render.pendingFrame = message.image
          render.incomingWindow += 1
          return
        }

        if (message.type === 'overlay') {
          const payload = message.payload || {}
          overlayRef.current = {
            frameWidth: Number(payload.frame_width || 0),
            frameHeight: Number(payload.frame_height || 0),
            faces: Array.isArray(payload.faces) ? payload.faces : []
          }
          drawOverlay()
          return
        }

        if (message.type === 'presence') {
          const p = message.payload || {}

          if (p.event_type === 'unknown') {
            appendEvent('warning', `Unknown face detected (${String(p.engine_mode || 'engine').toUpperCase()})`)
            return
          }

          const confText =
            p.confidence === null || p.confidence === undefined ? '-' : Number(p.confidence).toFixed(3)
          const lateTag = p.is_late ? ' (Late)' : ''
          appendEvent('success', `${p.full_name} recognized | confidence ${confText}${lateTag}`)
          playBeep()

          const now = Date.now()
          if (now - attendanceRefreshGateRef.current > 1500) {
            attendanceRefreshGateRef.current = now
            refreshAttendance()
          }
          return
        }

        if (message.type === 'warning') {
          appendEvent('warning', message.message || 'Warning')
          return
        }

        if (message.type === 'info') {
          appendEvent('info', message.message || 'Info')
        }
      }
    },
    [apiBase, appendEvent, closeDashboardSocket, drawOverlay, playBeep, refreshAttendance]
  )

  const loadBootstrap = useCallback(async () => {
    setBusy((prev) => ({ ...prev, loading: true }))
    try {
      const [healthRes, courseRes] = await Promise.all([apiFetch('/api/health'), apiFetch('/api/courses')])
      setHealth(healthRes)
      const allCourses = courseRes?.items || []
      setCourses(allCourses)
      if (allCourses.length && !courseId) {
        setCourseId(String(allCourses[0].CourseID))
      }
      appendEvent('info', 'Dashboard initialized')
    } catch (err) {
      appendEvent('error', `Bootstrap failed: ${err.message}`)
    } finally {
      setBusy((prev) => ({ ...prev, loading: false }))
    }
  }, [apiFetch, appendEvent, courseId])

  useEffect(() => {
    loadBootstrap()
  }, [loadBootstrap])

  useEffect(() => {
    if (!courseId) return
    loadGradebook()
  }, [courseId, loadGradebook])

  useEffect(() => {
    const render = renderRef.current
    const image = new Image()
    image.decoding = 'async'
    render.image = image

    let rafId = 0
    const drawIntervalMs = 1000 / DASH_DRAW_FPS

    const frameLoop = (ts) => {
      const state = renderRef.current
      const pending = state.pendingFrame
      if (pending && !state.drawBusy && ts - state.lastDrawAt >= drawIntervalMs) {
        state.pendingFrame = null
        state.drawBusy = true
        state.image.onload = () => {
          drawFrame(state.image)
          state.drawBusy = false
          state.lastDrawAt = performance.now()
          state.drawnWindow += 1
        }
        state.image.onerror = () => {
          state.drawBusy = false
        }
        state.image.src = `data:image/jpeg;base64,${pending}`
      }
      rafId = requestAnimationFrame(frameLoop)
    }

    rafId = requestAnimationFrame(frameLoop)

    const metricTimer = setInterval(() => {
      const state = renderRef.current
      setStreamMetrics({
        incomingFps: state.incomingWindow,
        drawFps: state.drawnWindow,
        renderDrops: state.droppedWindow,
        outgoingDrops: state.outgoingDroppedWindow
      })
      state.incomingWindow = 0
      state.drawnWindow = 0
      state.droppedWindow = 0
      state.outgoingDroppedWindow = 0
    }, 1000)

    const resizeObserver = new ResizeObserver(() => {
      if (renderRef.current.image?.complete && renderRef.current.lastImageWidth) {
        drawFrame(renderRef.current.image)
      } else {
        clearFrameCanvases()
      }
      drawOverlay()
    })
    if (viewportRef.current) resizeObserver.observe(viewportRef.current)

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(metricTimer)
      resizeObserver.disconnect()
    }
  }, [clearFrameCanvases, drawFrame, drawOverlay])

  useEffect(() => {
    return () => {
      closeDashboardSocket()
      stopCamera()
    }
  }, [closeDashboardSocket, stopCamera])

  const startSession = async () => {
    if (!courseId) {
      appendEvent('warning', 'Select a course first')
      return
    }

    setBusy((prev) => ({ ...prev, starting: true }))
    try {
      const data = await apiFetch('/api/sessions/start', {
        method: 'POST',
        body: JSON.stringify({ course_id: Number(courseId) })
      })
      const sid = data.session_id
      setSessionId(sid)
      clearFrameCanvases()
      overlayRef.current = { frameWidth: 0, frameHeight: 0, faces: [] }
      connectDashboardSocket(sid)
      await Promise.all([refreshAttendance(), loadGradebook()])
      appendEvent('success', `Session started for course ${courseId}`)
    } catch (err) {
      appendEvent('error', `Session start failed: ${err.message}`)
    } finally {
      setBusy((prev) => ({ ...prev, starting: false }))
    }
  }

  const startCamera = async () => {
    if (!sessionId) {
      appendEvent('warning', 'Start a session before enabling camera stream')
      return
    }
    if (cameraActiveRef.current) {
      appendEvent('info', 'Camera stream is already active')
      return
    }

    const ws = new WebSocket(`${toWsBase(apiBase)}/ws/camera/${sessionId}`)
    cameraWsRef.current = ws

    ws.onopen = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            facingMode: 'user'
          },
          audio: false
        })

        const video = videoWorkerRef.current
        if (!video) throw new Error('Video worker element is not ready')

        mediaStreamRef.current = stream
        video.srcObject = stream
        video.playsInline = true
        video.muted = true
        await video.play()

        cameraActiveRef.current = true
        setCameraRunning(true)
        appendEvent('success', `Local camera stream started (${CAMERA_SEND_FPS} FPS cap)`)

        const captureCanvas = captureCanvasRef.current
        const captureCtx = captureCanvas?.getContext('2d')

        cameraTimerRef.current = setInterval(() => {
          if (!cameraActiveRef.current) return
          if (!cameraWsRef.current || cameraWsRef.current.readyState !== WebSocket.OPEN) return
          if (!captureCanvas || !captureCtx || !video.videoWidth || !video.videoHeight) return

          if (cameraWsRef.current.bufferedAmount > CAMERA_BUFFER_LIMIT) {
            renderRef.current.outgoingDroppedWindow += 1
            return
          }

          const width = 640
          const height = Math.max(240, Math.round((video.videoHeight / video.videoWidth) * width))
          captureCanvas.width = width
          captureCanvas.height = height
          captureCtx.drawImage(video, 0, 0, width, height)

          const jpeg = captureCanvas.toDataURL('image/jpeg', 0.58)
          const base64 = jpeg.split(',')[1]
          cameraWsRef.current.send(
            JSON.stringify({
              type: 'frame',
              image: base64,
              timestamp: new Date().toISOString()
            })
          )
        }, Math.round(1000 / CAMERA_SEND_FPS))
      } catch (err) {
        appendEvent('error', `Camera start failed: ${err.message}`)
        stopCamera()
      }
    }

    ws.onerror = () => {
      appendEvent('error', 'Camera WebSocket connection failed')
    }

    ws.onclose = () => {
      if (cameraActiveRef.current) {
        appendEvent('warning', 'Camera WebSocket disconnected')
      }
      stopCamera()
    }
  }

  const finalizeSession = async () => {
    if (!sessionId) {
      appendEvent('warning', 'No active session to finalize')
      return
    }

    setBusy((prev) => ({ ...prev, finalizing: true }))
    try {
      const result = await apiFetch(`/api/sessions/${sessionId}/finalize-send-emails`, {
        method: 'POST',
        body: JSON.stringify({})
      })
      appendEvent(
        'success',
        `Session finalized. Emails sent=${result.emails_sent}, failed=${result.email_failures}`
      )
      await Promise.all([loadGradebook(), refreshAttendance()])
      stopCamera()
    } catch (err) {
      appendEvent('error', `Finalize failed: ${err.message}`)
    } finally {
      setBusy((prev) => ({ ...prev, finalizing: false }))
    }
  }

  const enrolledCount = gradebook.length
  const presentCount = attendance.filter((row) => row.IsPresent).length
  const lateCount = attendance.filter((row) => row.IsLate).length
  const atRiskCount = gradebook.filter((row) => row.AtRiskByPolicy).length

  const wsBadgeStyle = useMemo(() => {
    if (dashboardWsState === 'connected') return 'ok'
    if (dashboardWsState === 'connecting') return 'warn'
    return 'bad'
  }, [dashboardWsState])

  return (
    <main className="mx-auto flex min-h-screen max-w-[1640px] flex-col gap-4 px-4 py-4 lg:px-6">
      <header className="glass-card rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Enterprise Classroom Operations
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
              AI Attendance & Grade Dashboard
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`data-chip ${wsBadgeStyle}`}>WS: {dashboardWsState}</span>
            <span className="data-chip ok">AI: {health?.ai_mode || '-'} ({health?.ai_model || '-'})</span>
            <button
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-12">
          <label className="lg:col-span-4">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              API Base URL
            </span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
            />
          </label>

          <label className="lg:col-span-3">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Course
            </span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              {courses.map((course) => (
                <option key={course.CourseID} value={String(course.CourseID)}>
                  {course.CourseCode} - {course.CourseName}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2 lg:col-span-5 lg:justify-end lg:self-end">
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={loadBootstrap}
              disabled={busy.loading}
            >
              Refresh
            </button>
            <button
              className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={startSession}
              disabled={busy.starting || !courseId}
            >
              {busy.starting ? 'Starting...' : 'Start Session'}
            </button>
            <button
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={startCamera}
              disabled={!sessionId || cameraRunning}
            >
              Start Camera
            </button>
            <button
              className="rounded-lg border border-amber-500 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-900/30"
              onClick={stopCamera}
              disabled={!cameraRunning}
            >
              Stop Camera
            </button>
            <button
              className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={finalizeSession}
              disabled={!sessionId || busy.finalizing}
            >
              {busy.finalizing ? 'Finalizing...' : 'Finalize + Email'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span className="data-chip ok">Session: {sessionId || 'Not started'}</span>
          <span className="data-chip ok">Camera: {cameraRunning ? 'Streaming' : 'Stopped'}</span>
          <span className="data-chip ok">Incoming FPS: {streamMetrics.incomingFps}</span>
          <span className="data-chip ok">Draw FPS: {streamMetrics.drawFps}</span>
          <span className="data-chip warn">Render Drops: {streamMetrics.renderDrops}</span>
          <span className="data-chip warn">Outgoing Drops: {streamMetrics.outgoingDrops}</span>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-4">
        <StatCard label="Enrolled" value={enrolledCount} hint="Students loaded in gradebook" />
        <StatCard label="Present" value={presentCount} hint="Detected and checked-in" />
        <StatCard label="Late" value={lateCount} hint="Arrival beyond grace period" />
        <StatCard label="At Risk" value={atRiskCount} hint="Low score or high absence" />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="glass-card min-h-[360px] p-3 xl:col-span-2">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Live Feed & Face Overlay
            </h2>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">Canvas Overlay Pipeline</span>
          </header>

          <div ref={viewportRef} className="relative h-[52vh] min-h-[320px] overflow-hidden rounded-xl border border-slate-300 bg-slate-950 dark:border-slate-700">
            <canvas ref={frameCanvasRef} className="absolute inset-0 h-full w-full" aria-label="Live frame" />
            <canvas ref={overlayCanvasRef} className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true" />
            {!cameraRunning && (
              <div className="absolute inset-0 grid place-items-center text-center text-sm text-slate-300">
                <div>
                  <p className="font-semibold">Camera stream is idle</p>
                  <p className="mt-1 text-xs text-slate-400">Start a session and enable camera to render overlays.</p>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className="glass-card flex min-h-[360px] flex-col p-3">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Recognition Events
            </h2>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => setEvents([])}
            >
              Clear
            </button>
          </header>

          <ul className="scroll-slim flex-1 space-y-2 overflow-auto pr-1">
            {events.length === 0 ? (
              <li className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                No events yet.
              </li>
            ) : (
              events.map((event) => (
                <li
                  key={event.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className={`data-chip ${levelClass(event.level)}`}>{event.level}</span>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatClock(event.at)}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-200">{event.message}</p>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="glass-card min-h-[280px] p-3 xl:col-span-1">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Session Attendance
            </h2>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={refreshAttendance}
            >
              Refresh
            </button>
          </header>
          <div className="scroll-slim max-h-[300px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 dark:bg-slate-900">
                <tr>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Present</th>
                  <th className="px-2 py-2">Late</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((row) => (
                  <tr key={`${row.StudentID}-${row.FullName}`} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="px-2 py-2 font-medium">{row.FullName}</td>
                    <td className="px-2 py-2">{row.IsPresent ? 'Yes' : 'No'}</td>
                    <td className="px-2 py-2">
                      {row.IsLate ? `Yes (${row.ArrivalDelayMinutes ?? '-'}m)` : 'No'}
                    </td>
                  </tr>
                ))}
                {!attendance.length && (
                  <tr>
                    <td className="px-2 py-3 text-slate-500 dark:text-slate-400" colSpan={3}>
                      No attendance rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="glass-card min-h-[280px] p-3 xl:col-span-2">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Gradebook (Scannable View)
            </h2>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={loadGradebook}
            >
              Reload
            </button>
          </header>

          <div className="scroll-slim max-h-[300px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 dark:bg-slate-900">
                <tr>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Q1</th>
                  <th className="px-2 py-2">Q2</th>
                  <th className="px-2 py-2">Project</th>
                  <th className="px-2 py-2">Assignment</th>
                  <th className="px-2 py-2">Midterm</th>
                  <th className="px-2 py-2">Final</th>
                  <th className="px-2 py-2">Absent Hrs</th>
                  <th className="px-2 py-2">Penalty</th>
                  <th className="px-2 py-2">Adjusted</th>
                  <th className="px-2 py-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {gradebook.map((row) => {
                  const risk = row.AtRiskByPolicy ? 'Yes' : 'No'
                  const riskCls = row.AtRiskByPolicy ? 'bad' : 'ok'
                  return (
                    <tr
                      key={`${row.StudentID}-${row.StudentCode}`}
                      className="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td className="px-2 py-2 font-medium">{row.FullName}</td>
                      <td className="px-2 py-2">{Number(row.Quiz1).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.Quiz2).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.ProjectGrade).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.AssignmentGrade).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.MidtermGrade).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.FinalExamGrade).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.HoursAbsentTotal).toFixed(2)}</td>
                      <td className="px-2 py-2">{Number(row.AttendancePenalty).toFixed(2)}</td>
                      <td className="px-2 py-2 font-semibold">{Number(row.AdjustedTotal).toFixed(2)}</td>
                      <td className="px-2 py-2">
                        <span className={`data-chip ${riskCls}`}>{risk}</span>
                      </td>
                    </tr>
                  )
                })}
                {!gradebook.length && (
                  <tr>
                    <td className="px-2 py-3 text-slate-500 dark:text-slate-400" colSpan={11}>
                      No grade data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <video ref={videoWorkerRef} className="hidden" autoPlay muted playsInline />
      <canvas ref={captureCanvasRef} className="hidden" aria-hidden="true" />
    </main>
  )
}
