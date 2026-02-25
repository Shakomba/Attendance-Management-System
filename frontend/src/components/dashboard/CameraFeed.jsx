import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'

export function CameraFeed({
    cameraRunning,
    viewportRef,
    frameCanvasRef,
    overlayCanvasRef
}) {
    return (
        <article className="standard-card flex flex-col min-h-[400px]">
            <header className="p-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-col">
                    <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                            {cameraRunning && (
                                <>
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </>
                            )}
                            {!cameraRunning && (
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-300 dark:bg-slate-700"></span>
                            )}
                        </span>
                        Live Camera Feed
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Automated attendance scanning</p>
                </div>
            </header>

            <div className="relative flex-1 p-3 bg-slate-50 dark:bg-slate-900 rounded-b-xl overflow-hidden">
                <div
                    ref={viewportRef}
                    className={cn(
                        "relative w-full h-[55vh] min-h-[350px] overflow-hidden rounded-lg border",
                        "bg-black transition-colors duration-300",
                        cameraRunning ? "border-emerald-500/30 shadow-sm" : "border-slate-300 dark:border-slate-800"
                    )}
                >
                    {/* Frame Canvas */}
                    <canvas
                        ref={frameCanvasRef}
                        className="absolute inset-0 h-full w-full object-contain"
                        aria-label="Live frame"
                    />

                    {/* Overlay Canvas */}
                    <canvas
                        ref={overlayCanvasRef}
                        className="absolute inset-0 h-full w-full object-contain pointer-events-none z-20"
                        aria-hidden="true"
                    />

                    {/* Idle State */}
                    {!cameraRunning && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-900 z-30">
                            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-4 text-slate-400">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 2 20 20" /><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" /><path d="M13.87 13.87a2 2 0 0 1-2.82-2.82" /><path d="M17.41 17.41a2 2 0 1 0-2.83-2.83" /><path d="M2.06 2.06a2 2 0 0 0 2.83 2.83" /><path d="M22 8v10a2 2 0 0 1-2 2H4" /><path d="M6 14v4" /><path d="M14 14v4" /></svg>
                            </div>
                            <h3 className="text-lg font-medium text-slate-200">Camera Offline</h3>
                            <p className="mt-1 text-sm text-slate-400 max-w-sm">Turn on the camera to begin scanning students.</p>
                        </div>
                    )}
                </div>
            </div>
        </article>
    )
}
