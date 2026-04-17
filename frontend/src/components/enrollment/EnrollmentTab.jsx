import { useState, useEffect, useCallback } from 'react'
import { ScanFace, CheckCircle2, Clock, Loader2, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export function EnrollmentTab({ apiFetch, courseId, onEnrollStudent }) {
  const { t } = useTranslation()
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
        s.FullName.toLowerCase().includes(search.toLowerCase()) ||
        s.StudentCode.toLowerCase().includes(search.toLowerCase())
      )
    : students

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
              return (
                <div
                  key={student.StudentID}
                  className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-3.5 hover:bg-surface transition-colors gap-2"
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 ${
                      enrolled
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-surface text-secondary'
                    }`}>
                      {enrolled ? <CheckCircle2 size={16} /> : <ScanFace size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg truncate">{student.FullName}</p>
                      {/* Mobile-only status text under name */}
                      <p className={`text-[10px] font-medium mt-0.5 sm:hidden ${enrolled ? 'text-green-500' : 'text-secondary'}`}>
                        {enrolled ? t('enroll_completed') : t('enroll_pending')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {/* Status badge — desktop only */}
                    <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-medium border ${
                      enrolled
                        ? 'border-green-500/30 bg-green-500/10 text-green-500'
                        : 'border-border bg-surface text-secondary'
                    }`}>
                      {enrolled ? <><CheckCircle2 size={11} /> {t('enroll_completed')}</> : <><Clock size={11} /> {t('enroll_pending')}</>}
                    </span>
                    <button
                      onClick={() => onEnrollStudent(student.StudentID, student.FullName)}
                      className={`px-3 sm:px-4 py-1.5 rounded-sm text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                        enrolled
                          ? 'border border-border text-secondary hover:text-fg hover:bg-surface'
                          : 'bg-fg text-bg hover:opacity-80'
                      }`}
                    >
                      {enrolled ? t('enroll_reenroll') : t('enroll_add')}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
