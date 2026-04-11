import { useState, useRef, useCallback, useEffect } from 'react'

const CAMERA_SEND_FPS = 24
const CAMERA_BUFFER_LIMIT = 3_000_000
const PING_INTERVAL_MS = 25_000      // keep Cloudflare tunnel alive
const MAX_RECONNECT_ATTEMPTS = 5

export function useCamera(toWsBase, apiBase) {
    const [cameraRunning, setCameraRunning] = useState(false)
    const [cameraDrops, setCameraDrops] = useState(0)

    const cameraWsRef = useRef(null)
    const cameraTimerRef = useRef(null)
    const pingTimerRef = useRef(null)
    const reconnectTimerRef = useRef(null)
    const mediaStreamRef = useRef(null)
    const cameraActiveRef = useRef(false)
    const videoWorkerRef = useRef(null)
    const captureCanvasRef = useRef(null)
    const sendBusyRef = useRef(false)

    // Persist across reconnects so ws handlers can access latest values.
    const activeSessionIdRef = useRef(null)
    const appendEventRef = useRef(null)
    const reconnectCountRef = useRef(0)

    const stopCamera = useCallback(() => {
        cameraActiveRef.current = false

        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current)
            reconnectTimerRef.current = null
        }
        if (pingTimerRef.current) {
            clearInterval(pingTimerRef.current)
            pingTimerRef.current = null
        }
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
            // Null out onclose before closing so we don't trigger reconnect.
            cameraWsRef.current.onclose = null
            try { cameraWsRef.current.close() } catch { }
            cameraWsRef.current = null
        }
        setCameraRunning(false)
    }, [])

    // Opens (or re-opens) the camera WebSocket without touching the media stream.
    const connectCameraWs = useCallback((sessionId) => {
        // Close existing ws without triggering onclose reconnect logic.
        if (cameraWsRef.current) {
            cameraWsRef.current.onclose = null
            try { cameraWsRef.current.close() } catch { }
            cameraWsRef.current = null
        }
        if (pingTimerRef.current) {
            clearInterval(pingTimerRef.current)
            pingTimerRef.current = null
        }

        const token = localStorage.getItem('ams_token') || ''
        const ws = new WebSocket(`${toWsBase(apiBase)}/ws/camera/${sessionId}?token=${token}`)
        ws.binaryType = 'arraybuffer'
        cameraWsRef.current = ws

        ws.onopen = () => {
            reconnectCountRef.current = 0
            // Heartbeat keeps the Cloudflare tunnel from timing out the WS.
            pingTimerRef.current = setInterval(() => {
                if (cameraWsRef.current?.readyState === WebSocket.OPEN) {
                    try { cameraWsRef.current.send(JSON.stringify({ type: 'ping' })) } catch { }
                }
            }, PING_INTERVAL_MS)
        }

        ws.onerror = () => appendEventRef.current?.('error', 'Camera WebSocket error')

        ws.onclose = () => {
            if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null }
            if (!cameraActiveRef.current) return  // intentional stop — don't reconnect

            const attempt = ++reconnectCountRef.current
            if (attempt > MAX_RECONNECT_ATTEMPTS) {
                appendEventRef.current?.('error', 'Camera disconnected — stopping after too many retries')
                stopCamera()
                return
            }

            const delay = Math.min(attempt * 1000, 4000)
            appendEventRef.current?.('warning', `Camera connection lost, reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})…`)
            reconnectTimerRef.current = setTimeout(() => {
                if (cameraActiveRef.current) connectCameraWs(activeSessionIdRef.current)
            }, delay)
        }
    }, [apiBase, stopCamera, toWsBase])

    const startCamera = useCallback(async (activeSessionId, appendEvent) => {
        if (!activeSessionId) {
            appendEvent?.('warning', 'Start a lecture before enabling camera stream')
            return
        }
        if (cameraActiveRef.current) {
            appendEvent?.('info', 'Camera stream is already active')
            return
        }

        activeSessionIdRef.current = activeSessionId
        appendEventRef.current = appendEvent
        reconnectCountRef.current = 0

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
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
            appendEvent?.('success', `Local camera stream started (${CAMERA_SEND_FPS} FPS cap)`)

            const captureCanvas = captureCanvasRef.current
            const captureCtx = captureCanvas?.getContext('2d')

            // Frame-capture interval — keeps running through WS reconnects.
            cameraTimerRef.current = setInterval(() => {
                if (!cameraActiveRef.current) return
                if (!cameraWsRef.current || cameraWsRef.current.readyState !== WebSocket.OPEN) return
                if (!captureCanvas || !captureCtx || !video.videoWidth || !video.videoHeight) return
                if (sendBusyRef.current) return

                if (cameraWsRef.current.bufferedAmount > CAMERA_BUFFER_LIMIT) {
                    setCameraDrops(d => d + 1)
                    return
                }

                const width = 640
                const height = Math.max(240, Math.round((video.videoHeight / video.videoWidth) * width))
                captureCanvas.width = width
                captureCanvas.height = height
                captureCtx.drawImage(video, 0, 0, width, height)

                sendBusyRef.current = true
                captureCanvas.toBlob((blob) => {
                    sendBusyRef.current = false
                    if (!blob) return
                    if (!cameraWsRef.current || cameraWsRef.current.readyState !== WebSocket.OPEN) return
                    cameraWsRef.current.send(blob)
                }, 'image/jpeg', 0.58)
            }, Math.round(1000 / CAMERA_SEND_FPS))

            // Connect WebSocket after media is set up.
            connectCameraWs(activeSessionId)
        } catch (err) {
            appendEvent?.('error', `Camera start failed: ${err.message}`)
            stopCamera()
        }
    }, [connectCameraWs, stopCamera])

    useEffect(() => {
        return stopCamera
    }, [stopCamera])

    return {
        cameraRunning,
        cameraDrops,
        setCameraDrops,
        startCamera,
        stopCamera,
        videoWorkerRef,
        captureCanvasRef,
        cameraActiveRef
    }
}
