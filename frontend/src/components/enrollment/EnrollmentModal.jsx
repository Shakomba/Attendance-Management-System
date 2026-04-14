import { useEffect, useRef } from 'react'
import { X, CheckCircle2, AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, User, ScanFace } from 'lucide-react'

const POSE_ICONS = {
    front: User,
    left: ArrowLeft,
    right: ArrowRight,
    up: ArrowUp,
    down: ArrowDown,
}

const POSE_LABELS = ['front', 'left', 'right', 'up', 'down']

const POSE_CMD = {
    front: 'FACE FORWARD',
    left: 'TURN LEFT',
    right: 'TURN RIGHT',
    up: 'LOOK UP',
    down: 'LOOK DOWN',
}

export function EnrollmentModal({
    studentName,
    enrolling,
    currentPose,
    poseMessage,
    progress,
    totalPoses,
    error,
    complete,
    rejected,
    onStart,
    onStop,
    onClose,
    videoRef,
    canvasRef,
}) {
    const mirrorRef = useRef(null)

    useEffect(() => {
        if (!enrolling) return
        let rafId = 0
        const draw = () => {
            const video = videoRef?.current
            const mirror = mirrorRef.current
            if (video && mirror && video.readyState >= 2 && video.videoWidth > 0) {
                const ctx = mirror.getContext('2d')
                if (ctx) {
                    const dpr = window.devicePixelRatio || 1
                    const rect = mirror.getBoundingClientRect()
                    const cw = Math.round(rect.width * dpr)
                    const ch = Math.round(rect.height * dpr)
                    if (mirror.width !== cw || mirror.height !== ch) {
                        mirror.width = cw
                        mirror.height = ch
                    }
                    ctx.setTransform(-dpr, 0, 0, dpr, rect.width * dpr, 0)
                    ctx.drawImage(video, 0, 0, rect.width, rect.height)
                    ctx.setTransform(1, 0, 0, 1, 0, 0)
                }
            }
            rafId = requestAnimationFrame(draw)
        }
        rafId = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(rafId)
    }, [enrolling, videoRef])

    const poseCmd = currentPose ? (POSE_CMD[currentPose] || currentPose.toUpperCase()) : ''

    return (
        <>
            <style>{`
                @keyframes ams-scan {
                    0%   { top: -10%; opacity: 0.6; }
                    80%  { opacity: 0.6; }
                    100% { top: 110%;  opacity: 0; }
                }
                @keyframes ams-glow-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
                    50%      { box-shadow: 0 0 0 8px rgba(34,197,94,0.15); }
                }
                @keyframes ams-fade-in {
                    from { opacity: 0; transform: scale(0.97); }
                    to   { opacity: 1; transform: scale(1); }
                }
                .ams-modal { animation: ams-fade-in 0.18s ease-out both; }
                .ams-scanline {
                    position: absolute; left: 0; right: 0; height: 60px;
                    background: linear-gradient(to bottom, transparent, rgba(34,197,94,0.12), transparent);
                    animation: ams-scan 2.8s linear infinite;
                    pointer-events: none;
                }
                .ams-active-ring { animation: ams-glow-pulse 1.6s ease-in-out infinite; }
            `}</style>

            <div
                className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
                onClick={onClose}
            >
                <div
                    className="ams-modal bg-bg border border-border w-full sm:max-w-sm shadow-2xl mb-0 sm:mb-0"
                    onClick={e => e.stopPropagation()}
                    style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 30px 60px rgba(0,0,0,0.7)' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
                        <div className="flex items-center gap-2.5">
                            <ScanFace size={13} className="text-secondary" />
                            <span className="text-[10px] font-mono uppercase tracking-widest text-secondary">
                                Biometric Enrollment
                            </span>
                            <span className="text-[10px] font-mono text-fg opacity-60">/ {studentName}</span>
                        </div>
                        <button onClick={onClose} className="p-1 text-secondary hover:text-fg transition-colors cursor-pointer">
                            <X size={14} />
                        </button>
                    </div>

                    {/* ── COMPLETE ─────────────────────────────────── */}
                    {complete && (
                        <div className="px-6 py-12 flex flex-col items-center gap-5">
                            <div className="ams-active-ring w-16 h-16 border-2 border-green-500 flex items-center justify-center">
                                <CheckCircle2 size={26} className="text-green-500" />
                            </div>
                            <div className="text-center">
                                <p className="text-[10px] font-mono uppercase tracking-widest text-green-500 mb-1.5">
                                    Registration Complete
                                </p>
                                <p className="text-[11px] font-mono text-secondary">
                                    {totalPoses} biometric vectors captured
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="mt-1 px-8 py-2.5 text-xs font-mono uppercase tracking-wider bg-green-500 text-black hover:bg-green-400 transition-colors cursor-pointer"
                            >
                                Confirm
                            </button>
                        </div>
                    )}

                    {/* ── ERROR ────────────────────────────────────── */}
                    {error && !complete && (
                        <div className="px-6 py-10 flex flex-col items-center gap-4">
                            <div className="w-14 h-14 border border-red-500/40 flex items-center justify-center">
                                <AlertTriangle size={22} className="text-red-500" />
                            </div>
                            <div className="text-center">
                                <p className="text-[10px] font-mono uppercase tracking-widest text-red-500 mb-2">
                                    Scan Failed
                                </p>
                                <p className="text-[11px] font-mono text-secondary text-center max-w-[220px] leading-relaxed">
                                    {error}
                                </p>
                            </div>
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={onStart}
                                    className="px-5 py-2 text-xs font-mono uppercase tracking-wider border border-fg text-fg hover:bg-fg hover:text-bg transition-colors cursor-pointer"
                                >
                                    Retry
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-5 py-2 text-xs font-mono uppercase tracking-wider border border-border text-secondary hover:text-fg transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── IDLE ─────────────────────────────────────── */}
                    {!enrolling && !complete && !error && (
                        <div className="px-6 py-8 flex flex-col items-center gap-6">
                            {/* Pose diagram */}
                            <div className="grid grid-cols-3 grid-rows-3 gap-2 w-44">
                                {/* Row 1 */}
                                <div />
                                <div className="border border-border flex flex-col items-center justify-center py-2 gap-1 opacity-50">
                                    <ArrowUp size={12} className="text-secondary" />
                                    <span className="text-[8px] font-mono text-secondary uppercase">up</span>
                                </div>
                                <div />
                                {/* Row 2 */}
                                <div className="border border-border flex flex-col items-center justify-center py-2 gap-1 opacity-50">
                                    <ArrowLeft size={12} className="text-secondary" />
                                    <span className="text-[8px] font-mono text-secondary uppercase">left</span>
                                </div>
                                <div className="border-2 border-fg flex flex-col items-center justify-center py-2 gap-1">
                                    <User size={14} className="text-fg" />
                                    <span className="text-[8px] font-mono text-fg uppercase">front</span>
                                </div>
                                <div className="border border-border flex flex-col items-center justify-center py-2 gap-1 opacity-50">
                                    <ArrowRight size={12} className="text-secondary" />
                                    <span className="text-[8px] font-mono text-secondary uppercase">right</span>
                                </div>
                                {/* Row 3 */}
                                <div />
                                <div className="border border-border flex flex-col items-center justify-center py-2 gap-1 opacity-50">
                                    <ArrowDown size={12} className="text-secondary" />
                                    <span className="text-[8px] font-mono text-secondary uppercase">down</span>
                                </div>
                                <div />
                            </div>

                            <div className="text-center">
                                <p className="text-[10px] font-mono uppercase tracking-widest text-fg mb-1.5">
                                    5-Angle Face Scan
                                </p>
                                <p className="text-[11px] font-mono text-secondary leading-relaxed max-w-[200px] text-center">
                                    Follow the on-screen prompts to capture all pose vectors
                                </p>
                            </div>

                            <button
                                onClick={onStart}
                                className="px-10 py-3 text-xs font-mono uppercase tracking-widest bg-fg text-bg hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                Begin Scan
                            </button>
                        </div>
                    )}

                    {/* ── ACTIVE ───────────────────────────────────── */}
                    {enrolling && !complete && !error && (
                        <>
                            {/* Camera feed */}
                            <div className="relative bg-black overflow-hidden" style={{ aspectRatio: '4/3' }}>
                                <canvas ref={mirrorRef} className="absolute inset-0 w-full h-full object-cover" />

                                {/* Scan animation */}
                                <div className="ams-scanline" />

                                {/* Corner brackets */}
                                {[
                                    'top-4 left-4 border-t-2 border-l-2',
                                    'top-4 right-4 border-t-2 border-r-2',
                                    'bottom-4 left-4 border-b-2 border-l-2',
                                    'bottom-4 right-4 border-b-2 border-r-2',
                                ].map((cls, i) => (
                                    <div key={i} className={`absolute w-5 h-5 border-white/50 pointer-events-none ${cls}`} />
                                ))}

                                {/* Face oval */}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div
                                        className="border border-white/20 rounded-[50%]"
                                        style={{ width: '42%', height: '68%' }}
                                    />
                                </div>

                                {/* Pose instruction */}
                                <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
                                    <div className="bg-black/70 border border-white/10 px-4 py-1.5">
                                        <p className="text-[10px] font-mono uppercase tracking-widest text-white">
                                            {poseCmd}
                                        </p>
                                    </div>
                                </div>

                                {/* Rejection overlay */}
                                {rejected && (
                                    <div className="absolute bottom-3 inset-x-3 bg-red-500/85 border border-red-400/30 px-3 py-2">
                                        <p className="text-[10px] font-mono text-white leading-relaxed">{rejected}</p>
                                    </div>
                                )}
                            </div>

                            {/* Pose indicators */}
                            <div className="px-5 py-4 border-t border-border">
                                <div className="flex items-start justify-between gap-1">
                                    {POSE_LABELS.map((pose, i) => {
                                        const captured = i < progress
                                        const active = pose === currentPose
                                        const Icon = POSE_ICONS[pose] || User
                                        return (
                                            <div key={pose} className="flex-1 flex flex-col items-center gap-1.5">
                                                <div className={`w-9 h-9 border flex items-center justify-center transition-all duration-300 ${
                                                    captured
                                                        ? 'border-green-500 bg-green-500/10 text-green-500'
                                                        : active
                                                            ? 'border-fg text-fg bg-surface'
                                                            : 'border-border text-secondary/30'
                                                }`}>
                                                    {captured ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                                                </div>
                                                <span className={`text-[9px] font-mono uppercase tracking-wide ${
                                                    captured ? 'text-green-500' : active ? 'text-fg' : 'text-secondary/30'
                                                }`}>{pose}</span>
                                            </div>
                                        )
                                    })}
                                </div>

                                {/* Progress bar */}
                                <div className="mt-3 h-px bg-border overflow-hidden">
                                    <div
                                        className="h-full bg-green-500 transition-all duration-500"
                                        style={{ width: `${(progress / (totalPoses || 5)) * 100}%` }}
                                    />
                                </div>

                                <div className="mt-3 flex justify-center">
                                    <button
                                        onClick={onStop}
                                        className="text-[10px] font-mono uppercase tracking-widest text-secondary hover:text-red-400 transition-colors cursor-pointer"
                                    >
                                        Abort
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Hidden capture elements */}
                    <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>
            </div>
        </>
    )
}
