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
        <div className="min-h-screen bg-bg flex items-center justify-center p-4">
            <div className="w-full max-w-sm">

                {/* Brand */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary mb-4">
                        <UserCheck size={28} className="text-primary-fg" />
                    </div>
                    <h1 className="font-display font-bold text-2xl text-fg tracking-tight">
                        AttendanceAI
                    </h1>
                    <p className="text-sm text-secondary mt-1">Sign in to your professor account</p>
                </div>

                {/* Card */}
                <form
                    onSubmit={handleSubmit}
                    className="bg-card border border-border shadow-sm p-6 space-y-4"
                >
                    {error && (
                        <div className="flex items-start gap-2.5 text-sm text-fg bg-surface border border-border px-3 py-2.5">
                            <span className="mt-0.5 shrink-0 text-secondary">!</span>
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-fg mb-1.5" htmlFor="login-username">
                            Username
                        </label>
                        <input
                            id="login-username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="ui-input w-full"
                            placeholder="e.g. dr.ahmed"
                            required
                            autoFocus
                            autoComplete="username"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-fg mb-1.5" htmlFor="login-password">
                            Password
                        </label>
                        <div className="relative">
                            <input
                                id="login-password"
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
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-fg transition-colors cursor-pointer"
                                tabIndex={-1}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="btn-primary w-full h-10 mt-1"
                    >
                        {loading ? 'Signing in…' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    )
}
