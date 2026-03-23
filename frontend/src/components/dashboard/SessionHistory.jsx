import { useState, useEffect, useCallback } from 'react'
import { History, ChevronRight, ChevronDown, UserX, Users, Check, Loader2, RefreshCw } from 'lucide-react'

function StatusBadge({ status }) {
  if (status === 'finalized') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium border border-border bg-surface text-secondary">
        <Check size={10} /> Finalized
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-medium border border-green-500/40 bg-green-500/10 text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Active
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded-sm text-xs font-medium border border-border text-secondary">
      {status}
    </span>
  )
}

function SessionRow({ session }) {
  const [expanded, setExpanded] = useState(false)

  const startDate = session.started_at ? new Date(session.started_at) : null
  const endDate = session.ended_at ? new Date(session.ended_at) : null

  const durationMin = startDate && endDate
    ? Math.round((endDate - startDate) / 60000)
    : null

  const absentPct = session.total_enrolled > 0
    ? Math.round((session.absent_count / session.total_enrolled) * 100)
    : 0

  return (
    <>
      <tr
        className="hover:bg-surface transition-colors duration-150 cursor-pointer"
        onClick={() => session.absent_count > 0 && setExpanded(e => !e)}
      >
        {/* Date / Time */}
        <td className="px-6 py-4">
          <div className="font-medium text-primary text-sm">
            {startDate ? startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
          </div>
          <div className="text-xs font-mono text-secondary mt-0.5">
            {startDate ? startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
            {durationMin !== null && <span className="ml-1 opacity-60">· {durationMin}m</span>}
          </div>
        </td>

        {/* Status */}
        <td className="px-6 py-4 hidden sm:table-cell">
          <StatusBadge status={session.status} />
        </td>

        {/* Stats */}
        <td className="px-6 py-4">
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="flex items-center gap-1 text-green-500" title="Present">
              <Check size={11} /> {session.present_count}
            </span>
            <span className="flex items-center gap-1 text-red-500" title="Absent">
              <UserX size={11} /> {session.absent_count}
            </span>
          </div>
          {/* Attendance bar */}
          <div className="mt-1.5 h-1 w-24 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-500"
              style={{ width: `${100 - absentPct}%` }}
            />
          </div>
        </td>

        {/* Expand toggle */}
        <td className="px-6 py-4 text-right">
          {session.absent_count > 0 ? (
            <button
              className="p-1 text-secondary hover:text-fg transition-colors duration-150"
              aria-label={expanded ? 'Collapse' : 'Expand absent list'}
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="text-xs text-secondary font-mono">full attendance</span>
          )}
        </td>
      </tr>

      {/* Expanded absent list */}
      {expanded && session.absent_count > 0 && (
        <tr className="bg-surface">
          <td colSpan={4} className="px-6 py-3">
            <div className="flex flex-wrap gap-2">
              {session.absentees.map(s => (
                <span
                  key={s.student_id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs border border-red-500/30 bg-red-500/10 text-red-400 font-medium"
                >
                  <UserX size={11} />
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-surface flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History size={16} className="text-secondary" />
          <span className="text-sm font-semibold tracking-tight uppercase text-primary">Lecture History</span>
          {sessions.length > 0 && (
            <span className="text-xs font-mono text-secondary ml-1">
              ({sessions.length} lecture{sessions.length !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded-sm border border-border text-secondary hover:bg-fg hover:text-bg hover:border-fg disabled:opacity-40 transition-all duration-150"
          aria-label="Refresh history"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-secondary text-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading lectures…
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-16 text-red-500 text-sm">
          {error}
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-secondary text-sm">
          <History size={36} className="opacity-20" />
          <span>No lectures recorded yet</span>
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="sticky top-0 bg-bg border-b border-border text-secondary text-xs uppercase z-10 hidden sm:table-header-group">
              <tr>
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-6 py-3 font-medium hidden sm:table-cell">Status</th>
                <th className="px-6 py-3 font-medium">Attendance</th>
                <th className="px-6 py-3 font-medium text-right">
                  <span className="flex items-center justify-end gap-1">
                    <Users size={12} /> {sessions[0]?.total_enrolled ?? 0} enrolled
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
