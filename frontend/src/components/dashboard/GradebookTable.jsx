import { Edit2, ShieldAlert, AlertTriangle } from 'lucide-react'
import { useState } from 'react'

/* ── Shared helpers ──────────────────────────────────────────────── */
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

function computeRow(row) {
  const isDropped = Number(row.HoursAbsentTotal) >= 5;
  const isAtRisk = !isDropped && !!row.AtRiskByPolicy;
  const preFinalRaw = (
    Number(row.Quiz1 ?? 0) +
    Number(row.Quiz2 ?? 0) +
    Number(row.ProjectGrade ?? 0) +
    Number(row.AssignmentGrade ?? 0) +
    Number(row.MidtermGrade ?? 0)
  );
  const penalty = Math.min(Number(row.AttendancePenalty ?? 0), 5);
  const preFinal50 = Math.max(0, preFinalRaw - penalty).toFixed(2);
  const totalRaw = preFinalRaw + Number(row.FinalExamGrade ?? 0);
  const total100 = Math.max(0, totalRaw - penalty).toFixed(2);
  return { isDropped, isAtRisk, preFinal50, total100 };
}

/* ── Mobile card for a single student ────────────────────────────── */
function MobileGradeCard({ row, isEditing, isSaving, gradeEditor, startGradeEdit, cancelGradeEdit, updateGradeDraftField, saveGradeEdit }) {
  const { isDropped, isAtRisk, preFinal50, total100 } = computeRow(row);
  const [expanded, setExpanded] = useState(false);

  const cardBorder = isDropped
    ? 'border-red-500/40'
    : isAtRisk
      ? 'border-amber-500/40'
      : 'border-border';

  const cardBg = isDropped
    ? 'bg-red-500/5'
    : isAtRisk
      ? 'bg-amber-500/5'
      : 'bg-bg';

  const allCols = [...preFinalColumns, ...finalColumns];

  return (
    <div className={`standard-card !rounded-sm border ${cardBorder} ${cardBg}`}>
      {/* Card header — always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        onClick={() => !isEditing && setExpanded(e => !e)}
      >
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-primary text-sm truncate">{row.FullName}</div>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-lg font-bold font-mono ${Number(total100) < 50 ? 'text-red-500' : 'text-primary'}`}>
              {total100}
              <span className="text-[10px] font-normal text-secondary ml-0.5">/100</span>
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium border ${isDropped
              ? 'border-red-500/40 bg-red-500/15 text-red-500'
              : isAtRisk
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-500'
                : 'border-border bg-surface text-secondary'
              }`}>
              {isDropped ? <>Dropped</> : isAtRisk ? <><AlertTriangle size={10} /> At Risk</> : 'Good'}
            </span>
          </div>
        </div>
        {!isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); startGradeEdit(row); }}
            className="p-2 rounded-sm border border-border text-secondary hover:bg-fg hover:text-bg hover:border-fg transition-all cursor-pointer shrink-0 ml-2"
            title="Edit Grades"
          >
            <Edit2 size={14} />
          </button>
        )}
      </div>

      {/* Expanded detail / edit mode */}
      {(expanded || isEditing) && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Grade grid */}
          <div className="grid grid-cols-3 gap-2">
            {allCols.map((c) => {
              const editorField = c.field ?? c.key.replace("Grade", "").toLowerCase();
              const val = isEditing ? gradeEditor.values[editorField] : (row[c.key] ?? "-");
              const isFailed = !isEditing && val !== "-" && c.max && Number(val) < c.max / 2;
              return (
                <div key={c.key} className="flex flex-col">
                  <span className="text-[10px] uppercase text-secondary font-medium">{c.label} <span className="opacity-50">/{c.max}</span></span>
                  {isEditing ? (
                    <input type="number" step="0.1" min="0" max={c.max || 100}
                      className="ui-input text-sm font-mono mt-0.5 w-full"
                      value={val}
                      onChange={(e) => updateGradeDraftField(editorField, e.target.value)}
                      disabled={isSaving} />
                  ) : (
                    <span className={`font-mono text-sm ${isFailed ? 'text-red-500 font-bold' : 'text-fg'}`}>{val}</span>
                  )}
                </div>
              );
            })}
            {/* Absence hours */}
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-secondary font-medium">Absent <span className="opacity-50">hrs</span></span>
              {isEditing ? (
                <input type="number" step="1" min="0"
                  className="ui-input text-sm font-mono mt-0.5 w-full"
                  value={gradeEditor.values.hours_absent}
                  onChange={(e) => updateGradeDraftField("hours_absent", e.target.value)}
                  disabled={isSaving} />
              ) : (
                <span className={`font-mono text-sm ${isDropped ? 'text-red-500 font-bold' : isAtRisk ? 'text-amber-500 font-semibold' : 'text-fg'}`}>
                  {row.HoursAbsentTotal != null ? Number(row.HoursAbsentTotal).toFixed(1) : "-"}
                </span>
              )}
            </div>
            {/* Pre-Final */}
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-secondary font-medium">Pre-Fin <span className="opacity-50">/50</span></span>
              <span className={`font-mono text-sm ${Number(preFinal50) < 25 ? 'text-red-500 font-bold' : 'text-fg'}`}>{preFinal50}</span>
            </div>
          </div>

          {/* Edit actions */}
          {isEditing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => saveGradeEdit(row.StudentID)} disabled={isSaving} className="btn-primary flex-1 h-9 text-sm">
                {isSaving ? "..." : "Save"}
              </button>
              <button onClick={cancelGradeEdit} disabled={isSaving} className="btn-secondary flex-1 h-9 text-sm">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
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

  return (
    <>
      {/* ── Mobile card list (below lg) ────────────────────────────── */}
      <div className="lg:hidden space-y-3">
        <div className="px-1 mb-1">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-primary">Master Gradebook</h2>
        </div>
        {gradebook.map((row) => (
          <MobileGradeCard
            key={row.StudentID}
            row={row}
            isEditing={gradeEditor?.studentId === row.StudentID}
            isSaving={gradeBusyByStudent[row.StudentID]}
            gradeEditor={gradeEditor}
            startGradeEdit={startGradeEdit}
            cancelGradeEdit={cancelGradeEdit}
            updateGradeDraftField={updateGradeDraftField}
            saveGradeEdit={saveGradeEdit}
          />
        ))}
      </div>

      {/* ── Desktop table (lg+) ────────────────────────────────────── */}
      <div className="standard-card hidden lg:block">
        <div className="px-6 py-4 border-b border-border bg-surface">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-primary">Master Gradebook</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-bg border-b border-border text-xs uppercase text-secondary">
              <tr>
                <th className="px-6 py-3 font-medium sticky left-0 bg-bg z-10 border-r border-border min-w-[200px]">Student</th>
                {preFinalColumns.map((c) => (
                  <th key={c.key} className="px-4 py-3 font-medium text-center">{c.label}</th>
                ))}
                <th className="px-4 py-3 font-medium text-center">Abs (hrs)</th>
                <th className="px-4 py-3 font-medium text-center text-primary">Pre-Final /50</th>
                {finalColumns.map((c) => (
                  <th key={c.key} className="px-4 py-3 font-medium text-center">{c.label}</th>
                ))}
                <th className="px-4 py-3 font-medium text-center font-bold">Total /100</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {gradebook.map((row) => {
                const isEditing = gradeEditor?.studentId === row.StudentID;
                const isSaving = gradeBusyByStudent[row.StudentID];
                const { isDropped, isAtRisk, preFinal50, total100 } = computeRow(row);

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

                return (
                  <tr key={row.StudentID} className={`transition-colors ${rowBg}`}>
                    <td className="px-6 py-3 sticky left-0 z-10 border-r border-border font-medium" style={stickyStyle}>
                      <div className="text-primary">{row.FullName}</div>
                    </td>

                    {preFinalColumns.map((c) => {
                      const editorField = c.field ?? c.key.replace("Grade", "").toLowerCase();
                      const val = isEditing ? gradeEditor.values[editorField] : (row[c.key] ?? "-");
                      const isFailed = !isEditing && val !== "-" && c.max && Number(val) < c.max / 2;
                      return (
                        <td key={c.key} className={`px-4 py-3 text-center font-mono ${isFailed ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                          {isEditing ? (
                            <input type="number" step="0.1" min="0" max={c.max || 100}
                              className="ui-input w-20 text-center font-mono"
                              value={val}
                              onChange={(e) => updateGradeDraftField(editorField, e.target.value)}
                              disabled={isSaving} />
                          ) : val}
                        </td>
                      );
                    })}

                    <td className={`px-4 py-3 text-center font-mono text-sm ${isDropped ? 'text-red-500 font-bold' : isAtRisk ? 'text-amber-500 font-semibold' : 'text-secondary'}`}>
                      {isEditing ? (
                        <input type="number" step="1" min="0"
                          className="ui-input w-16 text-center font-mono"
                          value={gradeEditor.values.hours_absent}
                          onChange={(e) => updateGradeDraftField("hours_absent", e.target.value)}
                          disabled={isSaving} />
                      ) : (
                        row.HoursAbsentTotal != null ? Number(row.HoursAbsentTotal).toFixed(1) : "-"
                      )}
                    </td>

                    <td className={`px-4 py-3 text-center font-mono ${Number(preFinal50) < 25 ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                      {preFinal50}
                    </td>

                    {finalColumns.map((c) => {
                      const editorField = c.field;
                      const val = isEditing ? gradeEditor.values[editorField] : (row[c.key] ?? "-");
                      const isFailed = !isEditing && val !== "-" && c.max && Number(val) < c.max / 2;
                      return (
                        <td key={c.key} className={`px-4 py-3 text-center font-mono ${isFailed ? 'text-red-500 font-bold' : 'text-secondary'}`}>
                          {isEditing ? (
                            <input type="number" step="0.1" min="0" max={c.max || 100}
                              className="ui-input w-20 text-center font-mono"
                              value={val}
                              onChange={(e) => updateGradeDraftField(editorField, e.target.value)}
                              disabled={isSaving} />
                          ) : val}
                        </td>
                      );
                    })}

                    <td className={`px-4 py-3 text-center font-mono font-bold ${Number(total100) < 50 ? 'text-red-500' : 'text-primary'}`}>
                      {total100}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border w-20 ${isDropped
                        ? 'border-red-500/40 bg-red-500/15 text-red-500'
                        : isAtRisk
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-500'
                          : 'border-border bg-surface text-secondary'
                        }`}>
                        {isDropped ? (
                          <>Dropped</>
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
                          className="p-1.5 rounded-sm border border-border text-secondary hover:bg-fg hover:text-bg hover:border-fg transition-all cursor-pointer"
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
    </>
  );
}
