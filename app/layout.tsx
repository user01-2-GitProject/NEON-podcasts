import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEON Podcasts",
  description: "Generate podcast episodes from Markdown briefings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
