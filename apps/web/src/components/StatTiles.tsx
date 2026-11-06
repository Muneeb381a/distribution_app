import { Icon, type IconName } from '@/components/Icon';

export interface Tile { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: IconName; tone?: 'green' | 'red' | 'amber' }

/** The row of summary tiles at the top of a list page (same look as the Stock page). */
export function StatTiles({ items }: { items: Tile[] }) {
  return (
    <div className="stats">
      {items.map((t) => (
        <div className="stat" key={t.label}>
          <span className="label"><span className={`icon${t.tone ? ` ${t.tone}` : ''}`}><Icon name={t.icon} /></span>{t.label}</span>
          <span className="value">{t.value}</span>
          {t.sub && <span className="sub">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}
