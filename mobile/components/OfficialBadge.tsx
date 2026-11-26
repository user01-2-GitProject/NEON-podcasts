import { Image } from "react-native";

// The spinning-N badge beside a NEON-official show's title. Mirrors the web
// badge (components/OfficialBadge.tsx). The gif ships inside the app so it
// shows offline too. Android plays gifs because Expo turns on
// expo.gif.enabled in prebuild.
export function OfficialBadge({ size = 22 }: { size?: number }) {
  return (
    <Image
      source={require("../assets/neon-official.gif")}
      style={{ width: size, height: size, borderRadius: size / 2, marginRight: 8 }}
      accessibilityLabel="NEON official show"
    />
  );
}
