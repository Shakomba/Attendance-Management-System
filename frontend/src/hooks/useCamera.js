import { useState, useRef, useCallback, useEffect } from 'react'

const CAMERA_SEND_FPS = 24
const CAMERA_BUFFER_LIMIT = 3_000_000

export function useCamera(toWsBase, apiBase) {
    const [cameraRunning, setCameraRunning] = useState(false)
    const [cameraDrops, setCameraDrops] = useState(0)

    const cameraWsRef = useRef(null)
    const cameraTimerRef = useRef(null)
    const mediaStreamRef = useRef(null)
    const cameraActiveRef = useRef(false)
    const videoWorkerRef = useRef(null)
    const captureCanvasRef = useRef(null)
    const sendBusyRef = useRef(false)

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
            try { cameraWsRef.current.close() } catch { }
            cameraWsRef.current = null
        }
        setCameraRunning(false)
    }, [])

    const startCamera = useCallback(async (activeSessionId, appendEvent) => {
        if (!activeSessionId) {
            appendEvent?.('warning', 'Start a session before enabling camera stream')
            return
        }
        if (cameraActiveRef.current) {
            appendEvent?.('info', 'Camera stream is already active')
            return
        }

        const ws = new WebSocket(`${toWsBase(apiBase)}/ws/camera/${activeSessionId}`)
        ws.binaryType = 'arraybuffer'
        cameraWsRef.current = ws

        ws.onopen = async () => {
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

                    // Send raw JPEG blob as binary WebSocket message (no base64/JSON overhead)
                    sendBusyRef.current = true
                    captureCanvas.toBlob((blob) => {
                        sendBusyRef.current = false
                        if (!blob) return
                        if (!cameraWsRef.current || cameraWsRef.current.readyState !== WebSocket.OPEN) return
                        cameraWsRef.current.send(blob)
                    }, 'image/jpeg', 0.58)
                }, Math.round(1000 / CAMERA_SEND_FPS))
            } catch (err) {
                appendEvent?.('error', `Camera start failed: ${err.message}`)
                stopCamera()
            }
        }

        ws.onerror = () => appendEvent?.('error', 'Camera WebSocket connection failed')
        ws.onclose = () => {
            if (cameraActiveRef.current) appendEvent?.('warning', 'Camera WebSocket disconnected')
            stopCamera()
        }
    }, [apiBase, stopCamera, toWsBase])

    useEffect(() => {
        return stopCamera
    }, [stopCamera])

    return {
        cameraRunning,
        cameraDrops,
        setCameraDrops, // to reset metrics if needed
        startCamera,
        stopCamera,
        videoWorkerRef,
        captureCanvasRef,
        cameraActiveRef
    }
}
