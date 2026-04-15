import { useEffect, useRef, useState } from 'react'
import { Sun, Moon, Globe, Mail, RotateCcw, AlertTriangle, Loader2, Download, Upload, CheckCircle2, Fingerprint, Trash2, Plus } from 'lucide-react'

const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'ckb', label: 'کوردی (Central Kurdish)' },
]

function SettingRow({ icon: Icon, label, description, children }) {
    return (
        <div className="flex items-center justify-between gap-4 py-4 border-b border-border last:border-0">
            <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 text-secondary shrink-0">
                    <Icon size={16} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{label}</p>
                    {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
                </div>
            </div>
            <div className="shrink-0">{children}</div>
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
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 cursor-pointer focus:outline-none ${
                checked ? 'bg-fg' : 'bg-border'
            }`}
        >
            <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-bg transition-transform duration-200 ${
                    checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
            />
        </button>
    )
}

function ConfirmDialog({ onConfirm, onCancel, busy }) {
    const [exportFirst, setExportFirst] = useState(true)
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg border border-border shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-fg">Reset all data?</p>
                        <p className="text-xs text-secondary mt-1 leading-relaxed">
                            This will permanently zero all grades and absence hours, and delete all session and attendance history for this course. This cannot be undone.
                        </p>
                    </div>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={exportFirst}
                        onChange={e => setExportFirst(e.target.checked)}
                        className="w-3.5 h-3.5 accent-fg cursor-pointer"
                    />
                    <span className="text-xs text-secondary">Export grades as CSV before resetting</span>
                </label>
                <div className="flex justify-end gap-2 pt-1">
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-medium border border-border text-secondary hover:text-fg hover:bg-surface rounded-sm transition-colors cursor-pointer disabled:opacity-40"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(exportFirst)}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-medium bg-red-500 text-white hover:bg-red-600 rounded-sm transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                    >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                        {busy ? 'Resetting…' : 'Yes, reset everything'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export function SettingsTab({ theme, onToggleTheme, language, onChangeLanguage, sendEmailsOnFinalize, onToggleSendEmails, apiFetch, courseId, onReset }) {
    const [showConfirm, setShowConfirm] = useState(false)
    const [resetting, setResetting] = useState(false)

    // Passkeys
    const [passkeys, setPasskeys] = useState([])
    const [passkeySupported, setPasskeySupported] = useState(false)
    const [registeringPasskey, setRegisteringPasskey] = useState(false)
    const [deletingPasskey, setDeletingPasskey] = useState(null)
    const [passkeyDeviceName, setPasskeyDeviceName] = useState('')

    useEffect(() => {
        setPasskeySupported(!!window.PublicKeyCredential)
        loadPasskeys()
    }, [])

    const loadPasskeys = async () => {
        try {
            const data = await apiFetch('/api/auth/webauthn/credentials')
            setPasskeys(data.items || [])
        } catch { /* ignore */ }
    }

    const b64urlToBuffer = (b64url) => {
        const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
        const bin = atob(base64)
        return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer
    }
    const bufferToB64url = (buffer) => {
        const bytes = new Uint8Array(buffer)
        let bin = ''
        bytes.forEach(b => (bin += String.fromCharCode(b)))
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    }

    const handleRegisterPasskey = async () => {
        setRegisteringPasskey(true)
        try {
            // 1. Get registration options
            const beginData = await apiFetch('/api/auth/webauthn/register/begin', { method: 'POST' })
            const opts = beginData.options
            opts.challenge = b64urlToBuffer(opts.challenge)
            opts.user.id = b64urlToBuffer(opts.user.id)
            if (opts.excludeCredentials) {
                opts.excludeCredentials = opts.excludeCredentials.map(c => ({ ...c, id: b64urlToBuffer(c.id) }))
            }

            // 2. Prompt browser
            const credential = await navigator.credentials.create({ publicKey: opts })

            // 3. Encode and complete
            const credJson = {
                id: credential.id,
                rawId: bufferToB64url(credential.rawId),
                type: credential.type,
                response: {
                    clientDataJSON: bufferToB64url(credential.response.clientDataJSON),
                    attestationObject: bufferToB64url(credential.response.attestationObject),
                },
            }
            await apiFetch('/api/auth/webauthn/register/complete', {
                method: 'POST',
                body: JSON.stringify({
                    session_id: beginData.session_id,
                    credential: credJson,
                    device_name: passkeyDeviceName.trim() || navigator.platform || 'This device',
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

    // Export
    const [exporting, setExporting] = useState(false)

    const handleExport = async () => {
        setExporting(true)
        try {
            const res = await apiFetch(`/api/courses/${courseId}/gradebook/export`, { _raw: true })
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `gradebook_course_${courseId}.csv`
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Export failed:', err.message)
        } finally {
            setExporting(false)
        }
    }

    // Import
    const fileInputRef = useRef(null)
    const [importing, setImporting] = useState(false)
    const [importResult, setImportResult] = useState(null)  // { updated, errors }

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
            onReset?.()  // refresh gradebook
        } catch (err) {
            setImportResult({ updated: 0, errors: [err.message] })
        } finally {
            setImporting(false)
        }
    }

    const handleConfirmReset = async (exportFirst) => {
        setResetting(true)
        try {
            if (exportFirst) {
                const res = await apiFetch(`/api/courses/${courseId}/gradebook/export`, { _raw: true })
                const blob = await res.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `gradebook_course_${courseId}.csv`
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

    return (
        <>
            {showConfirm && (
                <ConfirmDialog
                    onConfirm={handleConfirmReset}
                    onCancel={() => setShowConfirm(false)}
                    busy={resetting}
                />
            )}

            <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-300 max-w-2xl">
                <div>
                    <h2 className="text-base font-semibold text-fg">Settings</h2>
                    <p className="text-xs text-secondary mt-0.5">Manage your preferences</p>
                </div>

                <div className="standard-card px-5">
                    <p className="text-[11px] uppercase tracking-wider text-secondary font-medium pt-4 pb-2">Appearance</p>

                    <SettingRow
                        icon={theme === 'dark' ? Moon : Sun}
                        label="Theme"
                        description="Switch between light and dark interface"
                    >
                        <button
                            type="button"
                            onClick={onToggleTheme}
                            className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-sm text-xs font-medium text-secondary hover:text-fg hover:bg-surface transition-colors cursor-pointer"
                        >
                            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                        </button>
                    </SettingRow>

                    <SettingRow
                        icon={Globe}
                        label="Language"
                        description="Interface display language"
                    >
                        <select
                            value={language}
                            onChange={(e) => onChangeLanguage(e.target.value)}
                            className="text-xs bg-surface border border-border text-fg rounded-sm px-2.5 py-1.5 focus:outline-none focus:border-fg cursor-pointer"
                        >
                            {LANGUAGES.map(({ code, label }) => (
                                <option key={code} value={code}>{label}</option>
                            ))}
                        </select>
                    </SettingRow>
                </div>

                <div className="standard-card px-5">
                    <p className="text-[11px] uppercase tracking-wider text-secondary font-medium pt-4 pb-2">Notifications</p>

                    <SettingRow
                        icon={Mail}
                        label="Email absent students after session"
                        description="Automatically send absence reports to students when a lecture is ended"
                    >
                        <Toggle checked={sendEmailsOnFinalize} onChange={onToggleSendEmails} />
                    </SettingRow>
                </div>

                {passkeySupported && (
                <div className="standard-card px-5">
                    <p className="text-[11px] uppercase tracking-wider text-secondary font-medium pt-4 pb-2">Passkeys</p>

                    {passkeys.length > 0 && (
                        <div className="pb-3 space-y-2">
                            {passkeys.map((pk) => (
                                <div key={pk.credential_id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <Fingerprint size={14} className="text-secondary shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-sm text-fg truncate">{pk.device_name}</p>
                                            <p className="text-[11px] text-secondary">{new Date(pk.created_at).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleDeletePasskey(pk.credential_id)}
                                        disabled={deletingPasskey === pk.credential_id}
                                        className="shrink-0 p-1.5 text-secondary hover:text-red-500 transition-colors cursor-pointer disabled:opacity-40"
                                    >
                                        {deletingPasskey === pk.credential_id
                                            ? <Loader2 size={14} className="animate-spin" />
                                            : <Trash2 size={14} />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <SettingRow
                        icon={Plus}
                        label="Register this device"
                        description="Add a passkey so you can sign in with your fingerprint or face"
                    >
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={passkeyDeviceName}
                                onChange={e => setPasskeyDeviceName(e.target.value)}
                                placeholder="Device name (optional)"
                                className="text-xs bg-surface border border-border text-fg rounded-sm px-2.5 py-1.5 w-36 focus:outline-none focus:border-fg"
                            />
                            <button
                                type="button"
                                onClick={handleRegisterPasskey}
                                disabled={registeringPasskey}
                                className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-sm text-xs font-medium text-secondary hover:text-fg hover:bg-surface transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
                            >
                                {registeringPasskey ? <Loader2 size={13} className="animate-spin" /> : <Fingerprint size={13} />}
                                {registeringPasskey ? 'Registering…' : 'Register'}
                            </button>
                        </div>
                    </SettingRow>
                </div>
                )}

                <div className="standard-card px-5">
                    <p className="text-[11px] uppercase tracking-wider text-secondary font-medium pt-4 pb-2">Data</p>

                    <SettingRow
                        icon={Download}
                        label="Export grades"
                        description="Download all student grades as a CSV file"
                    >
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={exporting}
                            className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-sm text-xs font-medium text-secondary hover:text-fg hover:bg-surface transition-colors cursor-pointer disabled:opacity-40"
                        >
                            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                            {exporting ? 'Exporting…' : 'Export CSV'}
                        </button>
                    </SettingRow>

                    <SettingRow
                        icon={Upload}
                        label="Import grades"
                        description="Upload a CSV to bulk-update grades (must match the exported format)"
                    >
                        <div className="flex flex-col items-end gap-1.5">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={handleImport}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={importing}
                                className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-sm text-xs font-medium text-secondary hover:text-fg hover:bg-surface transition-colors cursor-pointer disabled:opacity-40"
                            >
                                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                                {importing ? 'Importing…' : 'Import CSV'}
                            </button>
                            {importResult && (
                                <div className="text-right">
                                    <p className={`text-[11px] flex items-center gap-1 ${importResult.errors?.length ? 'text-amber-500' : 'text-green-500'}`}>
                                        <CheckCircle2 size={11} />
                                        {importResult.updated} student{importResult.updated !== 1 ? 's' : ''} updated
                                    </p>
                                    {importResult.errors?.map((e, i) => (
                                        <p key={i} className="text-[11px] text-red-500 mt-0.5">{e}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </SettingRow>
                </div>

                <div className="standard-card px-5">
                    <p className="text-[11px] uppercase tracking-wider text-secondary font-medium pt-4 pb-2">Danger Zone</p>

                    <SettingRow
                        icon={RotateCcw}
                        label="Reset course data"
                        description="Zero all grades and delete all session & attendance history for this course"
                    >
                        <button
                            type="button"
                            onClick={() => setShowConfirm(true)}
                            className="flex items-center gap-2 px-3 py-1.5 border border-red-500/40 rounded-sm text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                            <RotateCcw size={13} />
                            Reset
                        </button>
                    </SettingRow>
                </div>
            </div>
        </>
    )
}
