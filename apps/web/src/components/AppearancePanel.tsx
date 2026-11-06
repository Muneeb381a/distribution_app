'use client';

import { Icon } from '@/components/Icon';
import { ACCENTS, CARDS, SIDES, TABS, resetLook, setLook, useLook } from '@/lib/appearance';
import { setTheme, useTheme, type ThemePref } from '@/lib/theme';

const MODES: [ThemePref, string, 'monitor' | 'sun' | 'moon'][] = [['system', 'Follow device', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']];

/** Settings → Appearance: every change applies instantly and is kept on this computer. */
export default function AppearancePanel() {
  const look = useLook();
  const mode = useTheme();
  const sameHex = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

  return (
    <div className="look-grid">
      <section className="card">
        <div className="card-head"><h2>Mode</h2></div>
        <div className="seg" role="radiogroup" aria-label="Light or dark">
          {MODES.map(([v, label, icon]) => (
            <button key={v} type="button" role="radio" aria-checked={mode === v} className={mode === v ? 'on' : ''} onClick={() => setTheme(v)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        </div>
        <p className="muted look-note">The page behind everything stays pure white in light mode.</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>Accent colour</h2><span className="muted look-note">Buttons, links, highlights</span></div>
        <div className="swatches" role="radiogroup" aria-label="Accent colour">
          <button type="button" role="radio" aria-checked={!look.accent} title="Default teal" className={`swatch${!look.accent ? ' on' : ''}`} style={{ background: '#0f766e' }} onClick={() => setLook({ accent: null })}>
            {!look.accent && <Icon name="check" />}
          </button>
          {ACCENTS.slice(1).map((c) => (
            <button key={c.hex} type="button" role="radio" aria-checked={sameHex(look.accent, c.hex)} title={c.name} className={`swatch${sameHex(look.accent, c.hex) ? ' on' : ''}`} style={{ background: c.hex }} onClick={() => setLook({ accent: c.hex })}>
              {sameHex(look.accent, c.hex) && <Icon name="check" />}
            </button>
          ))}
          <label className="swatch custom" title="Pick any colour">
            <input type="color" aria-label="Custom accent colour" value={look.accent ?? '#0f766e'} onChange={(e) => setLook({ accent: e.target.value })} />
            <Icon name="plus" />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Sidebar colour</h2><span className="muted look-note">The menu on the left</span></div>
        <div className="swatches" role="radiogroup" aria-label="Sidebar colour">
          <button type="button" role="radio" aria-checked={!look.side} title="Clean (default)" className={`swatch side${!look.side ? ' on' : ''}`} style={{ '--c': '#ffffff' } as React.CSSProperties} onClick={() => setLook({ side: null })}>
            {!look.side && <Icon name="check" />}
          </button>
          {SIDES.map((c) => (
            <button key={c.hex} type="button" role="radio" aria-checked={sameHex(look.side, c.hex)} title={c.name} className={`swatch side${sameHex(look.side, c.hex) ? ' on' : ''}`} style={{ '--c': c.hex } as React.CSSProperties} onClick={() => setLook({ side: c.hex })}>
              {sameHex(look.side, c.hex) && <Icon name="check" />}
            </button>
          ))}
          <label className="swatch side custom" title="Pick any colour">
            <input type="color" aria-label="Custom sidebar colour" value={look.side ?? SIDES[0].hex} onChange={(e) => setLook({ side: e.target.value })} />
            <Icon name="plus" />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Card style</h2><span className="muted look-note">Panels, tiles and forms</span></div>
        <div className="tiles" role="radiogroup" aria-label="Card style">
          {CARDS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={look.card === c.id} className={`look-tile${look.card === c.id ? ' on' : ''}`} onClick={() => setLook({ card: c.id })}>
              <span className="mini-stage"><span className="mini-card" data-kind={c.id}><i /><i /></span></span>
              <b>{c.name}</b><span>{c.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Tab style</h2><span className="muted look-note">Switching between views on a page</span></div>
        <div className="tiles" role="radiogroup" aria-label="Tab style">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={look.tabs === t.id} className={`look-tile${look.tabs === t.id ? ' on' : ''}`} onClick={() => setLook({ tabs: t.id })}>
              <span className="mini-stage"><span className="mini-tabs" data-kind={t.id}><i className="on" /><i /><i /></span></span>
              <b>{t.name}</b><span>{t.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="actions">
        <button type="button" className="secondary" onClick={resetLook}><Icon name="refresh" />Back to the default look</button>
        <span className="muted look-note">Saved on this computer only.</span>
      </div>
    </div>
  );
}
