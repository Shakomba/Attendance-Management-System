import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export function PasswordSetup({ apiBase, token, onComplete }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError(t('setup_password_too_short')); return }
    if (password !== confirm) { setError(t('setup_password_mismatch')); return }
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/auth/student/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password, confirm_password: confirm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Setup failed.')
      onComplete(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="w-12 h-12 rounded-full bg-fg/10 flex items-center justify-center mx-auto mb-4">
            <Lock size={22} className="text-fg" />
          </div>
          <h1 className="text-xl font-bold text-fg">{t('setup_password_title')}</h1>
          <p className="text-sm text-secondary mt-1">{t('setup_password_subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('setup_password_new')}
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 pe-10 text-sm bg-surface border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-secondary hover:text-fg transition-colors"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('setup_password_confirm')}
            </label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm bg-surface border border-border rounded-sm text-fg placeholder:text-secondary/50 focus:outline-none focus:border-fg transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-sm px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-fg text-bg text-sm font-medium rounded-sm hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
          >
            {loading ? '...' : t('setup_password_submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
