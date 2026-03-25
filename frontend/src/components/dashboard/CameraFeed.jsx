import { VideoOff } from 'lucide-react'

export function CameraFeed({
    cameraRunning,
    viewportRef,
    frameCanvasRef,
    overlayCanvasRef,
    streamMetrics,
    toggleCamera,
    sessionId,
}) {
    return (
        <div className="standard-card flex flex-col h-[500px]">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border bg-surface flex items-center justify-between shrink-0">
                <label className={`flex items-center gap-3 ${!sessionId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <span className="text-sm font-semibold text-fg">Camera Feed</span>

                    {/* Square toggle */}
                    <div
                        className={`relative h-6 w-11 border transition-colors duration-200 ${cameraRunning ? 'bg-primary border-primary' : 'bg-card border-border'}`}
                    >
                        <div
                            className={`absolute top-0.5 left-0.5 h-5 w-5 bg-primary-fg shadow-sm transition-transform duration-200 ${cameraRunning ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                    </div>
                    <input
                        type="checkbox"
                        className="sr-only"
                        checked={cameraRunning}
                        onChange={toggleCamera}
                        disabled={!sessionId}
                        aria-label="Toggle camera"
                    />
                </label>

                {cameraRunning && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        LIVE
                    </div>
                )}
            </div>

            {/* Viewport */}
            <div className="flex-1 bg-[#0A0A0A] relative overflow-hidden">
                {!cameraRunning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                        <div className="w-14 h-14 bg-white/5 border border-white/10 flex items-center justify-center">
                            <VideoOff size={24} className="text-white/25" />
                        </div>
                        <span className="text-white/25 text-xs font-mono tracking-widest uppercase">
                            Stream Inactive
                        </span>
                    </div>
                )}
                <div ref={viewportRef} className="absolute inset-0">
                    <canvas ref={frameCanvasRef} className="absolute inset-0 w-full h-full" />
                    <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                </div>
            </div>
        </div>
    )
}
