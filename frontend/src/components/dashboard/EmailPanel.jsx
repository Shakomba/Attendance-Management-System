import { useState, useMemo, useEffect, useRef } from 'react'
import { Mail, Send, FileText, Clock, AlertTriangle, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/* ── Toast ─────────────────────────────────────────────────────── */
const TOAST_MS = 5000
const RING_R = 10
const RING_CIRC = 2 * Math.PI * RING_R

function Toast({ toast, onClose }) {
    const isSuccess = toast.type === 'success'
    const timerRef = useRef(null)
    const [exiting, setExiting] = useState(false)

    const accent = isSuccess ? '#16a34a' : '#ef4444' // Matching Tailwind's green-600 and red-500 for the SVG stroke

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
            style={{
                animation: `${exiting ? 'toastSlideOut' : 'toastSlideIn'} 0.35s cubic-bezier(0.16,1,0.3,1) forwards`,
            }}
            className={`flex items-start gap-3 px-4 py-3 rounded-sm shadow-xl border border-border text-sm max-w-sm w-full pointer-events-auto ${isSuccess
                ? 'bg-green-50 border-green-200 text-green-900 dark:bg-green-950 dark:border-green-800 dark:text-green-100'
                : 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100'
                }`}
        >
            {isSuccess
                ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                : <XCircle size={18} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
            }
            <div className="flex-1 min-w-0">
                <p className="font-semibold">{toast.title}</p>
                {toast.body && <p className="mt-0.5 text-xs opacity-80">{toast.body}</p>}
            </div>

            {/* Countdown ring */}
            <div className="flex items-center gap-2 shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" className="-rotate-90">
                    <circle cx="12" cy="12" r={RING_R} fill="none"
                        stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                    <circle cx="12" cy="12" r={RING_R} fill="none"
                        stroke={accent} strokeWidth="2.5"
                        strokeDasharray={RING_CIRC}
                        strokeLinecap="round"
                        style={{ animation: `toastRingDrain ${TOAST_MS}ms linear forwards` }}
                    />
                </svg>
            </div>
        </div>
    )
}

function ToastContainer({ toasts, onClose }) {
    if (!toasts.length) return null
    const slideX = document.documentElement.dir === 'rtl' ? '-110%' : '110%'
    return (
        <>
            <style>{`
                @keyframes toastSlideIn {
                    from { opacity: 0; transform: translateX(${slideX}); }
                    to   { opacity: 1; transform: translateX(0); }
                }
                @keyframes toastSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to   { opacity: 0; transform: translateX(${slideX}); }
                }
                @keyframes toastRingDrain {
                    from { stroke-dashoffset: 0; }
                    to   { stroke-dashoffset: ${RING_CIRC}; }
                }
            `}</style>
            <div style={{
                position: 'fixed', top: '72px', insetInlineEnd: '16px',
                zIndex: 99999,
                display: 'flex', flexDirection: 'column', gap: '8px',
                pointerEvents: 'none',
            }}>
                {toasts.map((t) => (
                    <Toast key={t.id} toast={t} onClose={() => onClose(t.id)} />
                ))}
            </div>
        </>
    )
}

/* ── EmailPanel ─────────────────────────────────────────────────── */
export function EmailPanel({ gradebook, courseId, sending, sendBulkEmail, clearResult }) {
    const { t } = useTranslation()
    const [selectedIds, setSelectedIds] = useState(new Set())
    const [emailType, setEmailType] = useState(null)  // 'grade_report' | 'absence_report'
    const [toasts, setToasts] = useState([])

    const addToast = (type, title, body) => {
        const id = Date.now()
        setToasts((prev) => [...prev, { id, type, title, body }])
    }
    const removeToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id))

    const students = useMemo(() => {
        return (gradebook || []).map((row) => {
            const hoursAbsent = Number(row.HoursAbsentTotal ?? 0)
            const isDropped = hoursAbsent >= 5
            const isAtRisk = !isDropped && row.AtRiskByPolicy
            return { ...row, hoursAbsent, isDropped, isAtRisk }
        })
    }, [gradebook])

    const allSelected = students.length > 0 && selectedIds.size === students.length
    const someSelected = selectedIds.size > 0 && selectedIds.size < students.length

    const toggleAll = () => {
        if (allSelected) setSelectedIds(new Set())
        else setSelectedIds(new Set(students.map((s) => s.StudentID)))
    }

    const toggleStudent = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const handleSend = async () => {
        if (!emailType || selectedIds.size === 0) return
        clearResult()
        const result = await sendBulkEmail(courseId, [...selectedIds], emailType)
        if (!result) {
            addToast('error', t('email_send_failed'), 'An unexpected error occurred. Please try again.')
            return
        }
        if (result.error) {
            addToast('error', t('email_send_failed'), result.error)
            return
        }
        const typeLabel = emailType === 'grade_report' ? t('email_send_grades') : t('email_send_absence')
        if (result.failed > 0 && result.sent === 0) {
            addToast('error', typeLabel, t('email_failed'))
        } else if (result.failed > 0) {
            addToast('error', typeLabel, `${result.sent} ${t('email_sent_count')}, ${result.failed} ${t('email_failed_count')}.`)
        } else {
            addToast('success', typeLabel, t('email_success'))
            setSelectedIds(new Set())
        }
    }

    const canSend = emailType && selectedIds.size > 0 && !sending

    if (!students.length) {
        return (
            <div className="standard-card p-10 flex flex-col items-center justify-center text-secondary border-dashed">
                <Mail size={32} className="mb-4 opacity-50" />
                <p>{t('email_no_students')}</p>
            </div>
        )
    }

    return (
        <>
            <ToastContainer toasts={toasts} onClose={removeToast} />

            <div className="space-y-6 animate-in fade-in duration-300">
                {/* Email Type Selection */}
                <div>
                    <h3 className="text-xs font-semibold tracking-tight uppercase text-secondary mb-3">{t('email_type_label')}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => { setEmailType('grade_report'); clearResult(); }}
                            className={`standard-card p-5 text-start transition-all duration-200 cursor-pointer group ${emailType === 'grade_report'
                                ? 'ring-2 ring-fg border-fg'
                                : 'hover:border-secondary'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-sm transition-colors ${emailType === 'grade_report' ? 'bg-fg text-bg' : 'bg-surface text-secondary group-hover:text-fg'}`}>
                                    <FileText size={18} />
                                </div>
                                <div>
                                    <p className="font-semibold text-sm text-primary">{t('email_grade_report')}</p>
                                    <p className="text-xs text-secondary mt-1">{t('email_grade_report_desc')}</p>
                                </div>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => { setEmailType('absence_report'); clearResult(); }}
                            className={`standard-card p-5 text-start transition-all duration-200 cursor-pointer group ${emailType === 'absence_report'
                                ? 'ring-2 ring-fg border-fg'
                                : 'hover:border-secondary'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-sm transition-colors ${emailType === 'absence_report' ? 'bg-fg text-bg' : 'bg-surface text-secondary group-hover:text-fg'}`}>
                                    <Clock size={18} />
                                </div>
                                <div>
                                    <p className="font-semibold text-sm text-primary">{t('email_absence_report')}</p>
                                    <p className="text-xs text-secondary mt-1">{t('email_absence_report_desc')}</p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Student Selection */}
                <div className="standard-card">
                    <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border bg-surface flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <h2 className="text-xs sm:text-sm font-semibold tracking-tight uppercase text-primary whitespace-nowrap">{t('email_select_students')}</h2>
                            <span className="text-[11px] sm:text-xs text-secondary font-mono whitespace-nowrap">
                                {selectedIds.size}/{students.length}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={toggleAll}
                            className="text-xs font-medium text-secondary hover:text-fg transition-colors px-2 py-1 rounded-sm hover:bg-surface"
                        >
                            {allSelected ? t('email_deselect_all') : t('email_select_all')}
                        </button>
                    </div>

                    <div className="overflow-auto max-h-[420px]">
                        <table className="w-full text-start text-sm whitespace-nowrap">
                            <thead className="sticky top-0 bg-bg border-b border-border text-xs uppercase text-secondary z-10">
                                <tr>
                                    <th className="px-6 py-3 font-medium w-10">
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            ref={(el) => { if (el) el.indeterminate = someSelected }}
                                            onChange={toggleAll}
                                            className="accent-current cursor-pointer"
                                        />
                                    </th>
                                    <th className="px-4 py-3 font-medium">{t('table_student')}</th>
                                    <th className="px-4 py-3 font-medium hidden sm:table-cell">{t('enroll_email')}</th>
                                    <th className="px-4 py-3 font-medium text-end hidden sm:table-cell">{t('gb_absence_hrs')}</th>
                                    <th className="px-4 py-3 font-medium text-center">{t('table_status')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {students.map((s) => {
                                    const checked = selectedIds.has(s.StudentID)
                                    const rowBg = s.isDropped
                                        ? 'bg-red-500/10 hover:bg-red-500/15'
                                        : s.isAtRisk
                                            ? 'bg-amber-500/10 hover:bg-amber-500/15'
                                            : 'hover:bg-surface'

                                    return (
                                        <tr
                                            key={s.StudentID}
                                            className={`transition-colors cursor-pointer ${rowBg}`}
                                            onClick={() => toggleStudent(s.StudentID)}
                                        >
                                            <td className="px-3 sm:px-6 py-3" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleStudent(s.StudentID)}
                                                    className="accent-current cursor-pointer"
                                                />
                                            </td>
                                            <td className="px-3 sm:px-4 py-3">
                                                <div className="font-medium text-primary">{s.FullName}</div>
                                                {/* Mobile-only: show absent hrs below name */}
                                                <div className="sm:hidden text-[11px] font-mono text-secondary mt-0.5">
                                                    {s.hoursAbsent.toFixed(1)} {t('email_hrs_absent')}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-secondary text-xs font-mono hidden sm:table-cell">{s.Email}</td>
                                            <td className={`px-4 py-3 text-end font-mono text-sm hidden sm:table-cell ${s.isDropped ? 'text-red-500 font-bold' : s.isAtRisk ? 'text-amber-500 font-semibold' : 'text-secondary'
                                                }`}>
                                                {s.hoursAbsent.toFixed(1)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border w-20 ${s.isDropped
                                                    ? 'border-red-500/40 bg-red-500/15 text-red-500'
                                                    : s.isAtRisk
                                                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-500'
                                                        : 'border-border bg-surface text-secondary'
                                                    }`}>
                                                    {s.isDropped ? (
                                                        <>{t('gb_status_dropped')}</>
                                                    ) : s.isAtRisk ? (
                                                        <><AlertTriangle size={11} /> {t('gb_status_at_risk')}</>
                                                    ) : (
                                                        t('gb_status_passing')
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

                {/* Send Button */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!canSend}
                        className="btn-primary h-10 px-6 gap-2"
                    >
                        {sending ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                {t('email_sending')}
                            </>
                        ) : (
                            <>
                                <Send size={16} />
                                {t('email_send_to')} {selectedIds.size} {selectedIds.size !== 1 ? t('email_students') : t('email_student')}
                            </>
                        )}
                    </button>

                    {emailType && !sending && (
                        <span className="text-xs text-secondary">
                            {t('email_type_prefix')} <span className="font-medium text-fg">{emailType === 'grade_report' ? t('email_grade_report') : t('email_absence_report')}</span>
                        </span>
                    )}
                </div>
            </div>
        </>
    )
}
