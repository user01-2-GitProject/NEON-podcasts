// A small animated-N badge that sits next to the title on NEON-official shows
// (jimmy, 2026-11-26). Set is_official on a show to turn it on.

export default function OfficialBadge({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/neon-official.gif"
      alt="NEON official"
      title="NEON official show"
      width={size}
      height={size}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        marginRight: 8,
        borderRadius: "50%",
      }}
    />
  );
}
