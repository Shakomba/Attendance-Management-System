import { useState, useRef, useCallback, useEffect } from 'react'

export function useDashboardSocket(toWsBase, apiBase) {
    const [dashboardWsState, setDashboardWsState] = useState('disconnected')
    const dashboardWsRef = useRef(null)
    const dashboardPingRef = useRef(null)

    const audioContextRef = useRef(null)
    const lastBeepAtRef = useRef(0)

    // Keep references to overlays without forcing re-renders constantly
    const overlayRef = useRef({ frameWidth: 0, frameHeight: 0, faces: [] })

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

    const closeDashboardSocket = useCallback(() => {
        if (dashboardPingRef.current) {
            clearInterval(dashboardPingRef.current)
            dashboardPingRef.current = null
        }
        if (dashboardWsRef.current) {
            try { dashboardWsRef.current.close() } catch { }
            dashboardWsRef.current = null
        }
        setDashboardWsState('disconnected')
    }, [])

    useEffect(() => closeDashboardSocket, [closeDashboardSocket])

    const connectDashboardSocket = useCallback(
        (activeSessionId, { appendEvent, applyPresenceToAttendance, refreshAttendance, drawOverlay }) => {
            closeDashboardSocket()

            const ws = new WebSocket(`${toWsBase(apiBase)}/ws/dashboard/${activeSessionId}`)
            dashboardWsRef.current = ws
            setDashboardWsState('connecting')

            ws.onopen = () => {
                setDashboardWsState('connected')
                appendEvent?.('info', `Dashboard socket attached to session ${activeSessionId}`)
                dashboardPingRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send('ping')
                }, 15000)
            }

            ws.onclose = () => setDashboardWsState('disconnected')
            ws.onerror = () => {
                setDashboardWsState('error')
                appendEvent?.('error', 'Dashboard socket error')
            }

            ws.onmessage = (event) => {
                // Only JSON messages (overlay, presence, info, warning)
                let message = null
                try { message = JSON.parse(event.data) } catch { return }

                if (message.type === 'overlay') {
                    const payload = message.payload || {}
                    overlayRef.current = {
                        frameWidth: Number(payload.frame_width || 0),
                        frameHeight: Number(payload.frame_height || 0),
                        faces: Array.isArray(payload.faces) ? payload.faces : []
                    }
                    drawOverlay?.()
                    return
                }

                if (message.type === 'presence') {
                    const p = message.payload || {}
                    if (p.event_type === 'unknown') {
                        appendEvent?.('warning', `Unknown face detected (${String(p.engine_mode || 'engine').toUpperCase()})`)
                        return
                    }
                    const confText = p.confidence === null || p.confidence === undefined ? '-' : Number(p.confidence).toFixed(3)
                    const lateTag = p.is_late ? ' (Late)' : ''
                    appendEvent?.('success', `${p.full_name} recognized | confidence ${confText}${lateTag}`)
                    playBeep()
                    applyPresenceToAttendance?.(p)
                    refreshAttendance?.(activeSessionId)
                    return
                }

                if (message.type === 'warning') appendEvent?.('warning', message.message || 'Warning')
                if (message.type === 'info') appendEvent?.('info', message.message || 'Info')
            }
        },
        [apiBase, toWsBase, closeDashboardSocket, playBeep]
    )

    return {
        dashboardWsState,
        overlayRef,
        connectDashboardSocket,
        closeDashboardSocket
    }
}
