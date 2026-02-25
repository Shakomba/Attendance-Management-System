import { cn } from '../../lib/utils'

export function DashboardLayout({ children, header }) {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans selection:bg-primary/30">
            <div className="relative z-10 flex flex-col min-h-screen mx-auto max-w-[1500px] p-4 lg:p-6 gap-6">
                {header && (
                    <header className={cn(
                        "sticky top-4 z-40 p-5 standard-card shadow-md animate-fade-in"
                    )}>
                        {header}
                    </header>
                )}

                <main className="flex-1 flex flex-col gap-6 animate-slide-up">
                    {children}
                </main>
            </div>
        </div>
    )
}
