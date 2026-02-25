import { cn } from '../../lib/utils'
import { Users, UserCheck, AlertCircle, Clock } from 'lucide-react'

export function StatCard({ label, value, hint, delay = 0, variant = "default", icon: Icon }) {
    const variants = {
        default: "border-t-blue-500",
        primary: "border-t-emerald-500",
        warning: "border-t-amber-500",
        danger: "border-t-rose-500"
    }

    const iconColors = {
        default: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
        primary: "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20",
        warning: "text-amber-500 bg-amber-50 dark:bg-amber-900/20",
        danger: "text-rose-500 bg-rose-50 dark:bg-rose-900/20"
    }

    return (
        <article
            className={cn(
                "standard-card p-5 border-t-4 flex flex-col gap-3 animate-fade-in transition-all hover:shadow-md",
                variants[variant]
            )}
            style={{ animationDelay: `${delay}ms` }}
        >
            <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {label}
                </p>
                <div className={cn("p-2 rounded-lg", iconColors[variant])}>
                    {Icon && <Icon className="w-5 h-5" />}
                </div>
            </div>

            <div className="flex items-baseline gap-2 mt-1">
                <p className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {value}
                </p>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-auto">
                {hint}
            </p>
        </article>
    )
}

export function StatCards({ stats }) {
    const defaultIcons = [Users, UserCheck, Clock, AlertCircle]

    return (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-slide-up">
            {stats.map((stat, i) => (
                <StatCard
                    key={stat.label}
                    {...stat}
                    icon={defaultIcons[i % defaultIcons.length]}
                    delay={i * 75}
                />
            ))}
        </section>
    )
}
