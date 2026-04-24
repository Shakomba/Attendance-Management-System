import { useState, useRef, useCallback, useEffect } from 'react'
import { toWsBase } from './useApi'

const ENROLLMENT_SEND_FPS = 8

export function useEnrollment(apiBase) {
    const [enrolling, setEnrolling] = useState(false)
    const [currentPose, setCurrentPose] = useState(null)
    const [poseMessage, setPoseMessage] = useState('')
    const [progress, setProgress] = useState(0)
    const [totalPoses, setTotalPoses] = useState(5)
    const [error, setError] = useState(null)
    const [complete, setComplete] = useState(false)
    const [rejected, setRejected] = useState(null)

    const wsRef = useRef(null)
    const timerRef = useRef(null)
    const mediaStreamRef = useRef(null)
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const activeRef = useRef(false)

    const cleanup = useCallback(() => {
        activeRef.current = false
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop())
            mediaStreamRef.current = null
        }
        if (videoRef.current) {
            videoRef.current.pause()
            videoRef.current.srcObject = null
        }
        if (wsRef.current) {
            try { wsRef.current.close() } catch { }
            wsRef.current = null
        }
    }, [])

    const stopEnrollment = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try { wsRef.current.send(JSON.stringify({ type: 'cancel' })) } catch { }
        }
        cleanup()
        setEnrolling(false)
        setCurrentPose(null)
        setPoseMessage('')
        setProgress(0)
        setError(null)
        setRejected(null)
    }, [cleanup])

    const startEnrollment = useCallback(async (studentId) => {
        cleanup()
        setComplete(false)
        setError(null)
        setRejected(null)
        setProgress(0)

        const token = localStorage.getItem('ams_token') || ''
        const ws = new WebSocket(`${toWsBase(apiBase)}/ws/enrollment/${studentId}?token=${token}`)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                switch (data.type) {
                    case 'pose_instruction':
                        setCurrentPose(data.current_pose)
                        setPoseMessage(data.message)
                        setTotalPoses(data.total_poses || 5)
                        setProgress(data.progress || 0)
                        setRejected(null)
                        break
                    case 'pose_captured':
                        setProgress(data.progress)
                        setCurrentPose(data.next_pose || null)
                        setPoseMessage(data.message || '')
                        setRejected(null)
                        break
                    case 'pose_hold':
                        // Face detected but not held long enough — keep current pose, clear rejection
                        setRejected(null)
                        break
                    case 'pose_rejected':
                        setRejected(data.reason)
                        break
                    case 'spoof_detected':
                        setRejected(data.reason)
                        break
                    case 'enrollment_complete':
                        setComplete(true)
                        setProgress(data.poses_captured || 5)
                        cleanup()
                        break
                    case 'enrollment_failed':
                        setError(data.reason)
                        cleanup()
                        break
                    case 'error':
                        setError(data.message)
                        cleanup()
                        break
                    case 'pong':
                        break
                    default:
                        break
                }
            } catch { }
        }

        ws.onopen = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                    audio: false,
                })

                const video = videoRef.current
                if (!video) throw new Error('Video element not ready')

                mediaStreamRef.current = stream
                video.srcObject = stream
                video.playsInline = true
                video.muted = true
                await video.play()

                activeRef.current = true
                setEnrolling(true)

                const canvas = canvasRef.current
                const ctx = canvas?.getContext('2d')

                timerRef.current = setInterval(() => {
                    if (!activeRef.current) return
                    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
                    if (!canvas || !ctx || !video.videoWidth) return

                    canvas.width = 640
                    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 640)
                    ctx.save()
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                    ctx.translate(canvas.width, 0)
                    ctx.scale(-1, 1)
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                    ctx.restore()

                    canvas.toBlob((blob) => {
                        if (!blob || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
                        wsRef.current.send(blob)
                    }, 'image/jpeg', 0.7)
                }, Math.round(1000 / ENROLLMENT_SEND_FPS))
            } catch (err) {
                setError(`Camera access failed: ${err.message}`)
                cleanup()
            }
        }

        ws.onerror = () => setError('Enrollment WebSocket connection failed')
        ws.onclose = () => {
            if (activeRef.current) {
                activeRef.current = false
            }
        }
    }, [apiBase, cleanup])

    useEffect(() => {
        return cleanup
    }, [cleanup])

    return {
        enrolling,
        currentPose,
        poseMessage,
        progress,
        totalPoses,
        error,
        complete,
        rejected,
        startEnrollment,
        stopEnrollment,
        setComplete,
        setError,
        videoRef,
        canvasRef,
    }
}
