import { useState, useEffect } from 'react'
import { UserCheck, Eye, EyeOff, Fingerprint } from 'lucide-react'
import { normalizeApiBase } from '../../hooks/useApi'
import { useTranslation } from '../../lib/i18n'

/* ── WebAuthn browser helpers ────────────────────────────────────────────── */
function b64urlToBuffer(b64url) {
    const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(base64)
    return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer
}

function bufferToB64url(buffer) {
    const bytes = new Uint8Array(buffer)
    let bin = ''
    bytes.forEach(b => (bin += String.fromCharCode(b)))
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function decodeOptions(raw) {
    // Convert base64url-encoded binary fields to ArrayBuffer for the browser API
    const opts = { ...raw }
    opts.challenge = b64urlToBuffer(raw.challenge)
    if (raw.allowCredentials) {
        opts.allowCredentials = raw.allowCredentials.map(c => ({ ...c, id: b64urlToBuffer(c.id) }))
    }
    if (raw.user) {
        opts.user = { ...raw.user, id: b64urlToBuffer(raw.user.id) }
    }
    if (raw.excludeCredentials) {
        opts.excludeCredentials = raw.excludeCredentials.map(c => ({ ...c, id: b64urlToBuffer(c.id) }))
    }
    return opts
}

function encodeAssertion(assertion) {
    return {
        id: assertion.id,
        rawId: bufferToB64url(assertion.rawId),
        type: assertion.type,
        response: {
            clientDataJSON: bufferToB64url(assertion.response.clientDataJSON),
            authenticatorData: bufferToB64url(assertion.response.authenticatorData),
            signature: bufferToB64url(assertion.response.signature),
            userHandle: assertion.response.userHandle ? bufferToB64url(assertion.response.userHandle) : null,
        },
    }
}

/* ── Component ───────────────────────────────────────────────────────────── */
export function LoginPage({ apiBase, onLogin }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [biometricLoading, setBiometricLoading] = useState(false)
    const [webAuthnSupported, setWebAuthnSupported] = useState(false)

    useEffect(() => {
        setWebAuthnSupported(
            typeof window !== 'undefined' &&
            !!window.PublicKeyCredential &&
            typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
        )
    }, [])

    const { t } = useTranslation()

    const base = normalizeApiBase(apiBase)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await fetch(`${base}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.detail || t('login_failed'))
            onLogin(data)
        } catch (err) {
            setError(err.message || t('login_failed'))
        } finally {
            setLoading(false)
        }
    }

    const handleBiometric = async () => {
        setError('')
        setBiometricLoading(true)
        try {
            // 1. Get challenge — no username needed, browser will show passkey picker
            const beginRes = await fetch(`${base}/api/auth/webauthn/authenticate/begin`, {
                method: 'POST',
            })
            const beginData = await beginRes.json()
            if (!beginRes.ok) throw new Error(beginData?.detail || t('login_biometric_start_failed'))

            // 2. Browser shows its own passkey picker (no username needed)
            const assertion = await navigator.credentials.get({
                publicKey: decodeOptions(beginData.options),
            })

            // 3. Server identifies professor from credential ID alone
            const completeRes = await fetch(`${base}/api/auth/webauthn/authenticate/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: beginData.session_id,
                    credential: encodeAssertion(assertion),
                }),
            })
            const completeData = await completeRes.json()
            if (!completeRes.ok) throw new Error(completeData?.detail || t('login_biometric_verify_failed'))
            onLogin(completeData)
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                setError(t('login_biometric_dismissed'))
            } else if (err.name === 'NotSupportedError' || err.name === 'InvalidStateError') {
                setError(t('login_no_passkey'))
            } else {
                setError(err.message || t('login_biometric_error'))
            }
        } finally {
            setBiometricLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-4 font-sans">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-2.5 mb-3">
                        <UserCheck size={28} className="text-fg" />
                        <h1 className="font-mono font-bold text-2xl tracking-tight text-fg">
                            {t('app_name')}
                        </h1>
                    </div>
                </div>

                <div className="bg-surface border border-border rounded-sm shadow-sm p-6 space-y-5">
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 rounded-sm px-3 py-2.5">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-fg mb-1.5">
                                {t('login_username')}
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="ui-input w-full"
                                placeholder={t('login_username_ph')}
                                required
                                autoFocus
                                autoComplete="username"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-fg mb-1.5">
                                {t('login_password')}
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="ui-input w-full pe-10"
                                    placeholder={t('login_password_ph')}
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute end-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-fg transition-colors"
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
                            {loading ? t('login_signing_in') : t('login_signin')}
                        </button>
                    </form>

                    {webAuthnSupported && (
                        <>
                            <div className="flex items-center gap-3">
                                <div className="flex-1 h-px bg-border" />
                                <span className="text-[11px] text-secondary">{t('login_or')}</span>
                                <div className="flex-1 h-px bg-border" />
                            </div>
                            <button
                                type="button"
                                onClick={handleBiometric}
                                disabled={biometricLoading}
                                className="w-full h-10 flex items-center justify-center gap-2 border border-border rounded-sm text-sm font-medium text-secondary hover:text-fg hover:bg-fg/5 transition-colors cursor-pointer disabled:opacity-40"
                            >
                                <Fingerprint size={16} />
                                {biometricLoading ? t('status_verifying') : t('login_passkey')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
