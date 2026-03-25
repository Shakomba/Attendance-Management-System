import { useState, useMemo, useEffect, useRef } from 'react'
import { Mail, Send, FileText, Clock, X, AlertTriangle, XCircle, Loader2, CheckCircle2 } from 'lucide-react'

/* ── Toast ─────────────────────────────────────────────────────────── */
const TOAST_MS  = 5000
const RING_R    = 10
const RING_CIRC = 2 * Math.PI * RING_R

function Toast({ toast, onClose }) {
    const isSuccess = toast.type === 'success'
    const accent    = isSuccess ? '#10b981' : '#ef4444'

    const [exiting, setExiting] = useState(false)
    const timerRef = useRef(null)

    const handleClose = () => {
        if (exiting) return
        setExiting(true)
        clearTimeout(timerRef.current)
        setTimeout(onClose, 350)
    }

    useEffect(() => {
        timerRef.current = setTimeout(() => {
            setExiting(true)
            setTimeout(onClose, 350)
        }, TOAST_MS)
        return () => clearTimeout(timerRef.current)
    }, [])

    return (
        <div
            style={{ animation: `${exiting ? 'toastSlideOut' : 'toastSlideIn'} 0.35s cubic-bezier(0.16,1,0.3,1) forwards` }}
            className={`flex items-start gap-3 px-4 py-3 shadow-xl border text-sm max-w-sm w-full pointer-events-auto ${
                isSuccess
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                    : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100'
            }`}
        >
            {isSuccess
                ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                : <XCircle     size={18} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
            }
            <div className="flex-1 min-w-0">
                <p className="font-semibold">{toast.title}</p>
                {toast.body && <p className="mt-0.5 text-xs opacity-80">{toast.body}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" className="-rotate-90">
                    <circle cx="12" cy="12" r={RING_R} fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                    <circle cx="12" cy="12" r={RING_R} fill="none" stroke={accent} strokeWidth="2.5"
                        strokeDasharray={RING_CIRC} strokeLinecap="round"
                        style={{ animation: `toastRingDrain ${TOAST_MS}ms linear forwards` }}
                    />
                </svg>
                <button onClick={handleClose} className="text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer" aria-label="Dismiss">
                    <X size={14} />
                </button>
            </div>
        </div>
    )
}

function ToastContainer({ toasts, onClose }) {
    if (!toasts.length) return null
    return (
        <>
            <style>{`
                @keyframes toastSlideIn  { from { opacity:0; transform:translateX(110%); } to { opacity:1; transform:translateX(0); } }
                @keyframes toastSlideOut { from { opacity:1; transform:translateX(0); }   to { opacity:0; transform:translateX(110%); } }
                @keyframes toastRingDrain { from { stroke-dashoffset:0; } to { stroke-dashoffset:${RING_CIRC}; } }
            `}</style>
            <div style={{ position:'fixed', top:'72px', right:'16px', zIndex:99999, display:'flex', flexDirection:'column', gap:'8px', pointerEvents:'none' }}>
                {toasts.map((t) => <Toast key={t.id} toast={t} onClose={() => onClose(t.id)} />)}
            </div>
        </>
    )
}

/* ── EmailPanel ─────────────────────────────────────────────────────── */
export function EmailPanel({ gradebook, courseId, apiFetch, sending, lastResult, sendBulkEmail, clearResult }) {
    const [selectedIds, setSelectedIds] = useState(new Set())
    const [emailType, setEmailType]     = useState(null)
    const [toasts, setToasts]           = useState([])

    const addToast    = (type, title, body) => setToasts(p => [...p, { id: Date.now(), type, title, body }])
    const removeToast = (id) => setToasts(p => p.filter(t => t.id !== id))

    const students = useMemo(() => (gradebook || []).map(row => {
        const hoursAbsent = Number(row.HoursAbsentTotal ?? 0)
        const isDropped   = hoursAbsent >= 5
        const isAtRisk    = !isDropped && row.AtRiskByPolicy
        return { ...row, hoursAbsent, isDropped, isAtRisk }
    }), [gradebook])

    const allSelected  = students.length > 0 && selectedIds.size === students.length
    const someSelected = selectedIds.size > 0 && selectedIds.size < students.length

    const toggleAll     = () => allSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(students.map(s => s.StudentID)))
    const toggleStudent = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

    const handleSend = async () => {
        if (!emailType || selectedIds.size === 0) return
        clearResult()
        const result = await sendBulkEmail(courseId, [...selectedIds], emailType)
        if (!result)            { addToast('error', 'Send Failed', 'An unexpected error occurred.'); return }
        if (result.error)       { addToast('error', 'Send Failed', result.error); return }
        const label = emailType === 'grade_report' ? 'Grade Reports' : 'Absence Reports'
        if (result.failed > 0 && result.sent === 0) addToast('error', `${label} — All Failed`, `${result.failed} email(s) failed.`)
        else if (result.failed > 0)                 addToast('error', `${label} — Partial`, `${result.sent} sent, ${result.failed} failed.`)
        else { addToast('success', `${label} Sent`, `${result.sent} email(s) delivered.`); setSelectedIds(new Set()) }
    }

    const canSend = emailType && selectedIds.size > 0 && !sending

    if (!students.length) {
        return (
            <div className="standard-card p-10 flex flex-col items-center justify-center text-secondary gap-3">
                <div className="w-14 h-14 bg-surface border border-border flex items-center justify-center">
                    <Mail size={24} className="opacity-40" />
                </div>
                <p className="text-sm">No students available to email</p>
            </div>
        )
    }

    return (
        <>
            <ToastContainer toasts={toasts} onClose={removeToast} />
            <div className="space-y-5 animate-fade-in">

                {/* Email Type */}
                <div>
                    <h3 className="text-xs font-semibold tracking-widest uppercase text-secondary mb-3">Email Type</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                            {
                                id: 'grade_report',
                                icon: FileText,
                                label: 'Grade Report',
                                desc: 'Full grade breakdown: Q1, Q2, Project, Assignment, Midterm, Final, penalties, and adjusted total.',
                            },
                            {
                                id: 'absence_report',
                                icon: Clock,
                                label: 'Absence Report',
                                desc: 'Hours absent, grade deductions, and current standing. At-risk and dropped students get extra warnings.',
                            },
                        ].map(({ id, icon: Icon, label, desc }) => {
                            const active = emailType === id
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => { setEmailType(id); clearResult() }}
                                    className={`standard-card p-5 text-left transition-all duration-150 cursor-pointer group ${
                                        active
                                            ? 'ring-2 ring-primary border-primary shadow-sm'
                                            : 'hover:border-secondary hover:shadow-sm'
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`p-2 transition-colors ${active ? 'bg-primary text-primary-fg' : 'bg-surface text-secondary group-hover:text-fg'}`}>
                                            <Icon size={18} />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-sm text-fg">{label}</p>
                                            <p className="text-xs text-secondary mt-1 leading-relaxed">{desc}</p>
                                        </div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Student Selection */}
                <div className="standard-card">
                    <div className="px-5 py-3.5 border-b border-border bg-surface flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <h2 className="text-sm font-semibold text-fg">Select Students</h2>
                            <span className="text-xs font-mono px-2 py-0.5 bg-card text-secondary border border-border">
                                {selectedIds.size} / {students.length}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={toggleAll}
                            className="text-xs font-medium text-secondary hover:text-fg hover:bg-surface px-2.5 py-1 transition-all cursor-pointer"
                        >
                            {allSelected ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>

                    <div className="overflow-auto max-h-[420px]">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="sticky top-0 bg-card border-b border-border text-xs uppercase text-secondary z-10">
                                <tr>
                                    <th className="px-5 py-3 font-medium w-10">
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            ref={(el) => { if (el) el.indeterminate = someSelected }}
                                            onChange={toggleAll}
                                            className="cursor-pointer accent-[var(--color-primary)] w-4 h-4"
                                        />
                                    </th>
                                    <th className="px-4 py-3 font-medium">Student</th>
                                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Email</th>
                                    <th className="px-4 py-3 font-medium text-right hidden sm:table-cell">Absent Hrs</th>
                                    <th className="px-4 py-3 font-medium text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {students.map((s) => {
                                    const checked = selectedIds.has(s.StudentID)
                                    const rowBg   = s.isDropped
                                        ? 'bg-red-500/5 hover:bg-red-500/10'
                                        : s.isAtRisk
                                            ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                            : 'hover:bg-surface'
                                    return (
                                        <tr
                                            key={s.StudentID}
                                            className={`transition-colors duration-100 cursor-pointer ${rowBg}`}
                                            onClick={() => toggleStudent(s.StudentID)}
                                        >
                                            <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleStudent(s.StudentID)}
                                                    className="cursor-pointer accent-[var(--color-primary)] w-4 h-4"
                                                />
                                            </td>
                                            <td className="px-4 py-3 font-medium text-fg">{s.FullName}</td>
                                            <td className="px-4 py-3 text-secondary text-xs font-mono hidden sm:table-cell">{s.Email}</td>
                                            <td className={`px-4 py-3 text-right font-mono text-sm hidden sm:table-cell ${s.isDropped ? 'text-red-500 font-bold' : s.isAtRisk ? 'text-amber-500 font-semibold' : 'text-secondary'}`}>
                                                {s.hoursAbsent.toFixed(1)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium border w-20 ${
                                                    s.isDropped
                                                        ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                                                        : s.isAtRisk
                                                            ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                                                            : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                                }`}>
                                                    {s.isDropped ? (
                                                        <><XCircle size={10} /> Dropped</>
                                                    ) : s.isAtRisk ? (
                                                        <><AlertTriangle size={10} /> At Risk</>
                                                    ) : (
                                                        'Good'
                                                    )}
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Send */}
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!canSend}
                        className="btn-primary h-10 px-6 gap-2"
                    >
                        {sending ? (
                            <><Loader2 size={15} className="animate-spin" /> Sending…</>
                        ) : (
                            <><Send size={15} /> Send to {selectedIds.size} Student{selectedIds.size !== 1 ? 's' : ''}</>
                        )}
                    </button>
                    {emailType && !sending && (
                        <span className="text-xs text-secondary">
                            Type: <span className="font-medium text-fg">{emailType === 'grade_report' ? 'Grade Report' : 'Absence Report'}</span>
                        </span>
                    )}
                </div>
            </div>
        </>
    )
}
