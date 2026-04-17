import { Activity, VideoOff } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export function CameraFeed({
  cameraRunning,
  viewportRef,
  frameCanvasRef,
  overlayCanvasRef,
  toggleCamera,
  sessionId
}) {
  const { t } = useTranslation()
  
  return (
    <div className="standard-card flex flex-col h-[260px] sm:h-[360px] lg:h-[500px]">
      <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border bg-surface flex items-center justify-between">
        <label
          className={`flex items-center gap-2 sm:gap-3 cursor-pointer user-select-none ${!sessionId ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="text-xs sm:text-sm font-semibold tracking-tight uppercase text-primary">
            {t('camera_live')}
          </span>
          <div className={`relative h-5 w-9 transition-colors border border-fg ${cameraRunning ? 'bg-fg' : 'bg-surface'}`}>
            <div className={`absolute top-[2px] left-[2px] h-[14px] w-[14px] transition-transform duration-200 ${cameraRunning ? 'translate-x-[18px] bg-bg' : 'bg-fg'}`}></div>
          </div>
          <input
            type="checkbox"
            className="sr-only"
            checked={cameraRunning}
            onChange={toggleCamera}
            disabled={!sessionId}
          />
        </label>

        {cameraRunning && (
          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fg opacity-40"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-fg"></span>
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 bg-[#09090B] relative overflow-hidden">
        {!cameraRunning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30 z-10 font-mono text-sm gap-2">
            <VideoOff size={32} />
            <span>{t('camera_offline')}</span>
          </div>
        )}
        <div ref={viewportRef} className="absolute inset-0">
          <canvas
            ref={frameCanvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: 'contain' }}
          />
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ objectFit: 'contain' }}
          />
        </div>
      </div>
    </div>
  )
}
