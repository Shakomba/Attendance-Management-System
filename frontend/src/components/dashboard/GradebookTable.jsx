import { Edit2, ShieldAlert, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'

/* ── Shared helpers ──────────────────────────────────────────────── */
const preFinalColumns = [
  { key: "Quiz1", labelKey: "gb_quiz1", field: "quiz1", max: 6 },
  { key: "Quiz2", labelKey: "gb_quiz2", field: "quiz2", max: 6 },
  { key: "ProjectGrade", labelKey: "gb_project", field: "project", max: 12 },
  { key: "AssignmentGrade", labelKey: "gb_assignment", field: "assignment", max: 6 },
  { key: "MidtermGrade", labelKey: "gb_midterm", field: "midterm", max: 20 },
];
const finalColumns = [
  { key: "FinalExamGrade", labelKey: "gb_total", field: "final_exam", max: 50 },
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
  const { t } = useTranslation()
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
          <div className="mt-1">
            <span className={`text-lg font-bold font-mono ${Number(total100) < 50 ? 'text-red-500' : 'text-primary'}`}>
              {total100}
              <span className="text-[10px] font-normal text-secondary ms-0.5">/100</span>
            </span>
          </div>
        </div>
        {!isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); startGradeEdit(row); }}
            className="p-2 rounded-sm border border-border text-secondary hover:bg-fg hover:text-bg hover:border-fg transition-all cursor-pointer shrink-0 ms-2"
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
                  <span className="text-[10px] uppercase text-secondary font-medium">{t(c.labelKey)} <span className="opacity-50">/{c.max}</span></span>
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
              <span className="text-[10px] uppercase text-secondary font-medium">{t('gb_absence_hrs')}</span>
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
              <span className="text-[10px] uppercase text-secondary font-medium">{t('gb_pre_fin_short')}</span>
              <span className={`font-mono text-sm ${Number(preFinal50) < 25 ? 'text-red-500 font-bold' : 'text-fg'}`}>{preFinal50}</span>
            </div>
          </div>

          {/* Edit actions */}
          {isEditing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => saveGradeEdit(row.StudentID)} disabled={isSaving} className="btn-primary flex-1 h-9 text-sm">
                {isSaving ? "..." : t('gb_action_save')}
              </button>
              <button onClick={cancelGradeEdit} disabled={isSaving} className="btn-secondary flex-1 h-9 text-sm">
                {t('gb_action_cancel')}
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
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  if (!gradebook?.length) {
    return (
      <div className="standard-card p-10 flex flex-col items-center justify-center text-secondary border-dashed">
        <ShieldAlert size={32} className="mb-4 opacity-50" />
        <p>{t('gb_no_data')}</p>
      </div>
    );
  }

  const filtered = search.trim()
    ? gradebook.filter(row => row.FullName?.toLowerCase().includes(search.trim().toLowerCase()))
    : gradebook

  return (
    <>
      {/* ── Mobile card list (below lg) ────────────────────────────── */}
      <div className="lg:hidden space-y-3">
        <div className="px-1 mb-2 flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-primary">{t('gb_master_title')}</h2>
          <div className="relative">
            <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('gb_search_placeholder')}
              className="ui-input w-full ps-7 py-1.5 text-xs"
            />
          </div>
        </div>
        {filtered.map((row) => (
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
        <div className="px-6 py-4 border-b border-border bg-surface flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-primary shrink-0">{t('gb_master_title')}</h2>
          <div className="relative w-56">
            <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('gb_search_placeholder')}
              className="ui-input w-full ps-7 py-1.5 text-xs"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="bg-bg border-b border-border text-xs uppercase text-secondary">
              <tr>
                <th className="px-6 py-3 font-medium sticky start-0 bg-bg z-10 border-e border-border min-w-[200px]">{t('table_student')}</th>
                {preFinalColumns.map((c) => (
                  <th key={c.key} className="px-4 py-3 font-medium text-center">{t(c.labelKey)}</th>
                ))}
                <th className="px-4 py-3 font-medium text-center">{t('gb_absence_hrs')}</th>
                <th className="px-4 py-3 font-medium text-center text-primary">{t('gb_pre_final_col')}</th>
                {finalColumns.map((c) => (
                  <th key={c.key} className="px-4 py-3 font-medium text-center">{t(c.labelKey)}</th>
                ))}
                <th className="px-4 py-3 font-medium text-center font-bold">{t('gb_total_100')}</th>
                <th className="px-6 py-3 text-end">{t('table_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => {
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
                    <td className="px-6 py-3 sticky start-0 z-10 border-e border-border font-medium" style={stickyStyle}>
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

                    <td className="px-6 py-3 text-end">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => saveGradeEdit(row.StudentID)}
                            disabled={isSaving}
                            className="btn-primary"
                          >
                            {isSaving ? "..." : t('gb_action_save')}
                          </button>
                          <button
                            onClick={cancelGradeEdit}
                            disabled={isSaving}
                            className="btn-secondary"
                          >
                            {t('gb_action_cancel')}
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
