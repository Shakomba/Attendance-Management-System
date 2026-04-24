import { cn } from '../../lib/utils'
import { LayoutDashboard, BookOpen, Mail, UserCheck, ScanFace, LogOut, History, Settings } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { tName } from '../../lib/nameTranslation';

const NAV_TABS = [
    { id: 'dashboard',  icon: LayoutDashboard, labelKey: 'tab_dashboard'  },
    { id: 'enrollment', icon: ScanFace,        labelKey: 'tab_enrollment' },
    { id: 'gradebook',  icon: BookOpen,        labelKey: 'tab_gradebook'  },
    { id: 'email',      icon: Mail,            labelKey: 'tab_email'      },
    { id: 'history',    icon: History,         labelKey: 'tab_history'    },
]

export function DashboardLayout({ children, activeTab, setActiveTab, professor, onLogout, headerAction, navigationLocked = false }) {
    const { t, language } = useTranslation()
    return (
        <div className="flex min-h-screen bg-bg text-fg font-sans">

            {/* ── Sidebar (desktop) ───────────────────────────────────────── */}
            <div className="hidden lg:flex w-64 bg-bg border-e border-border h-screen flex-col fixed top-0 start-0 shadow-sm z-50">
                <div className="flex items-center gap-3 px-4 h-14 border-b border-border" dir="ltr">
                    <UserCheck size={22} className="text-fg" />
                    <span className="font-mono font-bold text-lg tracking-tight text-fg">{t('app_title')}</span>
                </div>

                <nav className="flex flex-col gap-1 p-4 mt-2 flex-1">
                    {NAV_TABS.map(({ id, icon: Icon, labelKey }) => (
                        <button
                            key={id}
                            disabled={navigationLocked}
                            onClick={() => setActiveTab(id)}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2 rounded-sm font-medium transition-colors duration-150 w-full text-start',
                                navigationLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                                activeTab === id
                                    ? 'bg-fg text-bg'
                                    : 'text-secondary hover:bg-surface hover:text-fg'
                            )}
                        >
                            <Icon size={18} />
                            <span className="text-sm">{t(labelKey)}</span>
                        </button>
                    ))}

                    <div className="mt-auto pt-4 border-t border-border space-y-1">
                        <button
                            disabled={navigationLocked}
                            onClick={() => setActiveTab('settings')}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2 rounded-sm font-medium transition-colors duration-150 w-full text-start',
                                navigationLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                                activeTab === 'settings'
                                    ? 'bg-fg text-bg'
                                    : 'text-secondary hover:bg-surface hover:text-fg'
                            )}
                        >
                            <Settings size={18} />
                            <span className="text-sm">{t('tab_settings')}</span>
                        </button>
                        {onLogout && (
                            <button
                                disabled={navigationLocked}
                                onClick={onLogout}
                                className={cn(
                                    'flex items-center gap-3 px-3 py-2 rounded-sm font-medium transition-colors duration-150 w-full',
                                    navigationLocked
                                        ? 'opacity-50 cursor-not-allowed text-secondary'
                                        : 'text-secondary hover:bg-surface hover:text-red-500 cursor-pointer'
                                )}
                            >
                                <LogOut size={18} />
                                <span className="text-sm">{t('btn_signout')}</span>
                            </button>
                        )}
                    </div>
                </nav>
            </div>

            {/* ── Main content ────────────────────────────────────────────── */}
            <div className="flex-1 lg:ms-64 flex flex-col min-h-screen">
                {professor && (
                    <header className="h-14 border-b border-border bg-bg flex items-center justify-between px-3 sm:px-4 lg:px-8 fixed top-0 start-0 end-0 lg:start-64 z-40">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-fg text-xs sm:text-sm truncate max-w-[120px] sm:max-w-xs">
                                {tName(professor.course_name, language)}
                            </span>
                            <span className="hidden sm:block text-secondary text-xs">|</span>
                            <span className="hidden sm:block font-medium text-fg text-xs sm:text-sm truncate">
                                {tName(professor.full_name, language)}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-4">
                            {headerAction}
                            <div className="flex items-center lg:hidden">
                                <button
                                    disabled={navigationLocked}
                                    onClick={() => setActiveTab('settings')}
                                    className={cn(
                                        'p-2 transition-colors',
                                        navigationLocked ? 'opacity-50 cursor-not-allowed text-secondary' : 'text-secondary hover:text-fg cursor-pointer'
                                    )}
                                >
                                    <Settings size={16} />
                                </button>
                                {onLogout && (
                                    <button
                                        disabled={navigationLocked}
                                        onClick={onLogout}
                                        className={cn(
                                            'p-2 transition-colors',
                                            navigationLocked ? 'opacity-50 cursor-not-allowed text-secondary' : 'text-secondary hover:text-red-500 cursor-pointer'
                                        )}
                                    >
                                        <LogOut size={16} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </header>
                )}

                <div className="h-14 shrink-0" />
                <main className="flex-1 p-3 sm:p-4 lg:p-8 pb-24 lg:pb-8 animate-fade-in flex flex-col gap-4 sm:gap-6">
                    {children}
                </main>
            </div>

            {/* ── Bottom nav (mobile) ──────────────────────────────────────── */}
            <nav
                className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-bg border-t border-border flex items-stretch h-16"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                {NAV_TABS.map(({ id, icon: Icon, labelKey }) => (
                    <button
                        key={id}
                        disabled={navigationLocked}
                        onClick={() => setActiveTab(id)}
                        className={cn(
                            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors duration-150 relative',
                            navigationLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            activeTab === id ? 'text-primary' : 'text-secondary'
                        )}
                    >
                        {activeTab === id && (
                            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
                        )}
                        <Icon size={20} strokeWidth={activeTab === id ? 2.5 : 1.75} />
                        <span>{t(labelKey)}</span>
                    </button>
                ))}
            </nav>
        </div>
    )
}
