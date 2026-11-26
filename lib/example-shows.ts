// Metadata shared by the seed script, the Browse chip and the wizard's
// "See a show like this" link. The editorial copy lives in templates/examples
// (*.md) — this file only holds stable ids and the labels the UI needs.

export type ExampleKey = "sterling-news" | "rarely-made-history";

export interface ExampleShowDefinition {
  key: ExampleKey;
  /** Stable UUID: re-running the seed updates this row instead of adding another. */
  id: string;
  episodeId: string;
  /** Stable capability token so the wizard link and RSS feed survive re-seeding. */
  rssToken: string;
  title: string;
  episodeTitle: string;
  /** Repo-root-relative path to the wizard example the show's copy comes from. */
  templatePath: string;
  /** Short label used in the wizard link and in the demo episode's notes. */
  formatLabel: string;
}

// A reserved, non-sign-in account: no password, not in OWNER_EMAILS, and
// owner_approved = false. It only exists so the examples have a real owner.
export const SYSTEM_OWNER = {
  email: "system@neon.example",
  role: "member" as const,
} as const;

export const EXAMPLE_SHOWS: readonly ExampleShowDefinition[] = [
  {
    key: "sterling-news",
    id: "00000000-0000-4000-8000-000000000101",
    episodeId: "00000000-0000-4000-8000-000000000102",
    rssToken: "5e9d0000000000000000000000000001",
    title: "Sterling Reads the News",
    episodeTitle: "A three-minute news brief",
    templatePath: "templates/examples/usa-news.md",
    formatLabel: "news brief",
  },
  {
    key: "rarely-made-history",
    id: "00000000-0000-4000-8000-000000000201",
    episodeId: "00000000-0000-4000-8000-000000000202",
    rssToken: "5e9d0000000000000000000000000002",
    title: "Rarely Made History",
    episodeTitle: "A three-minute narrative essay",
    templatePath: "templates/examples/rarely-made-history.md",
    formatLabel: "narrative essay",
  },
] as const;

export const EXAMPLE_SHOW_IDS: readonly string[] = EXAMPLE_SHOWS.map((s) => s.id);

export function isExampleShow(id: string | null | undefined): boolean {
  return typeof id === "string" && EXAMPLE_SHOW_IDS.includes(id);
}

export function exampleChipLabel(id: string | null | undefined): "Example" | null {
  return isExampleShow(id) ? "Example" : null;
}

// News-shaped drafts see the news brief; History drafts see the narrative
// essay. Before a format is picked (or for any other format) Sterling is the
// default worked example.
export function exampleForFormat(formatId: string | undefined): ExampleShowDefinition {
  const key: ExampleKey = formatId === "history" ? "rarely-made-history" : "sterling-news";
  return EXAMPLE_SHOWS.find((s) => s.key === key) ?? EXAMPLE_SHOWS[0];
}

export function exampleListenPath(show: ExampleShowDefinition): string {
  return `/listen/${show.rssToken}`;
}
