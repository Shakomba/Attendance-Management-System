import { cn } from '../../lib/utils'
import { LayoutDashboard, BookOpen, Mail, UserCheck, ScanFace, LogOut, User, History, Settings } from 'lucide-react'

const NAV_TABS = [
    { id: 'dashboard',  icon: LayoutDashboard, label: 'Monitor',    title: 'Live Monitor' },
    { id: 'enrollment', icon: ScanFace,        label: 'Enrollment', title: 'Face Enrollment' },
    { id: 'gradebook',  icon: BookOpen,        label: 'Grades',     title: 'Gradebook' },
    { id: 'email',      icon: Mail,            label: 'Email',      title: 'Email Students' },
    { id: 'history',    icon: History,         label: 'History',    title: 'Lecture History' },
]

export function DashboardLayout({ children, activeTab, setActiveTab, professor, onLogout, headerAction }) {
    return (
        <div className="flex min-h-screen bg-bg text-fg font-sans">

            {/* ── Sidebar (lg+) ──────────────────────────────────────────── */}
            <div className="hidden lg:flex w-64 bg-bg border-r border-border h-screen flex-col fixed top-0 left-0 shadow-sm z-50">
                <div className="flex items-center justify-start gap-3 px-4 h-14 border-b border-border">
                    <UserCheck size={24} className="text-fg" />
                    <span className="font-mono font-bold text-lg tracking-tight text-fg">Attendance</span>
                </div>

                <nav className="flex flex-col gap-1 p-4 mt-2 flex-1">
                    {NAV_TABS.map(({ id, icon: Icon, label, title }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={cn(
                                "flex items-center justify-start gap-3 px-3 py-2 rounded-sm font-medium transition-colors duration-200 w-full cursor-pointer",
                                activeTab === id
                                    ? "bg-fg text-bg"
                                    : "text-secondary hover:bg-surface hover:text-fg"
                            )}
                            title={title}
                        >
                            <Icon size={18} />
                            <span className="text-sm">{label === 'Monitor' ? 'Live Monitor' : label}</span>
                        </button>
                    ))}

                    <div className="mt-auto pt-4 border-t border-border space-y-1">
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={cn(
                                "flex items-center justify-start gap-3 px-3 py-2 rounded-sm font-medium transition-colors duration-200 w-full cursor-pointer",
                                activeTab === 'settings'
                                    ? "bg-fg text-bg"
                                    : "text-secondary hover:bg-surface hover:text-fg"
                            )}
                            title="Settings"
                        >
                            <Settings size={18} />
                            <span className="text-sm">Settings</span>
                        </button>
                        {onLogout && (
                            <button
                                onClick={onLogout}
                                className="flex items-center justify-start gap-3 px-3 py-2 rounded-sm font-medium transition-colors duration-200 w-full text-secondary hover:bg-surface hover:text-red-500 cursor-pointer"
                                title="Sign Out"
                            >
                                <LogOut size={18} />
                                <span className="text-sm">Sign Out</span>
                            </button>
                        )}
                    </div>
                </nav>
            </div>

            {/* ── Main Content ───────────────────────────────────────────── */}
            <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">

                {/* Top Header Bar */}
                {professor && (
                    <header className="h-14 border-b border-border bg-bg flex items-center justify-between px-3 sm:px-4 lg:px-8 fixed top-0 left-0 right-0 lg:left-64 z-40">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-fg text-xs sm:text-sm truncate max-w-[120px] sm:max-w-xs">{professor.course_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-4">
                            {headerAction}
                            {/* Settings + logout — mobile only (sidebar handles these on desktop) */}
                            <div className="flex items-center lg:hidden">
                                <button
                                    onClick={() => setActiveTab('settings')}
                                    className="p-2 text-secondary hover:text-fg transition-colors cursor-pointer"
                                    title="Settings"
                                >
                                    <Settings size={16} />
                                </button>
                                {onLogout && (
                                    <button
                                        onClick={onLogout}
                                        className="p-2 text-secondary hover:text-red-500 transition-colors cursor-pointer"
                                        title="Sign Out"
                                    >
                                        <LogOut size={16} />
                                    </button>
                                )}
                            </div>
                            <div className="hidden sm:flex items-center gap-2.5 text-secondary">
                                <User size={15} />
                                <span className="text-sm font-medium hidden sm:inline">{professor.full_name}</span>
                            </div>
                        </div>
                    </header>
                )}

                {/* Page content — extra bottom padding on mobile to clear bottom nav */}
                <div className="h-14 shrink-0" /> {/* spacer for fixed header */}
                <main className="flex-1 p-3 sm:p-4 lg:p-8 pb-24 lg:pb-8 animate-fade-in flex flex-col gap-4 sm:gap-6">
                    {children}
                </main>
            </div>

            {/* ── Bottom Navigation (mobile only) ───────────────────────── */}
            <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-bg border-t border-border flex items-stretch h-16"
                 style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {NAV_TABS.map(({ id, icon: Icon, label }) => (
                    <button
                        key={id}
                        onClick={() => setActiveTab(id)}
                        className={cn(
                            "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors duration-150 cursor-pointer relative",
                            activeTab === id ? "text-primary" : "text-secondary"
                        )}
                    >
                        {activeTab === id && (
                            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
                        )}
                        <Icon size={20} strokeWidth={activeTab === id ? 2.5 : 1.75} />
                        <span>{label}</span>
                    </button>
                ))}
            </nav>
        </div>
    )
}
