import { Users, UserCheck, UserX } from 'lucide-react'

export function StatCards({ stats = [] }) {
    const icons = { default: Users, primary: UserCheck, warning: UserCheck, danger: UserX }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {stats.map((s, i) => {
                const Icon = icons[s.variant] || Users
                return (
                    <div key={i} className="standard-card p-5 flex items-center gap-4">
                        <div className="w-12 h-12 flex items-center justify-center shrink-0 bg-surface border border-border">
                            <Icon size={22} className="text-secondary" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-semibold text-secondary uppercase tracking-widest mb-0.5">
                                {s.label}
                            </p>
                            <p className="text-3xl font-bold font-display tracking-tight leading-none text-fg">
                                {s.value}
                            </p>
                            {s.hint && (
                                <p className="text-[10px] text-secondary mt-1 truncate opacity-60">{s.hint}</p>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
