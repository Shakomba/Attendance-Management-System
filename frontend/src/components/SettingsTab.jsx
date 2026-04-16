import { useEffect, useRef, useState } from 'react'
import {
    Sun, Moon, Globe, RotateCcw, AlertTriangle, Loader2,
    Download, Upload, CheckCircle2, Fingerprint, Trash2, Plus,
    Lock, ChevronDown, ChevronUp, Mail,
} from 'lucide-react'

const LANGUAGES = [
    { code: 'en',  label: 'English' },
    { code: 'ckb', label: 'کوردی (Central Kurdish)' },
]

/* ── Small reusable primitives ───────────────────────────────────────── */

function SectionHeader({ title, description }) {
    return (
        <div className="mb-3">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
        </div>
    )
}

function Field({ label, hint, children }) {
    return (
        <div>
            <label className="block text-[11px] font-medium text-secondary mb-1.5">
                {label}
            </label>
            {children}
            {hint && <p className="text-[10px] text-secondary mt-1">{hint}</p>}
        </div>
    )
}

function Toggle({ checked, onChange }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/20 ${
                checked ? 'bg-fg' : 'bg-border'
            }`}
        >
            <span className={`inline-block h-4 w-4 rounded-full bg-bg shadow-sm transition-transform duration-200 ${
                checked ? 'translate-x-[22px]' : 'translate-x-[4px]'
            }`} />
        </button>
    )
}

/* Thin rule with optional label */
function Divider({ label }) {
    if (!label) return <div className="border-t border-border" />
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-[10px] font-medium text-secondary uppercase tracking-widest">{label}</span>
            <div className="flex-1 border-t border-border" />
        </div>
    )
}

/* ── Confirm Dialog ──────────────────────────────────────────────────── */

function ConfirmDialog({ onConfirm, onCancel, busy }) {
    const [exportFirst, setExportFirst] = useState(true)
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-bg border border-border shadow-2xl w-full max-w-sm rounded-sm overflow-hidden">
                <div className="px-5 pt-5 pb-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-sm bg-red-500/10 flex items-center justify-center shrink-0">
                            <AlertTriangle size={14} className="text-red-500" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-fg">Reset all course data?</p>
                            <p className="text-xs text-secondary mt-1 leading-relaxed">
                                All grades, absences, sessions, and attendance history will be permanently deleted.
                            </p>
                        </div>
                    </div>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none px-3 py-2.5 rounded-sm bg-fg/5 border border-border">
                        <input
                            type="checkbox"
                            checked={exportFirst}
                            onChange={e => setExportFirst(e.target.checked)}
                            className="w-3.5 h-3.5 accent-fg cursor-pointer"
                        />
                        <span className="text-xs text-secondary">Download a backup before resetting</span>
                    </label>
                </div>
                <div className="border-t border-border px-5 py-3 flex justify-end gap-2 bg-surface">
                    <button onClick={onCancel} disabled={busy} className="btn-secondary text-xs px-4 py-2">
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(exportFirst)}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-red-500 text-white hover:bg-red-600 rounded-sm transition-colors cursor-pointer disabled:opacity-40 min-w-[126px] justify-center"
                    >
                        {busy && <Loader2 size={12} className="animate-spin" />}
                        {busy ? 'Resetting…' : 'Reset everything'}
                    </button>
                </div>
            </div>
        </div>
    )
}

/* ── Main ────────────────────────────────────────────────────────────── */

export function SettingsTab({
    theme, onToggleTheme,
    language, onChangeLanguage,
    sendEmailsOnFinalize, onToggleSendEmails,
    apiFetch, courseId,
    professor, onProfileUpdate,
    onReset,
}) {
    const [showConfirm, setShowConfirm] = useState(false)
    const [resetting, setResetting] = useState(false)

    /* ── Profile ───────────────────────────────────────────────────── */
    const [profileDraft, setProfileDraft] = useState({
        full_name:        professor?.full_name   || '',
        username:         professor?.username    || '',
        course_name:      professor?.course_name || '',
        current_password: '',
        new_password:     '',
        confirm_password: '',
    })
    const [profileSaving,      setProfileSaving]      = useState(false)
    const [profileError,       setProfileError]        = useState('')
    const [profileSuccess,     setProfileSuccess]      = useState(false)
    const [showPasswordFields, setShowPasswordFields]  = useState(false)

    useEffect(() => {
        if (professor) {
            setProfileDraft(d => ({
                ...d,
                full_name:   professor.full_name   || '',
                username:    professor.username    || '',
                course_name: professor.course_name || '',
            }))
        }
    }, [professor?.full_name, professor?.username, professor?.course_name])

    const handleProfileSave = async () => {
        setProfileError('')
        setProfileSuccess(false)
        if (profileDraft.new_password && profileDraft.new_password !== profileDraft.confirm_password) {
            setProfileError('New passwords do not match.')
            return
        }
        if (profileDraft.new_password && !profileDraft.current_password) {
            setProfileError('Enter your current password to set a new one.')
            return
        }
        setProfileSaving(true)
        try {
            const payload = {}
            if (profileDraft.full_name   !== professor?.full_name)   payload.full_name   = profileDraft.full_name
            if (profileDraft.username    !== professor?.username)     payload.username    = profileDraft.username
            if (profileDraft.course_name !== professor?.course_name) payload.course_name = profileDraft.course_name
            if (profileDraft.new_password) {
                payload.new_password     = profileDraft.new_password
                payload.current_password = profileDraft.current_password
            }
            if (!Object.keys(payload).length) { setProfileSuccess(true); return }
            const result = await apiFetch('/api/auth/profile', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            })
            onProfileUpdate?.(result)
            setProfileDraft(d => ({ ...d, current_password: '', new_password: '', confirm_password: '' }))
            setProfileSuccess(true)
            setShowPasswordFields(false)
        } catch (err) {
            setProfileError(err.message || 'Failed to save.')
        } finally {
            setProfileSaving(false)
        }
    }

    /* ── Passkeys ──────────────────────────────────────────────────── */
    const [passkeys,          setPasskeys]          = useState([])
    const [passkeySupported,  setPasskeySupported]  = useState(false)
    const [registeringPasskey, setRegisteringPasskey] = useState(false)
    const [deletingPasskey,   setDeletingPasskey]   = useState(null)
    const [passkeyDeviceName, setPasskeyDeviceName] = useState('')

    useEffect(() => {
        setPasskeySupported(!!window.PublicKeyCredential)
        loadPasskeys()
    }, [])

    const loadPasskeys = async () => {
        try {
            const data = await apiFetch('/api/auth/webauthn/credentials')
            setPasskeys(data.items || [])
        } catch { }
    }

    const b64urlToBuffer = b64url => {
        const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'))
        return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer
    }
    const bufferToB64url = buffer => {
        let bin = ''
        new Uint8Array(buffer).forEach(b => (bin += String.fromCharCode(b)))
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    }

    const handleRegisterPasskey = async () => {
        setRegisteringPasskey(true)
        try {
            const beginData = await apiFetch('/api/auth/webauthn/register/begin', { method: 'POST' })
            const opts = beginData.options
            opts.challenge = b64urlToBuffer(opts.challenge)
            opts.user.id   = b64urlToBuffer(opts.user.id)
            if (opts.excludeCredentials)
                opts.excludeCredentials = opts.excludeCredentials.map(c => ({ ...c, id: b64urlToBuffer(c.id) }))

            const cred = await navigator.credentials.create({ publicKey: opts })
            await apiFetch('/api/auth/webauthn/register/complete', {
                method: 'POST',
                body: JSON.stringify({
                    session_id:  beginData.session_id,
                    device_name: passkeyDeviceName.trim() || navigator.platform || 'This device',
                    credential: {
                        id:     cred.id,
                        rawId:  bufferToB64url(cred.rawId),
                        type:   cred.type,
                        response: {
                            clientDataJSON:    bufferToB64url(cred.response.clientDataJSON),
                            attestationObject: bufferToB64url(cred.response.attestationObject),
                        },
                    },
                }),
            })
            setPasskeyDeviceName('')
            await loadPasskeys()
        } catch (err) {
            if (err.name !== 'NotAllowedError') console.error('Passkey registration failed:', err.message)
        } finally {
            setRegisteringPasskey(false)
        }
    }

    const handleDeletePasskey = async (credentialId) => {
        setDeletingPasskey(credentialId)
        try {
            await apiFetch(`/api/auth/webauthn/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' })
            await loadPasskeys()
        } catch (err) {
            console.error('Failed to remove passkey:', err.message)
        } finally {
            setDeletingPasskey(null)
        }
    }

    /* ── Data ──────────────────────────────────────────────────────── */
    const [exporting,    setExporting]    = useState(false)
    const [importing,    setImporting]    = useState(false)
    const [importResult, setImportResult] = useState(null)
    const fileInputRef = useRef(null)

    const handleExport = async () => {
        setExporting(true)
        try {
            const res  = await apiFetch(`/api/courses/${courseId}/gradebook/export`, { _raw: true })
            const blob = await res.blob()
            const url  = URL.createObjectURL(blob)
            const a    = document.createElement('a')
            a.href     = url
            a.download = `course_${courseId}_backup.zip`
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Export failed:', err.message)
        } finally {
            setExporting(false)
        }
    }

    const handleImport = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        e.target.value = ''
        setImporting(true)
        setImportResult(null)
        try {
            const form = new FormData()
            form.append('file', file)
            const result = await apiFetch(`/api/courses/${courseId}/gradebook/import`, {
                method: 'POST',
                body: form,
            })
            setImportResult(result)
            onReset?.()
        } catch (err) {
            setImportResult({ errors: [err.message] })
        } finally {
            setImporting(false)
        }
    }

    const handleConfirmReset = async (exportFirst) => {
        setResetting(true)
        try {
            if (exportFirst) {
                const res  = await apiFetch(`/api/courses/${courseId}/gradebook/export`, { _raw: true })
                const blob = await res.blob()
                const url  = URL.createObjectURL(blob)
                const a    = document.createElement('a')
                a.href     = url
                a.download = `course_${courseId}_backup.zip`
                a.click()
                URL.revokeObjectURL(url)
            }
            await apiFetch(`/api/courses/${courseId}/reset`, { method: 'POST' })
            setShowConfirm(false)
            onReset?.()
        } catch (err) {
            console.error('Reset failed:', err.message)
        } finally {
            setResetting(false)
        }
    }

    const initials = (professor?.full_name || professor?.username || '?')
        .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

    /* ── Render ────────────────────────────────────────────────────── */
    return (
        <>
            {showConfirm && (
                <ConfirmDialog
                    onConfirm={handleConfirmReset}
                    onCancel={() => setShowConfirm(false)}
                    busy={resetting}
                />
            )}

            <input ref={fileInputRef} type="file" accept=".zip,.csv" className="hidden" onChange={handleImport} />

            <div className="max-w-2xl space-y-8 animate-fade-in">

                {/* ══ PROFILE ══════════════════════════════════════════ */}
                <section>
                    <SectionHeader title="Profile" description="Your account details and login credentials" />

                    <div className="standard-card overflow-hidden">
                        {/* Avatar strip */}
                        <div className="flex items-center gap-4 px-5 py-4 bg-surface border-b border-border">
                            <div className="w-11 h-11 rounded-sm bg-fg/10 flex items-center justify-center shrink-0 select-none">
                                <span className="text-base font-bold font-mono text-fg">{initials}</span>
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-fg truncate leading-snug">
                                    {professor?.full_name || professor?.username}
                                </p>
                                <p className="text-[11px] text-secondary truncate">
                                    @{professor?.username}{professor?.course_name ? ` · ${professor.course_name}` : ''}
                                </p>
                            </div>
                        </div>

                        {/* Fields */}
                        <div className="px-5 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Full name">
                                    <input
                                        type="text"
                                        value={profileDraft.full_name}
                                        onChange={e => setProfileDraft(d => ({ ...d, full_name: e.target.value }))}
                                        className="ui-input w-full"
                                    />
                                </Field>
                                <Field label="Username">
                                    <input
                                        type="text"
                                        value={profileDraft.username}
                                        onChange={e => setProfileDraft(d => ({ ...d, username: e.target.value }))}
                                        className="ui-input w-full"
                                        autoComplete="off"
                                    />
                                </Field>
                            </div>
                            <Field label="Course name">
                                <input
                                    type="text"
                                    value={profileDraft.course_name}
                                    onChange={e => setProfileDraft(d => ({ ...d, course_name: e.target.value }))}
                                    className="ui-input w-full"
                                />
                            </Field>

                            <div className="flex items-center justify-between pt-1">
                                <div className="text-xs min-h-[16px]">
                                    {profileError && <span className="text-red-500">{profileError}</span>}
                                    {profileSuccess && !profileError && (
                                        <span className="text-green-500 flex items-center gap-1">
                                            <CheckCircle2 size={11} /> Saved
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleProfileSave}
                                    disabled={profileSaving}
                                    className="btn-primary text-xs px-4 py-1.5"
                                >
                                    {profileSaving && <Loader2 size={12} className="animate-spin" />}
                                    {profileSaving ? 'Saving…' : 'Save changes'}
                                </button>
                            </div>
                        </div>

                        {/* Password — disclosure */}
                        <div className="border-t border-border">
                            <button
                                type="button"
                                onClick={() => setShowPasswordFields(v => !v)}
                                className="w-full flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-surface transition-colors text-left"
                            >
                                <div className="flex items-center gap-2.5">
                                    <Lock size={13} className="text-secondary" />
                                    <span className="text-sm font-medium text-fg">Change password</span>
                                </div>
                                {showPasswordFields
                                    ? <ChevronUp size={14} className="text-secondary" />
                                    : <ChevronDown size={14} className="text-secondary" />}
                            </button>

                            {showPasswordFields && (
                                <div className="border-t border-border px-5 py-5 bg-surface space-y-4">
                                    <Field label="Current password">
                                        <input
                                            type="password"
                                            value={profileDraft.current_password}
                                            onChange={e => setProfileDraft(d => ({ ...d, current_password: e.target.value }))}
                                            className="ui-input w-full"
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                        />
                                    </Field>
                                    <div className="grid grid-cols-2 gap-4">
                                        <Field label="New password">
                                            <input
                                                type="password"
                                                value={profileDraft.new_password}
                                                onChange={e => setProfileDraft(d => ({ ...d, new_password: e.target.value }))}
                                                className="ui-input w-full"
                                                autoComplete="new-password"
                                                placeholder="••••••••"
                                            />
                                        </Field>
                                        <Field label="Confirm new password">
                                            <input
                                                type="password"
                                                value={profileDraft.confirm_password}
                                                onChange={e => setProfileDraft(d => ({ ...d, confirm_password: e.target.value }))}
                                                className="ui-input w-full"
                                                autoComplete="new-password"
                                                placeholder="••••••••"
                                            />
                                        </Field>
                                    </div>
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={handleProfileSave}
                                            disabled={profileSaving}
                                            className="btn-primary text-xs px-4 py-1.5"
                                        >
                                            {profileSaving && <Loader2 size={12} className="animate-spin" />}
                                            {profileSaving ? 'Saving…' : 'Update password'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* ══ PASSKEYS ═════════════════════════════════════════ */}
                {passkeySupported && (
                    <section>
                        <SectionHeader
                            title="Passkeys"
                            description="Sign in with biometrics — no password required"
                        />
                        <div className="standard-card overflow-hidden">
                            {passkeys.length === 0 ? (
                                <div className="px-5 py-4 text-xs text-secondary">
                                    No passkeys registered yet.
                                </div>
                            ) : (
                                <div className="divide-y divide-border">
                                    {passkeys.map(pk => (
                                        <div key={pk.credential_id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-8 h-8 rounded-sm bg-fg/[0.06] border border-border flex items-center justify-center shrink-0">
                                                    <Fingerprint size={14} className="text-secondary" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-fg truncate">{pk.device_name}</p>
                                                    <p className="text-[11px] text-secondary">Added {new Date(pk.created_at).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDeletePasskey(pk.credential_id)}
                                                disabled={deletingPasskey === pk.credential_id}
                                                className="p-1.5 rounded-sm text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-40"
                                                aria-label="Remove passkey"
                                            >
                                                {deletingPasskey === pk.credential_id
                                                    ? <Loader2 size={14} className="animate-spin" />
                                                    : <Trash2 size={14} />}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="border-t border-border px-5 py-4 flex items-center gap-2 bg-surface">
                                <input
                                    type="text"
                                    value={passkeyDeviceName}
                                    onChange={e => setPasskeyDeviceName(e.target.value)}
                                    placeholder="Device name (optional)"
                                    className="ui-input flex-1 text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={handleRegisterPasskey}
                                    disabled={registeringPasskey}
                                    className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap"
                                >
                                    {registeringPasskey
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <Plus size={12} />}
                                    {registeringPasskey ? 'Registering…' : 'Add passkey'}
                                </button>
                            </div>
                        </div>
                    </section>
                )}

                {/* ══ APPEARANCE ═══════════════════════════════════════ */}
                <section>
                    <SectionHeader title="Appearance" description="Theme and language preferences" />

                    {/* Theme cards */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <button
                            type="button"
                            onClick={() => theme !== 'light' && onToggleTheme()}
                            className={`flex flex-col gap-3 p-4 rounded-sm border-2 transition-colors duration-150 cursor-pointer text-left focus:outline-none ${
                                theme === 'light' ? 'border-fg' : 'border-border hover:border-fg/40'
                            }`}
                        >
                            <div className="w-full h-12 rounded-[3px] bg-white border border-zinc-200 p-2 flex flex-col gap-1 overflow-hidden">
                                <div className="h-2 w-8 rounded-[2px] bg-zinc-800/80" />
                                <div className="h-1.5 w-12 rounded-[2px] bg-zinc-200" />
                                <div className="h-1.5 w-9 rounded-[2px] bg-zinc-200" />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <Sun size={12} className="text-secondary" />
                                    <span className="text-xs font-medium text-fg">Light</span>
                                </div>
                                {theme === 'light' && <CheckCircle2 size={13} className="text-fg" />}
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => theme !== 'dark' && onToggleTheme()}
                            className={`flex flex-col gap-3 p-4 rounded-sm border-2 transition-colors duration-150 cursor-pointer text-left focus:outline-none ${
                                theme === 'dark' ? 'border-fg' : 'border-border hover:border-fg/40'
                            }`}
                        >
                            <div className="w-full h-12 rounded-[3px] bg-[#111113] border border-[#2E2E32] p-2 flex flex-col gap-1 overflow-hidden">
                                <div className="h-2 w-8 rounded-[2px] bg-[#F1F1F3]/80" />
                                <div className="h-1.5 w-12 rounded-[2px] bg-[#2E2E32]" />
                                <div className="h-1.5 w-9 rounded-[2px] bg-[#2E2E32]" />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <Moon size={12} className="text-secondary" />
                                    <span className="text-xs font-medium text-fg">Dark</span>
                                </div>
                                {theme === 'dark' && <CheckCircle2 size={13} className="text-fg" />}
                            </div>
                        </button>
                    </div>

                    {/* Language + notifications in one card */}
                    <div className="standard-card px-5">
                        <div className="flex items-center justify-between gap-6 py-4 border-b border-border">
                            <div>
                                <p className="text-sm font-medium text-fg">Language</p>
                                <p className="text-xs text-secondary mt-0.5">Interface display language</p>
                            </div>
                            <select
                                value={language}
                                onChange={e => onChangeLanguage(e.target.value)}
                                className="ui-input text-xs cursor-pointer shrink-0"
                            >
                                {LANGUAGES.map(({ code, label }) => (
                                    <option key={code} value={code}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center justify-between gap-6 py-4">
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <Mail size={13} className="text-secondary" />
                                    <p className="text-sm font-medium text-fg">Email absent students after session</p>
                                </div>
                                <p className="text-xs text-secondary mt-0.5 ml-[22px]">
                                    Send absence reports automatically when a lecture ends
                                </p>
                            </div>
                            <Toggle checked={sendEmailsOnFinalize} onChange={onToggleSendEmails} />
                        </div>
                    </div>
                </section>

                {/* ══ DATA ═════════════════════════════════════════════ */}
                <section>
                    <SectionHeader title="Data" description="Export or restore course grades and session history" />
                    <div className="standard-card px-5">
                        {/* Export */}
                        <div className="flex items-center justify-between gap-6 py-4 border-b border-border">
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <Download size={13} className="text-secondary" />
                                    <p className="text-sm font-medium text-fg">Export backup</p>
                                </div>
                                <p className="text-xs text-secondary mt-0.5 ml-[22px]">
                                    Download grades, sessions, and attendance as a ZIP archive
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleExport}
                                disabled={exporting}
                                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                {exporting ? 'Exporting…' : 'Export ZIP'}
                            </button>
                        </div>

                        {/* Import */}
                        <div className="flex items-start justify-between gap-6 py-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <Upload size={13} className="text-secondary" />
                                    <p className="text-sm font-medium text-fg">Import backup</p>
                                </div>
                                <p className="text-xs text-secondary mt-0.5 ml-[22px]">
                                    Restore from a ZIP backup, or upload a grades CSV for grades only
                                </p>
                                {importResult && (
                                    <div className="mt-2 ml-[22px]">
                                        {!importResult.errors?.length ? (
                                            <p className="text-xs text-green-500 flex items-center gap-1">
                                                <CheckCircle2 size={11} />
                                                {[
                                                    `${importResult.grades_updated ?? importResult.updated ?? 0} grades`,
                                                    importResult.sessions_restored  > 0 && `${importResult.sessions_restored} sessions`,
                                                    importResult.attendance_restored > 0 && `${importResult.attendance_restored} records`,
                                                ].filter(Boolean).join(', ')} restored
                                            </p>
                                        ) : (
                                            importResult.errors.map((e, i) => (
                                                <p key={i} className="text-xs text-red-500">{e}</p>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={importing}
                                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                                {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                {importing ? 'Importing…' : 'Import backup'}
                            </button>
                        </div>
                    </div>
                </section>

                {/* ══ DANGER ZONE ══════════════════════════════════════ */}
                <section>
                    <SectionHeader title="Danger Zone" description="Destructive actions — proceed with caution" />
                    <div className="border border-red-500/25 rounded-sm overflow-hidden">
                        <div className="flex items-start justify-between gap-6 px-5 py-5">
                            <div>
                                <p className="text-sm font-medium text-fg">Reset course data</p>
                                <p className="text-xs text-secondary mt-1 leading-relaxed">
                                    Permanently delete all grades, absences, sessions, and attendance records for this course.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowConfirm(true)}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-red-500/30 text-red-500 text-xs font-medium rounded-sm hover:bg-red-500/10 transition-colors cursor-pointer whitespace-nowrap"
                            >
                                <RotateCcw size={12} />
                                Reset data
                            </button>
                        </div>
                    </div>
                </section>

            </div>
        </>
    )
}
