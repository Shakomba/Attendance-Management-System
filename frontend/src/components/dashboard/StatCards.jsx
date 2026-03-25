export function StatCards({ stats = [] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <div key={i} className="stat-card relative overflow-hidden group">
          <p className="text-xs font-medium text-secondary mb-2 tracking-wide uppercase">
            {s.label || s.title}
          </p>
          <div className="flex items-baseline gap-2">
            <span className={`text-4xl font-bold font-mono tracking-tight ${s.variant === 'primary' ? 'text-primary' : 'text-fg'}`}>
              {s.value}
            </span>
          </div>
          {s.hint && (
            <p className="text-[10px] text-secondary/60 mt-2 font-mono uppercase tracking-wider">
              {s.hint}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
