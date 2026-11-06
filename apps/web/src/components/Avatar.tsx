/** A person's picture, or their initials on a colour picked from their name when they have none. */
interface Who { username: string; displayName?: string | null; avatar?: string | null }

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function initials(u: Who) {
  const words = (u.displayName || u.username).trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

export function Avatar({ user, size = 32, className = '' }: { user: Who; size?: number; className?: string }) {
  const h = hue(user.username);
  return (
    <span
      className={`pic ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: user.avatar ? undefined : `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 38%))` }}
      aria-hidden="true"
    >
      {user.avatar
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={user.avatar} alt="" width={size} height={size} draggable={false} />
        : initials(user)}
    </span>
  );
}
