import { useEffect, useRef, useState } from 'react'
import {
    Sun, Moon, RotateCcw, AlertTriangle, Loader2,
    Download, Upload, CheckCircle2, Fingerprint, Trash2, Plus,
    Lock, ChevronDown, ChevronUp, Mail, Check,
} from 'lucide-react'
import { useTranslation } from '../lib/i18n'

const LANGUAGES = [
    { code: 'en',  native: 'English' },
    { code: 'ckb', native: 'کوردی'   },
]

/* ── Language Picker ─────────────────────────────────────────────────── */

function LanguagePicker({ value, onChange }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const current = LANGUAGES.find(l => l.code === value) || LANGUAGES[0]

    return (
        <div className="relative shrink-0" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="ui-input flex items-center gap-2 text-xs cursor-pointer pr-2"
            >
                <span dir="auto">{current.native}</span>
                <ChevronDown size={12} className={`text-secondary transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute end-0 top-full mt-1 bg-bg border border-border shadow-lg z-50 overflow-hidden min-w-full">
                    {LANGUAGES.map((lang) => (
                        <button
                            key={lang.code}
                            type="button"
                            onClick={() => { onChange(lang.code); setOpen(false) }}
                            className={`w-full flex items-center justify-between gap-4 px-3 py-2 text-start text-xs cursor-pointer transition-colors ${
                                lang.code === value ? 'bg-fg text-bg' : 'hover:bg-surface text-fg'
                            }`}
                        >
                            <span dir="auto">{lang.native}</span>
                            {lang.code === value && <Check size={11} className="shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

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

function ConfirmDialog({ onConfirm, onCancel, busy, t }) {
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
                            <p className="text-sm font-semibold text-fg">{t('settings_confirm_reset')}</p>
                            <p className="text-xs text-secondary mt-1 leading-relaxed">
                                {t('settings_confirm_desc')}
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
                        <span className="text-xs text-secondary">{t('settings_confirm_dl')}</span>
                    </label>
                </div>
                <div className="border-t border-border px-5 py-3 flex justify-end gap-2 bg-surface">
                    <button onClick={onCancel} disabled={busy} className="btn-secondary text-xs px-4 py-2">
                        {t('btn_cancel')}
                    </button>
                    <button
                        onClick={() => onConfirm(exportFirst)}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-red-500 text-white hover:bg-red-600 rounded-sm transition-colors cursor-pointer disabled:opacity-40 min-w-[126px] justify-center"
                    >
                        {busy && <Loader2 size={12} className="animate-spin" />}
                        {busy ? t('settings_btn_resetting') : t('settings_btn_reset')}
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
    const { t } = useTranslation()
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
            setProfileError(t('settings_password_mismatch'))
            return
        }
        if (profileDraft.new_password && !profileDraft.current_password) {
            setProfileError(t('settings_password_current_req'))
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
            setProfileError(err.message || t('settings_save_failed'))
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
                    t={t}
                />
            )}

            <input ref={fileInputRef} type="file" accept=".zip,.csv" className="hidden" onChange={handleImport} />

            <div className="max-w-2xl space-y-8 animate-fade-in">

                {/* ══ PROFILE ══════════════════════════════════════════ */}
                <section>
                    <SectionHeader title={t('settings_profile_title')} description={t('settings_profile_desc')} />

                    <div className="standard-card overflow-hidden">
                        {/* Avatar strip */}
                        <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 bg-surface border-b border-border">
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
                        <div className="px-4 sm:px-5 py-4 sm:py-5 space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <Field label={t('settings_fullname')}>
                                    <input
                                        type="text"
                                        value={profileDraft.full_name}
                                        onChange={e => setProfileDraft(d => ({ ...d, full_name: e.target.value }))}
                                        className="ui-input w-full"
                                    />
                                </Field>
                                <Field label={t('settings_username')}>
                                    <input
                                        type="text"
                                        value={profileDraft.username}
                                        onChange={e => setProfileDraft(d => ({ ...d, username: e.target.value }))}
                                        className="ui-input w-full"
                                        autoComplete="off"
                                    />
                                </Field>
                            </div>
                            <Field label={t('settings_coursename')}>
                                <input
                                    type="text"
                                    value={profileDraft.course_name}
                                    onChange={e => setProfileDraft(d => ({ ...d, course_name: e.target.value }))}
                                    className="ui-input w-full"
                                />
                            </Field>

                            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                                <div className="text-xs min-h-[16px]">
                                    {profileError && <span className="text-red-500">{profileError}</span>}
                                    {profileSuccess && !profileError && (
                                        <span className="text-green-500 flex items-center gap-1">
                                            <CheckCircle2 size={11} /> {t('settings_saved')}
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleProfileSave}
                                    disabled={profileSaving}
                                    className="btn-primary text-xs px-4 py-2 w-full sm:w-auto"
                                >
                                    {profileSaving && <Loader2 size={12} className="animate-spin" />}
                                    {profileSaving ? t('settings_saving') : t('settings_save_changes')}
                                </button>
                            </div>
                        </div>

                        {/* Password — disclosure */}
                        <div className="border-t border-border">
                            <button
                                type="button"
                                onClick={() => setShowPasswordFields(v => !v)}
                                className="w-full flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-surface transition-colors text-start"
                            >
                                <div className="flex items-center gap-2.5">
                                    <Lock size={13} className="text-secondary" />
                                    <span className="text-sm font-medium text-fg">{t('settings_change_password')}</span>
                                </div>
                                {showPasswordFields
                                    ? <ChevronUp size={14} className="text-secondary" />
                                    : <ChevronDown size={14} className="text-secondary" />}
                            </button>

                            {showPasswordFields && (
                                <div className="border-t border-border px-5 py-5 bg-surface space-y-4">
                                    <Field label={t('settings_current_password')}>
                                        <input
                                            type="password"
                                            value={profileDraft.current_password}
                                            onChange={e => setProfileDraft(d => ({ ...d, current_password: e.target.value }))}
                                            className="ui-input w-full"
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                        />
                                    </Field>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                        <Field label={t('settings_new_password')}>
                                            <input
                                                type="password"
                                                value={profileDraft.new_password}
                                                onChange={e => setProfileDraft(d => ({ ...d, new_password: e.target.value }))}
                                                className="ui-input w-full"
                                                autoComplete="new-password"
                                                placeholder="••••••••"
                                            />
                                        </Field>
                                        <Field label={t('settings_confirm_password')}>
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
                                    <button
                                        type="button"
                                        onClick={handleProfileSave}
                                        disabled={profileSaving}
                                        className="btn-primary text-xs px-4 py-2 w-full sm:w-auto sm:self-end"
                                    >
                                        {profileSaving && <Loader2 size={12} className="animate-spin" />}
                                        {profileSaving ? t('settings_saving') : t('settings_update_password')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* ══ PASSKEYS ═════════════════════════════════════════ */}
                {passkeySupported && (
                    <section>
                        <SectionHeader
                            title={t('settings_passkey_title')}
                            description={t('settings_passkey_desc')}
                        />
                        <div className="standard-card overflow-hidden">
                            {passkeys.length === 0 ? (
                                <div className="px-5 py-4 text-xs text-secondary">
                                    {t('settings_passkey_none')}
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
                                                    <p className="text-[11px] text-secondary">{t('settings_passkey_added')} {new Date(pk.created_at).toLocaleDateString()}</p>
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

                            <div className="border-t border-border px-4 sm:px-5 py-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-surface">
                                <input
                                    type="text"
                                    value={passkeyDeviceName}
                                    onChange={e => setPasskeyDeviceName(e.target.value)}
                                    placeholder={t('settings_passkey_device')}
                                    className="ui-input flex-1 text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={handleRegisterPasskey}
                                    disabled={registeringPasskey}
                                    className="btn-secondary text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                                >
                                    {registeringPasskey
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <Plus size={12} />}
                                    {registeringPasskey ? t('settings_saving') : t('settings_passkey_add')}
                                </button>
                            </div>
                        </div>
                    </section>
                )}

                {/* ══ APPEARANCE ═══════════════════════════════════════ */}
                <section>
                    <SectionHeader title={t('settings_appearance_title')} description={t('settings_appearance_desc')} />

                    {/* Theme cards */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <button
                            type="button"
                            onClick={() => theme !== 'light' && onToggleTheme()}
                            className={`flex flex-col gap-3 p-4 rounded-sm border-2 transition-colors duration-150 cursor-pointer text-start focus:outline-none ${
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
                                    <span className="text-xs font-medium text-fg">{t('settings_theme_light')}</span>
                                </div>
                                {theme === 'light' && <CheckCircle2 size={13} className="text-fg" />}
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => theme !== 'dark' && onToggleTheme()}
                            className={`flex flex-col gap-3 p-4 rounded-sm border-2 transition-colors duration-150 cursor-pointer text-start focus:outline-none ${
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
                                    <span className="text-xs font-medium text-fg">{t('settings_theme_dark')}</span>
                                </div>
                                {theme === 'dark' && <CheckCircle2 size={13} className="text-fg" />}
                            </div>
                        </button>
                    </div>

                    {/* Language + notifications in one card */}
                    <div className="standard-card px-4 sm:px-5">
                        <div className="flex items-center justify-between gap-3 sm:gap-6 py-4 border-b border-border">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-fg">{t('settings_language')}</p>
                                <p className="text-xs text-secondary mt-0.5">{t('settings_language_desc')}</p>
                            </div>
                            <LanguagePicker value={language} onChange={onChangeLanguage} />
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:gap-6 py-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <Mail size={13} className="text-secondary shrink-0" />
                                    <p className="text-sm font-medium text-fg">{t('settings_email_pref')}</p>
                                </div>
                                <p className="text-xs text-secondary mt-0.5 ms-[22px] leading-relaxed">
                                    {t('settings_email_pref_desc')}
                                </p>
                            </div>
                            <Toggle checked={sendEmailsOnFinalize} onChange={onToggleSendEmails} />
                        </div>
                    </div>
                </section>

                {/* ══ DATA ═════════════════════════════════════════════ */}
                <section>
                    <SectionHeader title={t('settings_data_title')} description={t('settings_data_desc')} />
                    <div className="standard-card px-4 sm:px-5">
                        {/* Export */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4 border-b border-border">
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <Download size={13} className="text-secondary" />
                                    <p className="text-sm font-medium text-fg">{t('settings_export')}</p>
                                </div>
                                <p className="text-xs text-secondary mt-0.5 ms-[22px]">
                                    {t('settings_export_desc')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleExport}
                                disabled={exporting}
                                className="btn-secondary text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                {exporting ? t('settings_btn_exporting') : t('settings_btn_export')}
                            </button>
                        </div>

                        {/* Import */}
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 py-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <Upload size={13} className="text-secondary" />
                                    <p className="text-sm font-medium text-fg">{t('settings_import')}</p>
                                </div>
                                <p className="text-xs text-secondary mt-0.5 ms-[22px]">
                                    {t('settings_import_desc')}
                                </p>
                                {importResult && (
                                    <div className="mt-2 ms-[22px]">
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
                                className="btn-secondary text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                                {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                {importing ? t('settings_btn_importing') : t('settings_btn_import')}
                            </button>
                        </div>
                    </div>
                </section>

                {/* ══ DANGER ZONE ══════════════════════════════════════ */}
                <section>
                    <SectionHeader title={t('settings_danger_title')} description={t('settings_danger_desc')} />
                    <div className="border border-red-500/25 rounded-sm overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 sm:px-5 py-4 sm:py-5">
                            <div>
                                <p className="text-sm font-medium text-fg">{t('settings_reset')}</p>
                                <p className="text-xs text-secondary mt-1 leading-relaxed">
                                    {t('settings_reset_desc')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowConfirm(true)}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 border border-red-500/30 text-red-500 text-xs font-medium rounded-sm hover:bg-red-500/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                                <RotateCcw size={12} />
                                {t('settings_btn_reset')}
                            </button>
                        </div>
                    </div>
                </section>

            </div>
        </>
    )
}
