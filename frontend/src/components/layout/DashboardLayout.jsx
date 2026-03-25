import { cn } from '../../lib/utils'
import { LayoutDashboard, BookOpen, Mail, UserCheck, Sun, Moon, LogOut, User, History } from 'lucide-react'

const NAV_ITEMS = [
    { id: 'dashboard', label: 'Live Monitor', icon: LayoutDashboard },
    { id: 'gradebook', label: 'Gradebook',    icon: BookOpen },
    { id: 'email',     label: 'Email',         icon: Mail },
    { id: 'history',   label: 'History',       icon: History },
]

export function DashboardLayout({ children, activeTab, setActiveTab, theme, onToggleTheme, professor, onLogout, headerAction }) {
    return (
        <div className="flex min-h-screen bg-bg text-fg font-sans">

            {/* ── Sidebar ─────────────────────────────────────────────── */}
            <aside className="w-16 lg:w-64 bg-card border-r border-border h-screen flex flex-col fixed top-0 left-0 z-50 shadow-sm">

                {/* Brand */}
                <div className="flex items-center justify-center lg:justify-start gap-3 px-4 h-16 border-b border-border shrink-0">
                    <div className="w-8 h-8 bg-primary flex items-center justify-center shrink-0">
                        <UserCheck size={16} className="text-primary-fg" />
                    </div>
                    <span className="font-display font-bold text-base hidden lg:block text-fg tracking-tight">
                        Attendance<span className="text-primary opacity-60">AI</span>
                    </span>
                </div>

                {/* Nav */}
                <nav className="flex flex-col gap-0.5 p-2 lg:p-3 mt-2 flex-1 overflow-y-auto">
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={cn(
                                'flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 font-medium transition-all duration-150 w-full text-sm cursor-pointer',
                                activeTab === id
                                    ? 'bg-primary text-primary-fg'
                                    : 'text-secondary hover:bg-surface hover:text-fg'
                            )}
                            title={label}
                            aria-label={label}
                        >
                            <Icon size={17} className="shrink-0" />
                            <span className="hidden lg:block">{label}</span>
                        </button>
                    ))}
                </nav>

                {/* Footer */}
                <div className="p-2 lg:p-3 border-t border-border space-y-0.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => onToggleTheme?.()}
                        className="flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 text-sm font-medium transition-all duration-150 w-full text-secondary hover:bg-surface hover:text-fg cursor-pointer"
                        title="Toggle Theme"
                        aria-label="Toggle Theme"
                    >
                        {theme === 'dark'
                            ? <Sun size={17} className="shrink-0" />
                            : <Moon size={17} className="shrink-0" />}
                        <span className="hidden lg:block">
                            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                        </span>
                    </button>

                    {onLogout && (
                        <button
                            onClick={onLogout}
                            className="flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 text-sm font-medium transition-all duration-150 w-full text-secondary hover:bg-surface hover:text-fg cursor-pointer"
                            title="Sign Out"
                            aria-label="Sign Out"
                        >
                            <LogOut size={17} className="shrink-0" />
                            <span className="hidden lg:block">Sign Out</span>
                        </button>
                    )}
                </div>
            </aside>

            {/* ── Main content ────────────────────────────────────────── */}
            <div className="flex-1 ml-16 lg:ml-64 flex flex-col min-h-screen">

                {/* Top header */}
                {professor && (
                    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 lg:px-8 sticky top-0 z-40 shadow-sm">
                        <div className="flex items-center gap-2.5">
                            <span className="font-semibold text-fg text-sm">{professor.course_name}</span>
                            {professor.course_code && (
                                <span className="hidden sm:inline text-xs font-mono px-2 py-0.5 bg-surface text-secondary font-medium border border-border">
                                    {professor.course_code}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            {headerAction}
                            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border">
                                <div className="w-7 h-7 bg-surface border border-border flex items-center justify-center">
                                    <User size={13} className="text-secondary" />
                                </div>
                                <span className="text-sm font-medium text-fg">{professor.full_name}</span>
                            </div>
                        </div>
                    </header>
                )}

                <main className="flex-1 p-4 lg:p-6 animate-fade-in flex flex-col gap-5">
                    {children}
                </main>
            </div>
        </div>
    )
}
