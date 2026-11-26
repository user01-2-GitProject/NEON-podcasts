import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Alert, Platform } from "react-native";
import { API_URL } from "./config";

const DEVICE_ID_KEY = "neon_push_device_id";

// Expo Go cannot issue remote push tokens (Android, SDK 53+) and the web build
// has no native notifications module. Both must be no-ops so sign-in keeps
// working; EAS dev builds and production builds are allowed to register.
export function canRegisterPush(): boolean {
  return (
    Platform.OS !== "web" &&
    Constants.appOwnership !== "expo" &&
    Constants.expoGoConfig === null
  );
}

// Stable per-install id, kept in secure storage so repeated logins and token
// refreshes upsert the same device row instead of piling up duplicates.
async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return id;
}

// Best-effort registration after sign-in. Failures (permissions denied, no
// EAS project id, offline device, rejected POST) never throw or block login.
export async function registerPushToken(apiToken: string): Promise<void> {
  if (!canRegisterPush()) return;

  try {
    // Loaded only on a native build that can actually use remote notifications.
    const Notifications = await import("expo-notifications");

    // Android 13+ requires a channel before asking for a push token.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "NEON",
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;

    const projectId =
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
      Constants.easConfig?.projectId ??
      undefined;
    if (!projectId) return;

    const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!/^ExpoPushToken\[[^\]\s]+\]$/.test(expoToken)) return;

    const res = await fetch(`${API_URL}/api/me/push-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expo_push_token: expoToken, device_id: await getDeviceId() }),
    });
    if (!res.ok) return;

    Alert.alert("Push notifications enabled", "NEON can now notify you about new episodes.");
  } catch {
    // Notifications are a convenience, not a sign-in requirement.
  }
}
