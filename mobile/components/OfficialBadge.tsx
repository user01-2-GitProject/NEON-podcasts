import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

// The spinning-N badge beside a NEON-official show's title. Mirrors the web
// badge (components/OfficialBadge.tsx). The gif ships inside the app so it
// shows offline too. Android plays gifs because Expo turns on
// expo.gif.enabled in prebuild.
export function OfficialBadge({ size = 22 }: { size?: number }) {
  return (
    <Image
      source={require("../assets/neon-official.gif")}
      style={{ width: size, height: size, borderRadius: size / 2, marginRight: size < 20 ? 5 : 8 }}
      accessibilityLabel="NEON official show"
    />
  );
}

// A show name with the small badge in front when the show is NEON-official.
// Used wherever an episode row names its show (Following, Downloads, player bar).
export function ShowName({ official, style, children }: { official?: boolean; style?: StyleProp<TextStyle>; children: ReactNode }) {
  if (!official) return <Text style={style} numberOfLines={1}>{children}</Text>;
  return (
    <View style={styles.row}>
      <OfficialBadge size={14} />
      <Text style={[style, { flexShrink: 1 }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center" } });
