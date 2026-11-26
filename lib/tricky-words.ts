// Spots words a voice is likely to say wrong, from a show's own text
// (its answers, briefings and recent scripts). Free and instant: no AI call.
// Each spot comes with a first guess at how to say it, which the owner can
// change before adding it to the show's tricky-words list.
//
// Import-free so the setup wizard can run it in the browser.

export type TrickyKind = "short_form" | "name" | "two_ways" | "never_say" | "symbol";

export interface TrickySpot {
  term: string;
  say_as: string;
  why: string;
  kind: TrickyKind;
  count: number;
}

// Words spelled one way and said two ways. The guess is the way a sports,
// news or money show usually means it.
const TWO_WAYS: Record<string, string> = {
  rebound: "REE-bound",
  rebounds: "REE-bounds",
  // Common enough to trip voices on sports and money shows.
  "re-sign": "ree-SINE",
  "re-signed": "ree-SINED",
  coup: "koo",
  segue: "SEG-way",
  ensure: "en-SHOOR",
  forte: "FOR-tay",
  niche: "neesh",
  gif: "jif",
  quinoa: "KEEN-wah",
  "a.m.": "A M",
  "p.m.": "P M",
};

// Short forms a voice already says the way people expect. Not worth flagging.
const KNOWN_SHORT_FORMS = new Set([
  "I", "A", "OK", "TV", "US", "USA", "UK", "EU", "UN", "AM", "PM", "CEO", "CFO", "CTO",
  "NFL", "NBA", "MLB", "NHL", "FBI", "CIA", "NASA", "NATO", "FAQ", "DIY", "ASAP",
  "DC", "LA", "NY", "NYC", "PC", "ID", "BBC", "CNN", "ESPN", "IRS", "GDP", "AI",
  "MVP", "VIP", "DJ", "MC", "IT", "HR", "PR", "UFO", "ATM", "SUV", "DNA", "GPS",
]);

// Letter clusters that English names use all the time; anything else with
// three or more consonants in a row ("nmp" in Antetokounmpo) is a flag.
const COMMON_CLUSTERS = new Set([
  "str", "spr", "scr", "spl", "squ", "thr", "chr", "sch", "shr", "phr", "ght", "nch", "tch", "nst", "nth",
  "rst", "rth", "rch", "rld", "rts", "nts", "nds", "ngs", "lls", "rks", "mps", "cts", "pts", "lts", "ldr",
  "ndr", "ntr", "mpl", "mbl", "ngl", "ckl", "xpl", "nkl", "rtl", "ndl", "nct", "rsh", "lch", "rch", "nsh",
  "lth", "rgh", "ngh", "tts", "lds", "rns", "rms", "wns", "wnt", "ckt", "nks", "ckn", "rdn", "rbr", "lkn",
  "mpt", "mpb", "ltz", "ntz", "rtz", "nck", "rck", "lck", "sch", "chn", "ckm", "kst", "rtr", "str", "nfr",
  "ngr", "ldw", "ldm", "llb", "llm", "lln", "llw", "rdw", "rnb", "rnh", "rph", "rpl", "thw", "ckb", "ckh",
  "ckw", "nsb", "nsf", "nsk", "nsl", "nsp", "nsw", "ffr", "ffl", "ssw", "ssl", "rsw", "rkl", "rnw", "wsk",
  "cks", "hns", "chm", "lfs", "rds", "rls", "rps", "sts", "lms", "nfl", "ngf", "rkn", "ldf", "ntl", "dst",
  "nds", "tsb", "rgr", "ngt", "rnd", "wnd", "wls", "lst", "rtn", "ttl", "ckt", "ckr", "dsw", "ghl", "ghn",
]);

const CONSONANTS = "bcdfghjklmnpqrstvwxz";
const NEVER_SAY_WORDS: Record<string, string> = {
  fuck: "frick",
  fucking: "freaking",
  fucked: "fricked",
  fucker: "fricker",
  motherfucker: "mother-trucker",
  shit: "shoot",
  shitty: "crummy",
  bullshit: "baloney",
  bitch: "witch",
  asshole: "jerk",
};

function lettersSpaced(word: string): string {
  return word.replace(/[^A-Za-z0-9]/g, "").split("").join(" ");
}

// Pronounceable short forms (NEON, NATO-style) read as a word; others read
// letter by letter (RBI -> "R B I").
function shortFormGuess(word: string): string {
  const w = word.replace(/s$/, "");
  const sayable = w.length >= 4 && /^[^AEIOU]?[AEIOU][^AEIOU]+[AEIOU][^AEIOU]?$|^[^AEIOU][AEIOU]{1,2}[^AEIOU]$/.test(w);
  return sayable ? w.toLowerCase() : lettersSpaced(w);
}

function oddCluster(word: string): boolean {
  const lower = word.toLowerCase();
  const re = new RegExp(`[${CONSONANTS}]{3,}`, "g");
  for (const m of lower.match(re) || []) {
    // A run of 3+: every 3-letter window must be a common cluster.
    for (let i = 0; i + 3 <= m.length; i++) {
      if (!COMMON_CLUSTERS.has(m.slice(i, i + 3))) return true;
    }
  }
  // Letter pairs English rarely uses at the start of a name.
  if (/^(?:mb|nd|ng|nk|ts|tz|zh|kh|dz|pf|sz|cz|dj|tl|hr|hv|vl|ps|pt|gn|kn|wr)\w/i.test(word) && !/^(?:kn|wr|ps|gn)/i.test(word)) return true;
  // Endings borrowed from other languages that English voices say wrong.
  if (/(?:ić|ic|vic|vich|ijk|aij|oux|eaux|ais|ault|zsch|scu|escu|ae|oi)$/i.test(word) && word.length >= 5) return true;
  if (/q(?!u)/i.test(word) || /(?:ij|jk|kj|zz.|aa|ii|uu)/i.test(word)) return true;
  return false;
}

interface Bucket { term: string; kind: TrickyKind; why: string; say_as: string; count: number }

export function spotTrickyWords(text: string, alreadyHave: string[] = [], limit = 20): TrickySpot[] {
  const have = new Set(alreadyHave.map((t) => t.trim().toLowerCase()));
  const found = new Map<string, Bucket>();
  const add = (term: string, kind: TrickyKind, why: string, sayAs: string) => {
    const key = term.toLowerCase();
    if (have.has(key)) return;
    const b = found.get(key);
    if (b) b.count += 1;
    else found.set(key, { term, kind, why, say_as: sayAs, count: 1 });
  };
  const src = (text || "").slice(0, 200_000);

  // Never-say words first; a phrase like "Deep Fucking Value" is kept whole
  // so the owner can pick its on-air name.
  for (const m of src.matchAll(/\b(?:[A-Z][a-z]+\s+)?(fuck\w*|motherfuck\w*|shit\w*|bullshit|bitch\w*|asshole\w*)(?:\s+[A-Z][a-z]+)?\b/gi)) {
    const phrase = m[0];
    const bad = m[1].toLowerCase();
    const clean = NEVER_SAY_WORDS[bad] || "[bleep]";
    const isTitle = /^[A-Z]/.test(phrase) && phrase.split(/\s+/).length > 1 && phrase.split(/\s+/).every((w) => /^[A-Z]/.test(w));
    if (isTitle) add(phrase, "never_say", "Never said on air. Pick what the host says instead.", phrase.replace(m[1], clean.charAt(0).toUpperCase() + clean.slice(1)));
    else add(m[1], "never_say", "Never said on air. Pick what the host says instead.", clean);
  }

  // Words spelled one way, said two ways ("rebound").
  for (const m of src.matchAll(/[A-Za-z][A-Za-z.\-]*[A-Za-z.]/g)) {
    const w = m[0].toLowerCase();
    if (TWO_WAYS[w]) add(m[0].toLowerCase(), "two_ways", "Voices often say this one the wrong way.", TWO_WAYS[w]);
  }

  // Short forms in capitals (RBI, ERA, NEON, 0DTE). The word right after a
  // period isn't special, but short forms are capitals anywhere.
  for (const m of src.matchAll(/(?<![\p{L}\p{N}])((?:\d+[A-Z]{2,5})|(?:[A-Z]{2,6}s?))(?![\p{L}\p{N}])/gu)) {
    const w = m[1];
    const bare = w.replace(/s$/, "");
    if (KNOWN_SHORT_FORMS.has(bare) || KNOWN_SHORT_FORMS.has(w)) continue;
    // A whole shouted sentence isn't a list of short forms.
    const around = src.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + w.length + 20);
    if ((around.match(/\b[A-Z]{3,}\b/g) || []).length >= 4) continue;
    const guess = /^\d/.test(w)
      ? w.replace(/^(\d+)/, (d) => `${d} `).replace(/[A-Z]+$/, (l) => lettersSpaced(l))
      : shortFormGuess(w);
    add(bare === w ? w : bare, "short_form", "Short form. Should the host spell it out or say it as a word?", guess);
  }

  // $TICKER and symbols like "&" inside names.
  for (const m of src.matchAll(/\$([A-Z]{1,5})\b/g)) {
    add(m[0], "symbol", "A stock ticker. Voices may read the dollar sign.", lettersSpaced(m[1]));
  }

  // Names: capitalized words with accents or letter patterns English voices
  // stumble on (Dončić, Jokić, Antetokounmpo, Wembanyama-style).
  for (const m of src.matchAll(/(?<![\p{L}\p{N}'’])(\p{Lu}[\p{Ll}\p{M}'’\-]{2,})(?![\p{L}\p{N}])/gu)) {
    const w = m[1].replace(/['’]s$/, "");
    const accented = /[^\x00-\x7F]/.test(w);
    if (!accented && !oddCluster(w)) continue;
    add(w, "name", accented ? "Has accent marks. Write it the way it sounds." : "An unusual name. Write it the way it sounds.", accented ? w.normalize("NFD").replace(/\p{M}/gu, "") : w);
  }

  const rank: Record<TrickyKind, number> = { never_say: 0, two_ways: 1, name: 2, short_form: 3, symbol: 4 };
  return [...found.values()]
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}
