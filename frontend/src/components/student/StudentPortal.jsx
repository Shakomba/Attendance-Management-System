import { useState, useEffect } from 'react'
import { BookOpen, Clock, ShieldAlert, ShieldCheck, ShieldOff, Loader2, Sun, Moon, Languages, LogOut } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export function StudentPortal({ apiBase, student, onLogout, theme, toggleTheme, language, toggleLanguage }) {
  const { t } = useTranslation()
  const [portal, setPortal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const token = localStorage.getItem('ams_token')

  const apiFetch = async (path, options = {}) => {
    const res = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || res.statusText)
    }
    return res.json()
  }

  useEffect(() => {
    const currentToken = localStorage.getItem('ams_token')
    fetch(`${apiBase}/api/student/portal`, {
      headers: { Authorization: `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || res.statusText)
        }
        return res.json()
      })
      .then(setPortal)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [apiBase])

  const handleDeleteFace = async () => {
    setDeleting(true)
    try {
      await apiFetch('/api/student/face', { method: 'DELETE' })
      setPortal(prev => ({ ...prev, face_enrolled: false, face_deleted_by_self: true, face_deleted_at: new Date().toISOString() }))
      setDeleteModal(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const displayName = language === 'ckb' && portal?.full_name_kurdish
    ? portal.full_name_kurdish
    : portal?.full_name || student?.full_name || ''

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-secondary" />
      </div>
    )
  }

  if (error && !portal) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-4 py-3 max-w-sm text-center">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div>
            <p className="text-xs text-secondary">{t('student_portal_title')}</p>
            <p className="text-sm font-semibold text-fg leading-tight">{displayName}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleLanguage}
              className="p-2 rounded-sm text-secondary hover:text-fg hover:bg-bg transition-colors cursor-pointer"
              title="Toggle language"
            >
              <Languages size={16} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-sm text-secondary hover:text-fg hover:bg-bg transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-sm text-secondary hover:text-fg hover:bg-bg transition-colors cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-4 py-3">
            {error}
          </div>
        )}

        {/* Absence cards */}
        <section>
          <h2 className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">
            {t('student_absence_title')}
          </h2>
          <div className="space-y-2">
            {portal?.courses?.length === 0 && (
              <p className="text-sm text-secondary text-center py-8">—</p>
            )}
            {portal?.courses?.map((course, idx) => (
              <div key={idx} className="standard-card flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-fg/10 flex items-center justify-center">
                    <BookOpen size={15} className="text-fg" />
                  </div>
                  <p className="text-sm font-medium text-fg">{course.course_name}</p>
                </div>
                <div className="flex items-center gap-1.5 text-secondary">
                  <Clock size={13} />
                  <span className="text-sm font-semibold text-fg">{course.hours_absent}</span>
                  <span className="text-xs">{t('student_hours_absent')}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Face ID section */}
        <section>
          <h2 className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">
            {t('student_face_id_title')}
          </h2>
          <div className="standard-card px-4 py-4 space-y-4">
            <div className="flex items-center gap-3">
              {portal?.face_enrolled ? (
                <>
                  <ShieldCheck size={18} className="text-green-500" />
                  <span className="text-sm font-medium text-green-500">{t('student_face_active')}</span>
                </>
              ) : portal?.face_deleted_by_self ? (
                <>
                  <ShieldAlert size={18} className="text-red-500" />
                  <span className="text-sm font-medium text-red-500">{t('student_face_deleted')}</span>
                </>
              ) : (
                <>
                  <ShieldOff size={18} className="text-secondary" />
                  <span className="text-sm font-medium text-secondary">{t('student_face_not_enrolled')}</span>
                </>
              )}
            </div>

            {portal?.face_enrolled && (
              <button
                onClick={() => setDeleteModal(true)}
                className="w-full py-2 border border-red-500/40 text-red-500 text-sm font-medium rounded-sm hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                {t('student_face_delete_btn')}
              </button>
            )}

            {portal?.face_deleted_by_self && !portal?.face_enrolled && (
              <p className="text-xs text-secondary leading-relaxed">
                {t('student_face_delete_contact_msg')}
              </p>
            )}
          </div>
        </section>
      </main>

      {/* Delete confirmation modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-sm w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-fg">{t('student_face_delete_confirm_title')}</h3>
            <p className="text-sm text-secondary leading-relaxed">{t('student_face_delete_confirm_body')}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteModal(false)}
                disabled={deleting}
                className="flex-1 py-2 border border-border text-secondary text-sm rounded-sm hover:text-fg transition-colors cursor-pointer disabled:opacity-40"
              >
                {t('student_face_delete_cancel')}
              </button>
              <button
                onClick={handleDeleteFace}
                disabled={deleting}
                className="flex-1 py-2 bg-red-500 text-white text-sm font-medium rounded-sm hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-40"
              >
                {deleting ? '...' : t('student_face_delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
