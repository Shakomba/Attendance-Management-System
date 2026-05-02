import { useState, useEffect, useCallback } from 'react'
import { ScanFace, CheckCircle2, Loader2, RefreshCw, Search, UserPlus, AlertTriangle, X } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { tName } from '../../lib/nameTranslation';

export function EnrollmentTab({ apiFetch, courseId, onEnrollStudent }) {
  const { t, language } = useTranslation()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const loadStudents = useCallback(async () => {
    if (!courseId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/courses/${courseId}/students`)
      setStudents(res?.items || [])
    } catch (err) {
      console.error('Failed to load students:', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, courseId])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  // Poll every 10s to reflect enrollment status changes
  useEffect(() => {
    const timer = setInterval(() => loadStudents(), 10000)
    return () => clearInterval(timer)
  }, [loadStudents])

  const filtered = search.trim()
    ? students.filter(s =>
        tName(s.FullName, language).toLowerCase().includes(search.toLowerCase()) ||
        s.StudentCode.toLowerCase().includes(search.toLowerCase())
      )
    : students

  const [addModal, setAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', full_name_kurdish: '', email: '' })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  const handleAddStudent = async (e) => {
    e.preventDefault()
    setAddError('')
    setAddSuccess('')
    setAddLoading(true)
    try {
      await apiFetch(`/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, course_id: courseId }),
      })
      setAddSuccess(t('add_student_invite_sent'))
      setAddForm({ full_name: '', full_name_kurdish: '', email: '' })
      await loadStudents()
      setTimeout(() => { setAddModal(false); setAddSuccess('') }, 1500)
    } catch (err) {
      setAddError(err.message || 'Failed to add student.')
    } finally {
      setAddLoading(false)
    }
  }

  const enrolledCount = students.filter(s => s.EnrollmentStatus === 'enrolled').length
  const pendingCount = students.length - enrolledCount

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="standard-card px-3 sm:px-4 py-2.5 sm:py-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-secondary font-medium truncate">{t('gb_total')}</p>
          <p className="text-xl sm:text-2xl font-bold text-fg mt-1">{students.length}</p>
        </div>
        <div className="standard-card px-3 sm:px-4 py-2.5 sm:py-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-green-500 font-medium truncate">{t('stat_enrolled')}</p>
          <p className="text-xl sm:text-2xl font-bold text-green-500 mt-1">{enrolledCount}</p>
        </div>
        <div className="standard-card px-3 sm:px-4 py-2.5 sm:py-3">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-secondary font-medium truncate">{t('enroll_pending')}</p>
          <p className="text-xl sm:text-2xl font-bold text-secondary mt-1">{pendingCount}</p>
        </div>
      </div>

      {/* Search + refresh */}
      <div className="standard-card">
        <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-border flex items-center gap-2 sm:gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              type="text"
              placeholder={t('enroll_search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full ps-9 pe-3 py-2 text-sm bg-surface border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
            />
          </div>
          <button
            onClick={loadStudents}
            disabled={loading}
            className="p-2 rounded-sm border border-border text-secondary hover:text-fg hover:bg-surface disabled:opacity-40 transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setAddModal(true); setAddError(''); setAddSuccess('') }}
            className="p-2 rounded-sm border border-border text-secondary hover:text-fg hover:bg-surface transition-colors cursor-pointer"
            title={t('add_student_btn')}
          >
            <UserPlus size={14} />
          </button>
        </div>

        {/* Student list — natural page scroll, no fixed height */}
        <div className="divide-y divide-border">
          {loading && students.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-secondary">
              <Loader2 size={20} className="animate-spin me-2" />
              <span className="text-sm">{t('enroll_loading')}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-secondary">
              <ScanFace size={32} className="opacity-20 mb-3" />
              <p className="text-sm">{search ? t('enroll_no_match') : t('enroll_empty')}</p>
            </div>
          ) : (
            filtered.map((student) => {
              const enrolled = student.EnrollmentStatus === 'enrolled'
              const faceDeletedBySelf = Boolean(student.FaceDeletedBySelf)
              const deletedAt = student.FaceDeletedAt
                ? new Date(student.FaceDeletedAt).toLocaleDateString()
                : ''
              return (
                <div
                  key={student.StudentID}
                  className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-3.5 hover:bg-surface transition-colors gap-2"
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 ${
                      enrolled
                        ? 'bg-green-500/10 text-green-500'
                        : faceDeletedBySelf
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-surface text-secondary'
                    }`}>
                      {enrolled ? <CheckCircle2 size={16} /> : faceDeletedBySelf ? <AlertTriangle size={16} /> : <ScanFace size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg truncate">{tName(student.FullName, language)}</p>
                      {faceDeletedBySelf && !enrolled && (
                        <p
                          className="text-[11px] text-red-500 leading-tight"
                          title={t('enroll_student_deleted_tooltip').replace('{date}', deletedAt)}
                        >
                          {t('enroll_student_deleted')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <button
                      onClick={() => onEnrollStudent(student.StudentID, tName(student.FullName, language))}
                      className={`relative min-w-[108px] px-3 sm:px-4 py-1.5 rounded-sm text-xs font-medium transition-all cursor-pointer whitespace-nowrap text-center ${
                        enrolled
                          ? 'group border border-green-500/40 text-green-500 hover:bg-fg hover:border-fg'
                          : faceDeletedBySelf
                          ? 'bg-red-500/10 border border-red-500/40 text-red-500 hover:bg-fg hover:border-fg hover:text-bg'
                          : 'bg-fg text-bg hover:opacity-80'
                      }`}
                    >
                      {enrolled ? (
                        <>
                          <span className="transition-opacity duration-150 group-hover:opacity-0">{t('enroll_enrolled')}</span>
                          <span className="absolute inset-0 flex items-center justify-center text-bg opacity-0 transition-opacity duration-150 group-hover:opacity-100">{t('enroll_reenroll')}</span>
                        </>
                      ) : faceDeletedBySelf ? (
                        <span>{t('enroll_reenroll')}</span>
                      ) : (
                        t('enroll_add')
                      )}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Add Student Modal */}
      {addModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-sm w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-fg">{t('add_student_title')}</h3>
              <button
                onClick={() => setAddModal(false)}
                className="text-secondary hover:text-fg transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAddStudent} className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  {t('add_student_name_en')} *
                </label>
                <input
                  type="text"
                  required
                  value={addForm.full_name}
                  onChange={(e) => setAddForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  {t('add_student_name_ku')}
                </label>
                <input
                  type="text"
                  value={addForm.full_name_kurdish}
                  onChange={(e) => setAddForm(f => ({ ...f, full_name_kurdish: e.target.value }))}
                  dir="rtl"
                  className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  {t('add_student_email')} *
                </label>
                <input
                  type="email"
                  required
                  value={addForm.email}
                  onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
                />
              </div>

              {addError && (
                <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-3 py-2">
                  {addError}
                </p>
              )}
              {addSuccess && (
                <p className="text-xs text-green-500 bg-green-500/10 border border-green-500/20 rounded-sm px-3 py-2">
                  {addSuccess}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddModal(false)}
                  className="flex-1 py-2 border border-border text-secondary text-sm rounded-sm hover:text-fg transition-colors cursor-pointer"
                >
                  {t('student_face_delete_cancel')}
                </button>
                <button
                  type="submit"
                  disabled={addLoading || !courseId}
                  className="flex-1 py-2 bg-fg text-bg text-sm font-medium rounded-sm hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
                >
                  {addLoading ? '...' : t('add_student_submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
