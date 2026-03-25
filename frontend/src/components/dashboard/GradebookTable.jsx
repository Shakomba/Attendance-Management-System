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
      <div className="standard-card p-10 flex flex-col items-center justify-center text-secondary border-dashed">
        <ShieldAlert size={32} className="mb-4 opacity-50" />
        <p>No Gradebook Data Available</p>
      </div>
    );
  }

  const preFinalColumns = [
    { key: "Quiz1", label: "Q1", field: "quiz1", max: 6 },
    { key: "Quiz2", label: "Q2", field: "quiz2", max: 6 },
    { key: "ProjectGrade", label: "PRJ", field: "project", max: 12 },
    { key: "AssignmentGrade", label: "ASSN", field: "assignment", max: 6 },
    { key: "MidtermGrade", label: "MID", field: "midterm", max: 20 },
  ];
  const finalColumns = [
    { key: "FinalExamGrade", label: "FIN", field: "final_exam", max: 50 },
  ];
  const columns = [...preFinalColumns, ...finalColumns];

  return (
    <div className="standard-card">
      <div className="px-6 py-4 border-b border-border bg-surface">
        <h2 className="text-sm font-semibold tracking-tight uppercase text-primary">Master Gradebook</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-bg border-b border-border text-xs uppercase text-secondary">
            <tr>
              <th className="px-6 py-3 font-medium sticky left-0 bg-bg z-10 border-r border-border min-w-[200px]">Student</th>
              {preFinalColumns.map((c) => (
                <th key={c.key} className="px-4 py-3 font-medium text-right">{c.label}</th>
              ))}
              <th className="px-4 py-3 font-medium text-right">Abs (hrs)</th>
              <th className="px-4 py-3 font-medium text-right text-primary">Pre-Final /50</th>
              {finalColumns.map((c) => (
                <th key={c.key} className="px-4 py-3 font-medium text-right">{c.label}</th>
              ))}
              <th className="px-4 py-3 font-medium text-right font-bold">Total /100</th>
              <th className="px-4 py-3 font-medium text-right">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {gradebook.map((row) => {
              const isEditing = gradeEditor?.studentId === row.StudentID;
              const isSaving = gradeBusyByStudent[row.StudentID];
              const isDropped = Number(row.HoursAbsentTotal) >= 5;
              const isAtRisk = !isDropped && row.AtRiskByPolicy;

              const rowBg = isDropped
                ? 'bg-red-500/10 hover:bg-red-500/15'
                : isAtRisk
                  ? 'bg-amber-500/10 hover:bg-amber-500/15'
                  : 'hover:bg-surface'

              const stickyStyle = isDropped
                ? { background: 'linear-gradient(rgb(239 68 68/.1),rgb(239 68 68/.1)) var(--color-bg)' }
                : isAtRisk
                  ? { background: 'linear-gradient(rgb(245 158 11/.1),rgb(245 158 11/.1)) var(--color-bg)' }
                  : { background: 'var(--color-bg)' }

              // Pre-Final: Q1+Q2+PRJ+ASSN+MID out of 50
              const preFinalRaw = (
                Number(row.Quiz1 ?? 0) +
                Number(row.Quiz2 ?? 0) +
                Number(row.ProjectGrade ?? 0) +
                Number(row.AssignmentGrade ?? 0) +
                Number(row.MidtermGrade ?? 0)
              );
              const penalty = Number(row.AttendancePenalty ?? 0);
              const preFinal50 = Math.max(0, preFinalRaw - penalty).toFixed(2);
              // Total: all 6 components out of 100
              const totalRaw = preFinalRaw + Number(row.FinalExamGrade ?? 0);
              const total100 = Math.max(0, totalRaw - penalty).toFixed(2);

              return (
                <tr key={row.StudentID} className={`transition-colors ${rowBg}`}>
                  <td className="px-6 py-3 sticky left-0 z-10 border-r border-border font-medium" style={stickyStyle}>
                    <div className="text-primary">{row.FullName}</div>
                  </td>

                  {/* Pre-final grade cells: Q1 Q2 PRJ ASSN MID */}
                  {preFinalColumns.map((c) => {
                    const editorField = c.field ?? c.key.replace("Grade", "").toLowerCase();
                    const val = isEditing ? gradeEditor.values[editorField] : (row[c.key] ?? "-");
                    const isFailed = !isEditing && val !== "-" && c.max && Number(val) < c.max / 2;
                    return (
                      <td key={c.key} className={`px-4 py-3 text-right font-mono ${isFailed ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                        {isEditing ? (
                          <input type="number" step="0.1" min="0" max={c.max || 100}
                            className="ui-input w-20 text-right font-mono"
                            value={val}
                            onChange={(e) => updateGradeDraftField(editorField, e.target.value)}
                            disabled={isSaving} />
                        ) : val}
                      </td>
                    );
                  })}

                  {/* Absence hours */}
                  <td className={`px-4 py-3 text-right font-mono text-sm ${isDropped ? 'text-red-500 font-bold' : isAtRisk ? 'text-amber-500 font-semibold' : 'text-secondary'}`}>
                    {isEditing ? (
                      <input type="number" step="0.5" min="0"
                        className="ui-input w-20 text-right font-mono"
                        value={gradeEditor.values.hours_absent}
                        onChange={(e) => updateGradeDraftField("hours_absent", e.target.value)}
                        disabled={isSaving} />
                    ) : (
                      row.HoursAbsentTotal != null ? Number(row.HoursAbsentTotal).toFixed(1) : "-"
                    )}
                  </td>

                  {/* Pre-Final /50 */}
                  <td className={`px-4 py-3 text-right font-mono ${Number(preFinal50) < 25 ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                    {preFinal50}
                  </td>

                  {/* Final exam cell */}
                  {finalColumns.map((c) => {
                    const editorField = c.field;
                    const val = isEditing ? gradeEditor.values[editorField] : (row[c.key] ?? "-");
                    const isFailed = !isEditing && val !== "-" && c.max && Number(val) < c.max / 2;
                    return (
                      <td key={c.key} className={`px-4 py-3 text-right font-mono ${isFailed ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                        {isEditing ? (
                          <input type="number" step="0.1" min="0" max={c.max || 100}
                            className="ui-input w-20 text-right font-mono"
                            value={val}
                            onChange={(e) => updateGradeDraftField(editorField, e.target.value)}
                            disabled={isSaving} />
                        ) : val}
                      </td>
                    );
                  })}

                  {/* Total /100 */}
                  <td className={`px-4 py-3 text-right font-mono font-bold ${Number(total100) < 50 ? 'text-red-500' : 'text-primary'}`}>
                    {total100}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border w-20 ${isDropped
                      ? 'border-red-500/40 bg-red-500/15 text-red-500'
                      : isAtRisk
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-500'
                        : 'border-border bg-surface text-secondary'
                      }`}>
                      {isDropped ? (
                        <><XCircle size={11} /> Dropped</>
                      ) : isAtRisk ? (
                        <><AlertTriangle size={11} /> At Risk</>
                      ) : (
                        'Good'
                      )}
                    </span>
                  </td>

                  <td className="px-6 py-3 text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => saveGradeEdit(row.StudentID)}
                          disabled={isSaving}
                          className="btn-primary"
                        >
                          {isSaving ? "..." : "Save"}
                        </button>
                        <button
                          onClick={cancelGradeEdit}
                          disabled={isSaving}
                          className="btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startGradeEdit(row)}
                        className="p-1.5 rounded-sm border border-border text-secondary hover:bg-black hover:text-white transition-all shadow-sm"
                        title="Edit Grades"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
