export function StatCards({ stats = [] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {stats.map((s, i) => (
        <div key={i} className="stat-card relative overflow-hidden group !p-3 sm:!p-6">
          <p className="text-[10px] sm:text-xs font-medium text-secondary mb-1 sm:mb-2 tracking-wide uppercase truncate">
            {s.label || s.title}
          </p>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl sm:text-4xl font-bold font-mono tracking-tight ${s.variant === 'primary' ? 'text-primary' : 'text-fg'}`}>
              {s.value}
            </span>
          </div>
          {s.hint && (
            <p className="text-[10px] text-secondary/60 mt-1 sm:mt-2 font-mono uppercase tracking-wider hidden sm:block">
              {s.hint}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
