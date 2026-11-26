// The spinning-N badge beside a NEON-official show's title. Motion comes from
// iggy's canonical orbit files under /brand: WebM where the browser can play
// it, the cleaned GIF as the fallback, and a still frame for reduced motion.
// Styles live in globals.css (already loaded by app/layout.tsx) so this small
// server component stays import-free for the offline tests.

export default function OfficialBadge({
  size = 28,
  label = "NEON official",
}: {
  size?: number;
  label?: string;
}) {
  const title = label === "NEON official" ? "NEON official show" : label;
  return (
    <span
      className="official-badge"
      style={{ width: size, height: size, marginRight: 8 }}
      title={title}
    >
      <video
        className="official-badge-motion"
        width={size}
        height={size}
        autoPlay
        muted
        loop
        playsInline
        aria-label={label}
        poster="/brand/neon-logo-orbit-still.png"
      >
        <source src="/brand/neon-logo-orbit-transparent.webm" type="video/webm" />
        <img src="/brand/neon-logo-orbit-360-clean.gif" alt={label} width={size} height={size} />
      </video>
      <img
        className="official-badge-still"
        src="/brand/neon-logo-orbit-still.png"
        alt={label}
        width={size}
        height={size}
      />
    </span>
  );
}
