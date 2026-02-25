import { cn } from '../../lib/utils'

export function GradebookTable({
    gradebook,
    gradeEditor,
    gradeBusyByStudent,
    updateGradeDraftField,
    startGradeEdit,
    cancelGradeEdit,
    saveGradeEdit
}) {
    return (
        <article className="standard-card flex flex-col min-h-[300px]">
            <header className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                        Student Gradebook
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage course grades and track penalties</p>
                </div>
            </header>

            <div className="flex-1 overflow-auto scroll-slim">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[1000px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                        <tr className="text-slate-500 dark:text-slate-400 font-medium text-xs">
                            <th className="px-5 py-3 rounded-tl-lg">Student Name</th>
                            <th className="px-3 py-3 text-center">Quiz 1</th>
                            <th className="px-3 py-3 text-center">Quiz 2</th>
                            <th className="px-3 py-3 text-center">Project</th>
                            <th className="px-3 py-3 text-center">Assignment</th>
                            <th className="px-3 py-3 text-center">Midterm</th>
                            <th className="px-3 py-3 text-center">Final Exam</th>
                            <th className="px-3 py-3 text-center border-l border-slate-200 dark:border-slate-800 pl-4">Absences (Hrs)</th>
                            <th className="px-3 py-3 text-center border-l border-slate-200 dark:border-slate-800 font-semibold">Total Grade</th>
                            <th className="px-5 py-3 border-l border-slate-200 dark:border-slate-800 rounded-tr-lg">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        {gradebook.map((row) => {
                            const isAtRisk = Boolean(row.AtRiskByPolicy)
                            const isEditing = Number(gradeEditor?.studentId) === Number(row.StudentID)
                            const isSaving = Boolean(gradeBusyByStudent[row.StudentID])

                            const InputCell = ({ field, value }) => (
                                <td className="px-2 py-3 text-center">
                                    {isEditing ? (
                                        <input
                                            className="w-16 text-center standard-input rounded-md px-2 py-1.5 text-xs font-mono"
                                            type="number"
                                            step="0.01"
                                            value={gradeEditor.values[field]}
                                            onChange={(e) => updateGradeDraftField(field, e.target.value)}
                                        />
                                    ) : (
                                        <span className="font-mono text-[13px]">{Number(value).toFixed(2)}</span>
                                    )}
                                </td>
                            )

                            return (
                                <tr
                                    key={`${row.StudentID}-${row.StudentCode}`}
                                    className={cn(
                                        "group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50",
                                        isAtRisk && !isEditing && "bg-rose-50/30 dark:bg-rose-900/10",
                                        isEditing && "bg-slate-100/50 dark:bg-slate-800"
                                    )}
                                >
                                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-slate-200">
                                        <div className="flex items-center gap-2">
                                            {isAtRisk && (
                                                <span className="w-2 h-2 rounded-full bg-rose-500" title="At Risk"></span>
                                            )}
                                            {row.FullName}
                                        </div>
                                    </td>

                                    <InputCell field="quiz1" value={row.Quiz1} />
                                    <InputCell field="quiz2" value={row.Quiz2} />
                                    <InputCell field="project" value={row.ProjectGrade} />
                                    <InputCell field="assignment" value={row.AssignmentGrade} />
                                    <InputCell field="midterm" value={row.MidtermGrade} />
                                    <InputCell field="final_exam" value={row.FinalExamGrade} />

                                    <td className="px-3 py-3 text-center border-l border-slate-200 dark:border-slate-800 pl-4 font-mono text-[13px] text-slate-500 dark:text-slate-400">
                                        {Number(row.HoursAbsentTotal).toFixed(2)}
                                    </td>
                                    <td className="px-3 py-3 text-center font-mono font-bold border-l border-slate-200 dark:border-slate-800 text-sm">
                                        {Number(row.AdjustedTotal).toFixed(2)}
                                    </td>
                                    <td className="px-5 py-3 border-l border-slate-200 dark:border-slate-800">
                                        {isEditing ? (
                                            <div className="flex gap-2">
                                                <button
                                                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                                    onClick={() => saveGradeEdit(row.StudentID)}
                                                    disabled={isSaving}
                                                >
                                                    {isSaving ? 'Saving' : 'Save'}
                                                </button>
                                                <button
                                                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                                    onClick={cancelGradeEdit}
                                                    disabled={isSaving}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                className="px-3 py-1.5 text-xs font-medium rounded-md text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors"
                                                onClick={() => startGradeEdit(row)}
                                                disabled={Boolean(gradeEditor) && !isEditing}
                                            >
                                                Edit
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}

                        {!gradebook.length && (
                            <tr>
                                <td colSpan={10} className="px-5 py-16 text-center text-slate-500 dark:text-slate-400">
                                    <span className="text-sm">No gradebook records available. Select a course to view grades.</span>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </article>
    )
}
