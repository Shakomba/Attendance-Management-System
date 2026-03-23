import { cn } from '../../lib/utils'
import { LayoutDashboard, BookOpen, Mail, UserCheck, Sun, Moon, LogOut, User, History } from 'lucide-react'

export function DashboardLayout({ children, activeTab, setActiveTab, theme, onToggleTheme, professor, onLogout, headerAction }) {
    return (
        <div className="flex min-h-screen bg-bg text-fg font-sans">
            {/* Sidebar */}
            <div className="w-16 lg:w-64 bg-bg border-r border-border h-screen flex flex-col fixed top-0 left-0 shadow-sm z-50 transition-all duration-300">
                <div className="flex items-center justify-center lg:justify-start gap-3 p-4 h-16 border-b border-border">
                    <UserCheck size={24} className="text-fg hidden lg:block" />
                    <UserCheck size={20} className="text-fg lg:hidden" />
                    <span className="font-mono font-bold text-lg hidden lg:block tracking-tight text-fg">Attendance</span>
                </div>

                <nav className="flex flex-col gap-1 p-2 lg:p-4 mt-2 flex-1">
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className={cn(
                            "flex items-center justify-center lg:justify-start gap-3 p-3 lg:px-3 lg:py-2 rounded-sm font-medium transition-colors duration-200 w-full",
                            activeTab === 'dashboard'
                                ? "bg-fg text-bg"
                                : "text-secondary hover:bg-surface hover:text-fg"
                        )}
                        title="Live Monitor"
                    >
                        <LayoutDashboard size={18} />
                        <span className="hidden lg:block text-sm">Live Monitor</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('gradebook')}
                        className={cn(
                            "flex items-center justify-center lg:justify-start gap-3 p-3 lg:px-3 lg:py-2 rounded-sm font-medium transition-colors duration-200 w-full",
                            activeTab === 'gradebook'
                                ? "bg-fg text-bg"
                                : "text-secondary hover:bg-surface hover:text-fg"
                        )}
                        title="Gradebook"
                    >
                        <BookOpen size={18} />
                        <span className="hidden lg:block text-sm">Gradebook</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('email')}
                        className={cn(
                            "flex items-center justify-center lg:justify-start gap-3 p-3 lg:px-3 lg:py-2 rounded-sm font-medium transition-colors duration-200 w-full",
                            activeTab === 'email'
                                ? "bg-fg text-bg"
                                : "text-secondary hover:bg-surface hover:text-fg"
                        )}
                        title="Email Students"
                    >
                        <Mail size={18} />
                        <span className="hidden lg:block text-sm">Email</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={cn(
                            "flex items-center justify-center lg:justify-start gap-3 p-3 lg:px-3 lg:py-2 rounded-sm font-medium transition-colors duration-200 w-full",
                            activeTab === 'history'
                                ? "bg-fg text-bg"
                                : "text-secondary hover:bg-surface hover:text-fg"
                        )}
                        title="Lecture History"
                    >
                        <History size={18} />
                        <span className="hidden lg:block text-sm">History</span>
                    </button>

                    <div className="mt-auto pt-4 border-t border-border space-y-1">
                        <button
                            type="button"
                            onClick={() => onToggleTheme?.()}
                            className="flex items-center justify-center lg:justify-start gap-3 p-3 lg:px-3 lg:py-2 rounded-sm font-medium transition-colors duration-200 w-full text-secondary hover:bg-surface hover:text-fg"
                            title="Toggle Theme"
                        >
                            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                            <span className="hidden lg:block text-sm">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                        </button>
                        {onLogout && (
                            <button
                                onClick={onLogout}
                                className="flex items-center justify-center lg:justify-start gap-3 p-3 lg:px-3 lg:py-2 rounded-sm font-medium transition-colors duration-200 w-full text-secondary hover:bg-surface hover:text-red-500"
                                title="Sign Out"
                            >
                                <LogOut size={18} />
                                <span className="hidden lg:block text-sm">Sign Out</span>
                            </button>
                        )}
                    </div>
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 ml-16 lg:ml-64 flex flex-col min-h-screen transition-all duration-300">
                {/* Top Header Bar */}
                {professor && (
                    <header className="h-14 border-b border-border bg-bg flex items-center justify-between px-4 lg:px-8 sticky top-0 z-40">
                        <div className="flex items-center gap-2.5">
                            <span className="font-medium text-fg text-sm">{professor.course_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            {headerAction}
                            <div className="flex items-center gap-2.5 text-secondary">
                                <User size={15} />
                                <span className="text-sm font-medium hidden sm:inline">{professor.full_name}</span>
                            </div>
                        </div>
                    </header>
                )}

                <main className="flex-1 p-4 lg:p-8 animate-fade-in flex flex-col gap-6">
                    {children}
                </main>
            </div>
        </div>
    )
}
