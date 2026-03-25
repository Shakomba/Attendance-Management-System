import { Check, X, HelpCircle, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'

export function AttendanceTable({ attendance, sessionId, sessionStartTime, sessionEndTime, markManualAttendance, attendanceBusyByStudent }) {
    const sessionEnded = !sessionId && !!sessionEndTime

    const [elapsed, setElapsed] = useState(0)
    useEffect(() => {
        setElapsed(0)
        if (sessionStartTime && !sessionEnded) {
            const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - sessionStartTime.getTime()) / 1000)))
            update()
            const id = setInterval(update, 1000)
            return () => clearInterval(id)
        }
    }, [sessionStartTime, sessionEnded])

    const formatElapsed = (s) => {
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        const sec = s % 60
        return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    }

    if (!sessionId && !sessionEndTime) {
        return (
            <div className="standard-card flex flex-col items-center justify-center h-full min-h-[300px] text-secondary gap-3">
                <div className="w-14 h-14 bg-surface border border-border flex items-center justify-center">
                    <HelpCircle size={24} className="opacity-40" />
                </div>
                <p className="text-sm">No active lecture</p>
            </div>
        )
    }

    return (
        <div className="standard-card flex flex-col h-full">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border bg-surface flex items-center justify-between shrink-0">
                <h2 className="text-sm font-semibold text-fg">Attendance</h2>
                <div className="text-xs font-mono text-secondary">
                    {sessionStartTime && (
                        <span>
                            {sessionStartTime.toLocaleTimeString()}
                            {!sessionEnded && (
                                <span className="ml-1.5 px-1.5 py-0.5 bg-surface border border-border text-fg font-semibold">
                                    {formatElapsed(elapsed)}
                                </span>
                            )}
                        </span>
                    )}
                    {sessionEnded && sessionEndTime && (
                        <span className="ml-1 text-secondary">→ {sessionEndTime.toLocaleTimeString()}</span>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto max-h-[500px]">
                {attendance.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-secondary text-sm">
                        No students registered for this course.
                    </div>
                ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="sticky top-0 bg-card border-b border-border text-secondary text-xs uppercase z-10 hidden sm:table-header-group">
                            <tr>
                                <th className="px-5 py-3 font-medium">Student</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Arrived</th>
                                {!sessionEnded && <th className="px-5 py-3 font-medium text-right">Override</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {attendance.map((row) => {
                                const busy = !sessionEnded && attendanceBusyByStudent[row.StudentID]
                                const present = row.IsPresent

                                return (
                                    <tr key={row.StudentID} className="hover:bg-surface transition-colors duration-100">
                                        <td className="px-5 py-3.5">
                                            <span className="font-medium text-fg">{row.FullName}</span>
                                        </td>

                                        <td className="px-4 py-3.5 hidden sm:table-cell">
                                            {present ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                                    <Check size={11} strokeWidth={2.5} /> Present
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-surface text-secondary border border-border">
                                                    <X size={11} strokeWidth={2.5} /> Absent
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-4 py-3.5 text-xs font-mono text-secondary hidden sm:table-cell">
                                            {present && row.FirstSeenAt
                                                ? new Date(row.FirstSeenAt).toLocaleTimeString()
                                                : '—'}
                                        </td>

                                        {!sessionEnded && (
                                            <td className="px-5 py-3.5 text-right">
                                                {busy ? (
                                                    <Loader2 size={15} className="animate-spin inline-block text-secondary" />
                                                ) : (
                                                    <div className="flex justify-end gap-1.5">
                                                        <button
                                                            disabled={!!present}
                                                            onClick={() => markManualAttendance(row.StudentID, row.FullName, 'present')}
                                                            className="p-1.5 border border-border text-secondary hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:border-emerald-800 dark:hover:text-emerald-400 disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer"
                                                            title="Mark Present"
                                                            aria-label="Mark Present"
                                                        >
                                                            <Check size={13} strokeWidth={2.5} />
                                                        </button>
                                                        <button
                                                            disabled={!present}
                                                            onClick={() => markManualAttendance(row.StudentID, row.FullName, 'absent')}
                                                            className="p-1.5 border border-border text-secondary hover:bg-red-50 hover:border-red-200 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:border-red-800 dark:hover:text-red-400 disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer"
                                                            title="Mark Absent"
                                                            aria-label="Mark Absent"
                                                        >
                                                            <X size={13} strokeWidth={2.5} />
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
