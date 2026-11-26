// A small animated-N badge that sits next to the title on NEON-official shows
// (jimmy, 2026-11-26). Set is_official on a show to turn it on.

export default function OfficialBadge({
  size = 28,
  label = "NEON official",
}: {
  size?: number;
  label?: string;
}) {
  return (
    <picture
      className="official-badge"
      style={{ width: size, height: size, marginRight: 8 }}
    >
      <source media="(prefers-reduced-motion: reduce)" srcSet="/neon-official-still.png" />
      <img
        src="/neon-official.gif"
        alt={label}
        title={label === "NEON official" ? "NEON official show" : label}
        width={size}
        height={size}
      />
    </picture>
  );
}
