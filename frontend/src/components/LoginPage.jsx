import { useState } from 'react'
import { UserCheck, Eye, EyeOff } from 'lucide-react'
import { normalizeApiBase } from '../hooks/useApi'

export function LoginPage({ apiBase, onLogin }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await fetch(`${normalizeApiBase(apiBase)}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.detail || 'Login failed')
            onLogin(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-4 font-sans">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-2.5 mb-3">
                        <UserCheck size={28} className="text-fg" />
                        <h1 className="font-mono font-bold text-2xl tracking-tight text-fg">
                            Attendance
                        </h1>
                    </div>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="bg-surface border border-border rounded-sm shadow-sm p-6 space-y-5"
                >
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 rounded-sm px-3 py-2.5">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-fg mb-1.5">
                            Username
                        </label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="ui-input w-full"
                            placeholder="Enter your username"
                            required
                            autoFocus
                            autoComplete="username"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-fg mb-1.5">
                            Password
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="ui-input w-full pr-10"
                                placeholder="Enter your password"
                                required
                                autoComplete="current-password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-fg transition-colors"
                                tabIndex={-1}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="btn-primary w-full h-10"
                    >
                        {loading ? 'Signing in\u2026' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    )
}
