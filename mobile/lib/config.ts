import Constants from "expo-constants";

// EXPO_PUBLIC_API_URL wins (e.g. http://<rig-ip>:3000 for local dev), else app.json extra.apiUrl.
const baseUrl = (value: string | undefined, fallback: string) => (value ?? fallback).replace(/\/+$/, "");

export const API_URL: string = baseUrl(
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined),
  "https://neon-podcasts.vercel.app",
);

// The public web app hosts the legal pages. It shares the deployed origin with
// the API by default but can be pointed elsewhere without changing API_URL.
export const WEB_URL: string = baseUrl(
  process.env.EXPO_PUBLIC_WEB_URL ?? (Constants.expoConfig?.extra?.webUrl as string | undefined),
  API_URL,
);
export const PRIVACY_URL = `${WEB_URL}/privacy`;
export const TERMS_URL = `${WEB_URL}/terms`;

// Google OAuth client IDs (one per platform), created in Google Cloud console.
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
export const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
