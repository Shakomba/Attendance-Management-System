import { Check, X, HelpCircle, Loader2, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from '../../lib/i18n'

export function AttendanceTable({ attendance, sessionId, sessionStartTime, sessionEndTime, markManualAttendance, attendanceBusyByStudent }) {
  const { t } = useTranslation()
  const sessionEnded = !sessionId && !!sessionEndTime

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setElapsed(0)
    if (sessionStartTime && !sessionEnded) {
      const update = () => {
        setElapsed(Math.max(0, Math.floor((Date.now() - sessionStartTime.getTime()) / 1000)))
      }
      update()
      const interval = setInterval(update, 1000)
      return () => clearInterval(interval)
    }
  }, [sessionStartTime, sessionEnded])

  const formatElapsed = (seconds) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  if (!sessionId && !sessionEndTime) {
    return (
      <div className="standard-card flex flex-col items-center justify-center h-full min-h-[300px] text-secondary">
        <HelpCircle size={48} className="mb-4 opacity-20" />
        <p>{t('stat_absent_inactive')}</p>
      </div>
    )
  }

  return (
    <div className="standard-card flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center gap-2 text-xs font-mono text-secondary">
          {sessionStartTime && (
            <span>{t('history_started')} <span className="text-primary">{sessionStartTime.toLocaleTimeString()}</span> {!sessionEnded && `(${formatElapsed(elapsed)})`}</span>
          )}
          {sessionEnded && sessionEndTime && (
            <>
              <span className="opacity-40">·</span>
              <span>{t('history_ended')} <span className="text-primary">{sessionEndTime.toLocaleTimeString()}</span></span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[400px] lg:max-h-[500px]">
        {attendance.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-secondary text-sm">
            {t('attendance_no_students')}
          </div>
        ) : (
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="sticky top-0 bg-bg border-b border-border text-secondary text-xs uppercase z-10 hidden sm:table-header-group">
              <tr>
                <th className="px-6 py-3 font-medium">{t('table_student')}</th>
                <th className="px-6 py-3 font-medium">{t('table_status')}</th>
                <th className="px-6 py-3 font-medium">{t('table_first_seen')}</th>
                {!sessionEnded && <th className="px-6 py-3 font-medium text-end">{t('table_actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attendance.map((row) => {
                const busy = !sessionEnded && attendanceBusyByStudent[row.StudentID]
                const present = row.IsPresent
                const absentHours = Number(row.SessionAbsentHours ?? 0)
                const isLate = present && absentHours > 0

                return (
                  <tr key={row.StudentID} className="hover:bg-surface transition-colors">
                    <td className="px-3 py-3 sm:px-6 sm:py-4">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-primary">{row.FullName}</span>
                          </div>
                          {/* Mobile-only: show status + time beneath name */}
                          <div className="flex items-center gap-2 mt-1 sm:hidden">
                            {isLate ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-500">
                                <Clock size={10} /> {t('status_late')} ({absentHours}h)
                              </span>
                            ) : present ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                                <Check size={10} /> {t('status_present')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-secondary">
                                <X size={10} /> {t('status_absent')}
                              </span>
                            )}
                            {present && row.FirstSeenAt && (
                              <>
                                <span className="text-secondary/40">·</span>
                                <span className="text-[11px] font-mono text-secondary">
                                  {new Date(row.FirstSeenAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3 sm:px-6 sm:py-4 hidden sm:table-cell">
                      {isLate ? (
                        <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border border-red-500/40 bg-red-500/10 text-red-500 whitespace-nowrap">
                          <Clock size={12} /> {t('status_late')} ({absentHours}h)
                        </span>
                      ) : present ? (
                        <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border border-border bg-black text-white w-24">
                          <Check size={12} /> {t('status_present')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border border-border bg-surface text-secondary w-24">
                          <X size={12} /> {t('status_absent')}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 sm:px-6 sm:py-4 text-xs font-mono text-secondary hidden sm:table-cell">
                      {present && row.FirstSeenAt ? new Date(row.FirstSeenAt).toLocaleTimeString() : '-'}
                    </td>

                    {!sessionEnded && (
                      <td className="px-3 py-3 sm:px-6 sm:py-4 text-end">
                        {busy ? (
                          <Loader2 size={16} className="animate-spin inline-block text-secondary" />
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              disabled={!!present}
                              onClick={() => markManualAttendance(row.StudentID, row.FullName, "present")}
                              className="p-2.5 sm:p-1.5 rounded-sm border border-border text-secondary hover:bg-fg hover:text-bg hover:border-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all cursor-pointer"
                              title={t('action_mark_present')}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              disabled={!present}
                              onClick={() => markManualAttendance(row.StudentID, row.FullName, "absent")}
                              className="p-2.5 sm:p-1.5 rounded-sm border border-border text-secondary hover:bg-surface hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                              title={t('action_mark_absent')}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
