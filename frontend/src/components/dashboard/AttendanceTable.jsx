import { cn } from '../../lib/utils'

export function AttendanceTable({
    attendance,
    sessionId,
    markManualAttendance,
    attendanceBusyByStudent
}) {
    return (
        <article className="standard-card flex flex-col min-h-[300px] h-full">
            <header className="p-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                    Attendance Log
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Current session check-ins</p>
            </header>

            <div className="flex-1 overflow-auto scroll-slim">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                        <tr className="text-slate-500 dark:text-slate-400 font-medium text-xs">
                            <th className="px-5 py-3 rounded-tl-lg">Student</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3 rounded-tr-lg">Manual Entry</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        {attendance.map((row) => {
                            const isRowBusy = Boolean(attendanceBusyByStudent[row.StudentID])
                            const isAbsent = !row.IsPresent
                            const isLate = Boolean(row.IsPresent && row.IsLate)

                            return (
                                <tr
                                    key={`${row.StudentID}-${row.FullName}`}
                                    className={cn(
                                        "group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50",
                                        isAbsent && "bg-rose-50/50 dark:bg-rose-900/10",
                                        isLate && "bg-amber-50/50 dark:bg-amber-900/10"
                                    )}
                                >
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs",
                                                isAbsent ? "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400" :
                                                    isLate ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400" :
                                                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
                                            )}>
                                                {row.FullName.charAt(0)}
                                            </div>
                                            <span className="font-medium text-slate-900 dark:text-slate-200">{row.FullName}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        {isAbsent ? (
                                            <span className="px-2.5 py-1 text-xs font-medium rounded-md badge-danger">Absent</span>
                                        ) : isLate ? (
                                            <span className="px-2.5 py-1 text-xs font-medium rounded-md badge-warning">Late ({row.ArrivalDelayMinutes ?? '-'}m)</span>
                                        ) : (
                                            <span className="px-2.5 py-1 text-xs font-medium rounded-md badge-success">Present</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex gap-2">
                                            <select
                                                className="standard-input text-xs py-1.5 px-2 rounded-md font-medium text-slate-700 dark:text-slate-300"
                                                disabled={!sessionId || isRowBusy}
                                                value={isAbsent ? 'absent' : isLate ? 'late' : 'present'}
                                                onChange={(e) => markManualAttendance(row.StudentID, row.FullName, e.target.value)}
                                            >
                                                <option value="present">Mark Present</option>
                                                <option value="late">Mark Late</option>
                                                <option value="absent">Mark Absent</option>
                                            </select>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}

                        {!attendance.length && (
                            <tr>
                                <td colSpan={3} className="px-5 py-16 text-center text-slate-500 dark:text-slate-400">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <span className="text-sm">No students recorded yet. Turn on the camera to begin.</span>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </article>
    )
}
