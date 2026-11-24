import Constants from "expo-constants";

// EXPO_PUBLIC_API_URL wins (e.g. http://<rig-ip>:3000 for local dev), else app.json extra.apiUrl.
export const API_URL: string = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://neon-podcasts.vercel.app"
).replace(/\/+$/, "");

// Google OAuth client IDs (one per platform), created in Google Cloud console.
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
export const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
