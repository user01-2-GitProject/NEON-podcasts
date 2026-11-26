# Launch metadata — App Store Connect + Google Play Console

Strings ready to paste when the developer accounts are open. Every limit below is checked by
`tests/launch-metadata.test.cjs`, so edits that run over a store's limit fail `npm test`.

Only features the app ships today are described (Following, Browse, Live, Downloads, lock-screen
controls, 15-second skip, Google sign-in). Update this file when that list changes.

Fields marked **(decide)** need a call from Jimmy before submission.

## Shared

| Field | Value |
|---|---|
| App name | NEON Podcasts |
| Bundle ID / package | `com.needlesslyengineeredonlinenetwork.neon` |
| Primary category | Entertainment |
| Secondary category (Apple) | News |
| Support URL | https://needlesslyengineeredonlinenetwork.com |
| Marketing URL (Apple, optional) | https://needlesslyengineeredonlinenetwork.com |
| Privacy policy URL | https://neon-podcasts.vercel.app/privacy **(decide: confirm this host is public at submit time, or move it under needlesslyengineeredonlinenetwork.com/privacy)** |
| Terms URL | https://neon-podcasts.vercel.app/terms |
| Support email | **(decide)**: Apple shows it publicly; Play requires one |
| Copyright (Apple) | © 2026 Needlessly Engineered Online Network LLC **(decide: confirm the legal entity name)** |
| Price | Free, no in-app purchases |

## Apple App Store

<!-- limits: name 30, subtitle 30, promo 170, keywords 100, description 4000 -->

**Name** (30)

```text
NEON Podcasts
```

**Subtitle** (30)

```text
Shows made for you, daily
```

**Promotional text** (170)

```text
Follow NEON's shows and hear new episodes the moment they drop. Download for the road, skip ahead from your lock screen, and join live shows as they happen.
```

**Keywords** (100, comma-separated, no spaces after commas)

```text
podcast,daily news,briefing,audio,listen,shows,live,offline,episodes,AI,stories,network
```

**Description** (4000)

```text
NEON Podcasts is the listening app for the Needlessly Engineered Online Network: shows written and voiced fresh for every episode, on a schedule, about the things their hosts care about.

FOLLOW YOUR SHOWS
Browse the NEON network and follow the shows you like. Your Following tab lists every new episode from those shows, newest first.

LISTEN ANYWHERE
Audio keeps playing when you lock your phone or switch apps. Pause, play and skip 15 seconds back or forward from the lock screen.

DOWNLOAD FOR LATER
Save episodes to your phone and play them with no signal, on a plane or in the subway.

JOIN LIVE SHOWS
See which shows are live right now and follow along as they happen.

ONE ACCOUNT
Sign in with Google. The same account works on the NEON website, where show owners set up and schedule their shows.

YOUR DATA
We don't sell your information. You can delete your account at any time from Settings, in the app or on the website.
```

**What's New** (first release)

```text
First release: follow NEON shows, listen with lock-screen controls, download episodes, and join live shows.
```

**Age rating answers:** no violence, no sexual content, no gambling, no unrestricted web access,
user-generated content = **Yes** (shows are written by AI from owners' notes; owners control
what's published). Expected rating: 12+ (UGC). **(decide)**: Apple asks for a way to report
content in UGC apps. We don't have a report button yet.

**App Privacy ("nutrition label")** — data linked to the user, not used for tracking:
- Contact info → Email address, Name (from Google sign-in) — App functionality
- Identifiers → User ID — App functionality
- User content → Other user content (shows, briefings, follows) — App functionality
- No tracking, no third-party advertising, no analytics SDKs in the app today.

**Sign-in for review:** Apple needs a demo account. **(decide)**: create a member account
with a follow or two and put its Google login in App Review notes, or add an email/password
review login.

## Google Play

<!-- limits: title 30, short 80, full 4000 -->

**App name** (30)

```text
NEON Podcasts
```

**Short description** (80)

```text
Follow NEON's shows, listen offline, and catch live episodes as they happen.
```

**Full description** (4000): same text as the Apple description above.

**Category:** Entertainment. **Tags:** Podcasts, News.

**Content rating questionnaire (IARC):** reference app category "Entertainment"; user
interaction = users can't talk to each other in the app; user-generated content = yes (owner-made
shows); no violence, sexual content, gambling or controlled substances.

**Data safety form**
- Data collected: Personal info → Name, Email address (required, from Google sign-in). App
  activity → Other user-generated content (follows).
- Shared with third parties: No.
- Encrypted in transit: Yes (HTTPS only).
- Users can request deletion: Yes. In-app (Settings → Delete account) and on the web.
- Purpose: App functionality, Account management.

**Target audience:** 13+ (not designed for children).

**Ads:** No ads.

## Screenshots to take

Take each on a phone with a real account that follows 2–3 shows that have artwork. Apple needs
6.9" (1320×2868) **and** 6.5" (1284×2778) iPhone sets; Play needs at least 2 phone screenshots
(1080×1920 or larger, 9:16).

1. **Following tab**: list of new episodes with artwork. *Caption: "Every new episode, in one place."*
2. **Show screen**: artwork, description, episodes, NEON-official badge on an official show. *"Follow the shows you like."*
3. **Now playing + lock screen**: player bar with skip buttons, then the lock-screen controls. *"Keep listening with your phone locked."*
4. **Downloads tab**: two or three saved episodes. *"Download for the road."*
5. **Live tab**: a show live now. *"Join live shows as they happen."*
6. **Browse tab**: the network's shows with Follow buttons. *"Find your next show."*

Play also needs a **feature graphic** (1024×500): circle-N logo on `#0b0d12` with "NEON Podcasts".
