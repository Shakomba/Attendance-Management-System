import { useEffect, useRef } from 'react'
import { X, CheckCircle2, AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, User, Loader2 } from 'lucide-react'

const POSE_ICONS = {
    front: User,
    left: ArrowLeft,
    right: ArrowRight,
    up: ArrowUp,
    down: ArrowDown,
}

const POSE_LABELS = ['front', 'left', 'right', 'up', 'down']

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

    // Mirror the enrollment video onto a visible canvas for the user.
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

    const PoseIcon = currentPose ? (POSE_ICONS[currentPose] || User) : User

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-bg border border-border rounded-sm shadow-xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <div>
                        <h2 className="text-base font-semibold text-fg">Face Enrollment</h2>
                        <p className="text-xs text-secondary mt-0.5">{studentName}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-secondary hover:text-fg transition-colors cursor-pointer">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-5 py-5 space-y-4">

                    {/* Completion state */}
                    {complete && (
                        <div className="flex flex-col items-center py-8 space-y-3">
                            <CheckCircle2 size={48} className="text-green-500" />
                            <p className="text-sm font-medium text-fg">Enrollment Complete</p>
                            <p className="text-xs text-secondary">All {totalPoses} poses captured successfully. Anti-spoofing protection is now active.</p>
                            <button
                                onClick={onClose}
                                className="mt-3 px-4 py-2 rounded-sm text-xs font-medium bg-fg text-bg hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                Done
                            </button>
                        </div>
                    )}

                    {/* Error state */}
                    {error && !complete && (
                        <div className="flex flex-col items-center py-8 space-y-3">
                            <AlertTriangle size={48} className="text-red-500" />
                            <p className="text-sm font-medium text-fg">Enrollment Failed</p>
                            <p className="text-xs text-secondary text-center max-w-xs">{error}</p>
                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={onStart}
                                    className="px-4 py-2 rounded-sm text-xs font-medium bg-fg text-bg hover:opacity-80 transition-opacity cursor-pointer"
                                >
                                    Try Again
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 rounded-sm text-xs font-medium border border-border text-secondary hover:text-fg transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Idle / not started */}
                    {!enrolling && !complete && !error && (
                        <div className="flex flex-col items-center py-6 space-y-4">
                            <div className="w-20 h-20 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                                <User size={32} className="text-secondary" />
                            </div>
                            <div className="text-center space-y-1">
                                <p className="text-sm font-medium text-fg">3D Face Enrollment</p>
                                <p className="text-xs text-secondary max-w-xs">
                                    The student will be asked to look in 5 directions (front, left, right, up, down).
                                    This prevents photo-based spoofing.
                                </p>
                            </div>
                            <button
                                onClick={onStart}
                                className="px-5 py-2.5 rounded-sm text-xs font-medium bg-fg text-bg hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                Start Enrollment
                            </button>
                        </div>
                    )}

                    {/* Active enrollment */}
                    {enrolling && !complete && !error && (
                        <>
                            {/* Camera preview */}
                            <div className="relative aspect-[4/3] bg-black rounded-sm overflow-hidden">
                                <canvas
                                    ref={mirrorRef}
                                    className="absolute inset-0 w-full h-full object-cover"
                                />
                                {/* Oval guide overlay */}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="w-48 h-60 border-2 border-white/30 rounded-[50%]" />
                                </div>
                                {/* Pose direction indicator */}
                                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
                                    <PoseIcon size={14} className="text-white" />
                                    <span className="text-xs font-medium text-white">{poseMessage || `Look ${currentPose}`}</span>
                                </div>
                                {/* Rejection feedback */}
                                {rejected && (
                                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-red-500/90 backdrop-blur-sm px-3 py-1.5 rounded-sm max-w-[90%]">
                                        <span className="text-xs font-medium text-white">{rejected}</span>
                                    </div>
                                )}
                            </div>

                            {/* Progress dots */}
                            <div className="flex items-center justify-center gap-3">
                                {POSE_LABELS.map((pose, i) => {
                                    const captured = i < progress
                                    const active = pose === currentPose
                                    const Icon = POSE_ICONS[pose] || User
                                    return (
                                        <div
                                            key={pose}
                                            className={`flex flex-col items-center gap-1 transition-all duration-300 ${active ? 'scale-110' : ''}`}
                                        >
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                                                captured
                                                    ? 'bg-green-500 border-green-500 text-white'
                                                    : active
                                                        ? 'border-fg text-fg bg-surface'
                                                        : 'border-border text-secondary'
                                            }`}>
                                                {captured ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                                            </div>
                                            <span className={`text-[10px] font-medium capitalize ${
                                                active ? 'text-fg' : 'text-secondary'
                                            }`}>{pose}</span>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Cancel button */}
                            <div className="flex justify-center">
                                <button
                                    onClick={onStop}
                                    className="px-4 py-2 rounded-sm text-xs font-medium border border-border text-secondary hover:text-red-500 hover:border-red-500/40 transition-colors cursor-pointer"
                                >
                                    Cancel Enrollment
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Hidden elements for WebSocket capture */}
                <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
        </div>
    )
}
