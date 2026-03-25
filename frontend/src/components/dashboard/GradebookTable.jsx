import { Edit2, ShieldAlert, AlertTriangle, XCircle } from 'lucide-react'

export function GradebookTable({
    gradebook,
    gradeEditor,
    gradeBusyByStudent,
    startGradeEdit,
    cancelGradeEdit,
    updateGradeDraftField,
    saveGradeEdit,
}) {
    if (!gradebook?.length) {
        return (
            <div className="standard-card p-10 flex flex-col items-center justify-center text-secondary gap-3">
                <div className="w-14 h-14 bg-surface border border-border flex items-center justify-center">
                    <ShieldAlert size={24} className="opacity-40" />
                </div>
                <p className="text-sm">No gradebook data available</p>
            </div>
        )
    }

    const preFinalColumns = [
        { key: 'Quiz1',           label: 'Q1',   field: 'quiz1',      max: 6  },
        { key: 'Quiz2',           label: 'Q2',   field: 'quiz2',      max: 6  },
        { key: 'ProjectGrade',    label: 'PRJ',  field: 'project',    max: 12 },
        { key: 'AssignmentGrade', label: 'ASSN', field: 'assignment', max: 6  },
        { key: 'MidtermGrade',    label: 'MID',  field: 'midterm',    max: 20 },
    ]
    const finalColumns = [
        { key: 'FinalExamGrade', label: 'FIN', field: 'final_exam', max: 50 },
    ]

    return (
        <div className="standard-card">
            <div className="px-5 py-3.5 border-b border-border bg-surface flex items-center gap-2">
                <h2 className="text-sm font-semibold text-fg">Master Gradebook</h2>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-card border-b border-border text-xs uppercase text-secondary">
                        <tr>
                            <th className="px-5 py-3 font-medium sticky left-0 bg-card z-10 border-r border-border min-w-[200px]">Student</th>
                            {preFinalColumns.map((c) => (
                                <th key={c.key} className="px-4 py-3 font-medium text-right">{c.label}</th>
                            ))}
                            <th className="px-4 py-3 font-medium text-right">Abs</th>
                            <th className="px-4 py-3 font-medium text-right">Pre-Fin /50</th>
                            {finalColumns.map((c) => (
                                <th key={c.key} className="px-4 py-3 font-medium text-right">{c.label}</th>
                            ))}
                            <th className="px-4 py-3 font-medium text-right font-bold">Total /100</th>
                            <th className="px-4 py-3 font-medium text-right">Status</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {gradebook.map((row) => {
                            const isEditing = gradeEditor?.studentId === row.StudentID
                            const isSaving  = gradeBusyByStudent[row.StudentID]
                            const isDropped = Number(row.HoursAbsentTotal) >= 5
                            const isAtRisk  = !isDropped && row.AtRiskByPolicy

                            const rowBg = isDropped
                                ? 'bg-red-500/5 hover:bg-red-500/10'
                                : isAtRisk
                                    ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                    : 'hover:bg-surface'

                            const stickyBg = isDropped
                                ? { background: 'color-mix(in srgb, rgb(239 68 68 / 8%), var(--color-card))' }
                                : isAtRisk
                                    ? { background: 'color-mix(in srgb, rgb(245 158 11 / 8%), var(--color-card))' }
                                    : { background: 'var(--color-card)' }

                            const preFinalRaw = (
                                Number(row.Quiz1 ?? 0) +
                                Number(row.Quiz2 ?? 0) +
                                Number(row.ProjectGrade ?? 0) +
                                Number(row.AssignmentGrade ?? 0) +
                                Number(row.MidtermGrade ?? 0)
                            )
                            const penalty    = Number(row.AttendancePenalty ?? 0)
                            const preFinal50 = Math.max(0, preFinalRaw - penalty).toFixed(2)
                            const total100   = Math.max(0, preFinalRaw + Number(row.FinalExamGrade ?? 0) - penalty).toFixed(2)

                            return (
                                <tr key={row.StudentID} className={`transition-colors duration-100 ${rowBg}`}>
                                    <td className="px-5 py-3 sticky left-0 z-10 border-r border-border font-medium" style={stickyBg}>
                                        <span className="text-fg">{row.FullName}</span>
                                    </td>

                                    {preFinalColumns.map((c) => {
                                        const val    = isEditing ? gradeEditor.values[c.field] : (row[c.key] ?? '—')
                                        const failed = !isEditing && val !== '—' && c.max && Number(val) < c.max / 2
                                        return (
                                            <td key={c.key} className={`px-4 py-3 text-right font-mono ${failed ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                                                {isEditing ? (
                                                    <input type="number" step="0.1" min="0" max={c.max || 100}
                                                        className="ui-input w-20 text-right font-mono"
                                                        value={val}
                                                        onChange={(e) => updateGradeDraftField(c.field, e.target.value)}
                                                        disabled={isSaving} />
                                                ) : val}
                                            </td>
                                        )
                                    })}

                                    <td className={`px-4 py-3 text-right font-mono ${isDropped ? 'text-red-500 font-bold' : isAtRisk ? 'text-amber-500 font-semibold' : 'text-secondary'}`}>
                                        {isEditing ? (
                                            <input type="number" step="0.5" min="0"
                                                className="ui-input w-20 text-right font-mono"
                                                value={gradeEditor.values.hours_absent}
                                                onChange={(e) => updateGradeDraftField('hours_absent', e.target.value)}
                                                disabled={isSaving} />
                                        ) : (
                                            row.HoursAbsentTotal != null ? Number(row.HoursAbsentTotal).toFixed(1) : '—'
                                        )}
                                    </td>

                                    <td className={`px-4 py-3 text-right font-mono font-medium ${Number(preFinal50) < 25 ? 'text-red-500' : 'text-fg'}`}>
                                        {preFinal50}
                                    </td>

                                    {finalColumns.map((c) => {
                                        const val    = isEditing ? gradeEditor.values[c.field] : (row[c.key] ?? '—')
                                        const failed = !isEditing && val !== '—' && c.max && Number(val) < c.max / 2
                                        return (
                                            <td key={c.key} className={`px-4 py-3 text-right font-mono ${failed ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                                                {isEditing ? (
                                                    <input type="number" step="0.1" min="0" max={c.max || 100}
                                                        className="ui-input w-20 text-right font-mono"
                                                        value={val}
                                                        onChange={(e) => updateGradeDraftField(c.field, e.target.value)}
                                                        disabled={isSaving} />
                                                ) : val}
                                            </td>
                                        )
                                    })}

                                    <td className={`px-4 py-3 text-right font-mono font-bold ${Number(total100) < 50 ? 'text-red-500' : 'text-fg'}`}>
                                        {total100}
                                    </td>

                                    <td className="px-4 py-3 text-right">
                                        <span className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium border w-20 ${
                                            isDropped
                                                ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                                                : isAtRisk
                                                    ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                                                    : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                        }`}>
                                            {isDropped ? (
                                                <><XCircle size={10} /> Dropped</>
                                            ) : isAtRisk ? (
                                                <><AlertTriangle size={10} /> At Risk</>
                                            ) : (
                                                'Good'
                                            )}
                                        </span>
                                    </td>

                                    <td className="px-5 py-3 text-right">
                                        {isEditing ? (
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => saveGradeEdit(row.StudentID)} disabled={isSaving} className="btn-primary px-3 py-1.5 text-xs h-auto">
                                                    {isSaving ? '…' : 'Save'}
                                                </button>
                                                <button onClick={cancelGradeEdit} disabled={isSaving} className="btn-secondary px-3 py-1.5 text-xs h-auto">
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => startGradeEdit(row)}
                                                className="p-1.5 border border-border text-secondary hover:bg-primary hover:text-primary-fg hover:border-primary transition-all cursor-pointer"
                                                title="Edit Grades"
                                                aria-label="Edit Grades"
                                            >
                                                <Edit2 size={13} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
