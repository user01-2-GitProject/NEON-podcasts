# NEON mobile (Expo)

Listener app for NEON-podcasts: sign in with Google, browse shows, follow them, play episodes.
Phase 3b skeleton; see the native app scope doc for the 3c-3e roadmap.

## Run it

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=https://neon-podcasts.vercel.app \
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=... \
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=... \
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=... \
npx expo start
```

Point `EXPO_PUBLIC_API_URL` at `http://<rig-lan-ip>:3000` to test against the Rig.

## Release (EAS build + submit)

`eas.json` defines three build profiles: `development` (dev client, internal), `preview` (internal distribution — Android APK, iOS ad-hoc), and `production` (store builds — iOS TestFlight/App Store, Android app bundle for the internal track). The icon/splash files in `assets/` are solid-color placeholders; replace them with real artwork before a public release.

Build with EAS:

```bash
cd mobile
eas build --profile preview --platform ios        # or android
eas build --profile production --platform ios      # or android
```

Submit production builds:

```bash
eas submit --profile production --platform ios     # TestFlight
eas submit --profile production --platform android # Play internal track
```

The submit section in `eas.json` uses `REPLACE_ME` placeholders for Apple ID, App Store Connect app ID, Apple team ID, and the Play service account key path. Fill those in with EAS credentials/dashboard settings, never in committed files.

Required environment variables are placeholders set via EAS secrets (`eas secret:create` or the EAS dashboard), **not committed**:

- `EXPO_PUBLIC_API_URL` — API base URL used by `lib/config.ts` (falls back to `app.json` `extra.apiUrl`).
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

Set real values for these secrets before building or submitting a release.

## How auth works

1. `expo-auth-session` gets a Google **ID token** on the device.
2. The app POSTs it to `/api/auth/mobile` (Phase 3a backend), which verifies it and returns a per-user NEON API token.
3. The token lives in `expo-secure-store` and is sent as `Authorization: Bearer ...` on every call. A 401 signs the user out.

Login needs the 3a backend deployed (and the `api_tokens` table in prod). Until then the app runs but sign-in fails.

## Backend endpoints used

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/mobile` | Google ID token → NEON token (3a) |
| `GET /api/browse` | Shows with published episodes + `following` flag |
| `GET /api/browse/[rss_token]` | One show's published episodes |
| `GET /api/following` | Latest episodes from followed shows |
| `POST /api/subscriptions`, `DELETE /api/subscriptions/[showId]` | Follow / unfollow |

Audio URLs come back with `?feed=<rss_token>` attached, so playback needs no auth header.

## Layout

- `app/_layout.tsx`: providers + auth gate (redirects to `/login` without a token)
- `app/login.tsx`: Google sign-in
- `app/(tabs)/`: Following, Browse, Settings
- `app/show/[token].tsx`: show episodes
- `lib/`: API client, auth context, player (expo-audio with background playback)

## Not yet (later phases)

Lock-screen controls and queue (react-native-track-player, 3c), offline downloads and push (3d), EAS builds to TestFlight / Play internal (3e).
