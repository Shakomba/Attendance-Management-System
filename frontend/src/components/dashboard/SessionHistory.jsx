import { useState, useEffect, useCallback } from 'react'
import { History, ChevronRight, ChevronDown, UserX, Users, Check, Loader2, RefreshCw } from 'lucide-react'

function StatusBadge({ status }) {
    if (status === 'finalized') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                <Check size={10} strokeWidth={2.5} /> Finalized
            </span>
        )
    }
    if (status === 'active') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border bg-surface text-fg">
                <span className="w-1.5 h-1.5 rounded-full bg-fg animate-pulse" />
                Active
            </span>
        )
    }
    return (
        <span className="px-2.5 py-1 text-xs font-medium border border-border text-secondary">
            {status}
        </span>
    )
}

function SessionRow({ session }) {
    const [expanded, setExpanded] = useState(false)

    const startDate   = session.started_at ? new Date(session.started_at) : null
    const endDate     = session.ended_at   ? new Date(session.ended_at)   : null
    const displayStatus = endDate ? 'finalized' : session.status

    const durationMin = startDate && endDate
        ? Math.round((endDate - startDate) / 60000)
        : null

    const presentPct = session.total_enrolled > 0
        ? Math.round((session.present_count / session.total_enrolled) * 100)
        : 0

    return (
        <>
            <tr
                className="hover:bg-surface transition-colors duration-100 cursor-pointer"
                onClick={() => session.absent_count > 0 && setExpanded(e => !e)}
            >
                <td className="px-5 py-4">
                    <div className="font-medium text-fg text-sm">
                        {startDate
                            ? startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                            : '—'}
                    </div>
                    <div className="text-xs font-mono text-secondary mt-0.5">
                        {startDate
                            ? startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        {durationMin !== null && (
                            <span className="ml-1.5 opacity-60">· {durationMin}m</span>
                        )}
                    </div>
                </td>

                <td className="px-4 py-4 hidden sm:table-cell">
                    <StatusBadge status={displayStatus} />
                </td>

                <td className="px-4 py-4">
                    <div className="flex items-center gap-3 text-xs font-mono mb-1.5">
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Present">
                            <Check size={11} strokeWidth={2.5} /> {session.present_count}
                        </span>
                        <span className="flex items-center gap-1 text-red-500 dark:text-red-400" title="Absent">
                            <UserX size={11} /> {session.absent_count}
                        </span>
                    </div>
                    <div className="h-1.5 w-28 bg-border overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 transition-all duration-500"
                            style={{ width: `${presentPct}%` }}
                        />
                    </div>
                </td>

                <td className="px-5 py-4 text-right">
                    {session.absent_count > 0 ? (
                        <button
                            className="p-1 text-secondary hover:text-fg hover:bg-surface transition-all cursor-pointer"
                            aria-label={expanded ? 'Collapse' : 'Show absentees'}
                            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
                        >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                    ) : (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Full attendance</span>
                    )}
                </td>
            </tr>

            {expanded && session.absent_count > 0 && (
                <tr className="bg-surface">
                    <td colSpan={4} className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                            {session.absentees.map(s => (
                                <span
                                    key={s.student_id}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                                >
                                    <UserX size={10} />
                                    {s.full_name}
                                </span>
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    )
}

export function SessionHistory({ apiFetch, courseId }) {
    const [sessions, setSessions] = useState([])
    const [loading, setLoading]   = useState(false)
    const [error, setError]       = useState(null)

    const load = useCallback(async () => {
        if (!courseId) return
        setLoading(true)
        setError(null)
        try {
            const data = await apiFetch(`/api/courses/${courseId}/sessions/history`)
            setSessions(data?.sessions ?? [])
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [apiFetch, courseId])

    useEffect(() => { load() }, [load])

    return (
        <div className="standard-card flex flex-col">
            <div className="px-5 py-3.5 border-b border-border bg-surface flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <History size={16} className="text-secondary" />
                    <span className="text-sm font-semibold text-fg">Lecture History</span>
                    {sessions.length > 0 && (
                        <span className="text-xs font-mono px-2 py-0.5 bg-card text-secondary border border-border">
                            {sessions.length} lecture{sessions.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="p-1.5 border border-border text-secondary hover:bg-primary hover:text-primary-fg hover:border-primary disabled:opacity-40 transition-all cursor-pointer"
                    aria-label="Refresh history"
                    title="Refresh"
                >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {loading && sessions.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-16 text-secondary text-sm">
                    <Loader2 size={18} className="animate-spin" />
                    Loading lectures…
                </div>
            ) : error ? (
                <div className="flex items-center justify-center py-16 text-red-500 dark:text-red-400 text-sm">
                    {error}
                </div>
            ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-secondary text-sm">
                    <div className="w-14 h-14 bg-surface border border-border flex items-center justify-center">
                        <History size={22} className="opacity-30" />
                    </div>
                    <span>No lectures recorded yet</span>
                </div>
            ) : (
                <div className="overflow-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="sticky top-0 bg-card border-b border-border text-secondary text-xs uppercase z-10">
                            <tr>
                                <th className="px-5 py-3 font-medium">Date</th>
                                <th className="px-4 py-3 font-medium hidden sm:table-cell">Status</th>
                                <th className="px-4 py-3 font-medium">Attendance</th>
                                <th className="px-5 py-3 font-medium text-right">
                                    <span className="flex items-center justify-end gap-1">
                                        <Users size={12} /> {sessions[0]?.total_enrolled ?? 0}
                                    </span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {sessions.map(s => <SessionRow key={s.session_id} session={s} />)}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
