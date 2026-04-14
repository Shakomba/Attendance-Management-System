import { useState, useEffect, useCallback } from 'react'
import { ScanFace, CheckCircle2, Clock, Loader2, RefreshCw, Search } from 'lucide-react'

export function EnrollmentTab({ apiFetch, courseId, onEnrollStudent }) {
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
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="standard-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-secondary font-medium">Total</p>
          <p className="text-2xl font-bold text-fg mt-1">{students.length}</p>
        </div>
        <div className="standard-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-green-500 font-medium">Enrolled</p>
          <p className="text-2xl font-bold text-green-500 mt-1">{enrolledCount}</p>
        </div>
        <div className="standard-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-secondary font-medium">Pending</p>
          <p className="text-2xl font-bold text-secondary mt-1">{pendingCount}</p>
        </div>
      </div>

      {/* Search + refresh */}
      <div className="standard-card">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              type="text"
              placeholder="Search students..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
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
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-sm">Loading students...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-secondary">
              <ScanFace size={32} className="opacity-20 mb-3" />
              <p className="text-sm">{search ? 'No students match your search' : 'No students in this course'}</p>
            </div>
          ) : (
            filtered.map((student) => {
              const enrolled = student.EnrollmentStatus === 'enrolled'
              return (
                <div
                  key={student.StudentID}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-surface transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      enrolled
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-surface text-secondary'
                    }`}>
                      {enrolled ? <CheckCircle2 size={18} /> : <ScanFace size={18} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-fg truncate">{student.FullName}</p>
                      <p className="text-[11px] text-secondary font-mono">{student.StudentCode}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {enrolled ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-medium border border-green-500/30 bg-green-500/10 text-green-500">
                        <CheckCircle2 size={11} /> Enrolled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-medium border border-border bg-surface text-secondary">
                        <Clock size={11} /> Pending
                      </span>
                    )}
                    <button
                      onClick={() => onEnrollStudent(student.StudentID, student.FullName)}
                      className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-all cursor-pointer ${
                        enrolled
                          ? 'border border-border text-secondary hover:text-fg hover:bg-surface'
                          : 'bg-fg text-bg hover:opacity-80'
                      }`}
                    >
                      {enrolled ? 'Re-enroll' : 'Enroll'}
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
