import { Tabs } from "expo-router";
import { View } from "react-native";
import { MiniPlayer } from "../../components";
import { colors } from "../../lib/theme";

export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: "#222" },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarIconStyle: { display: "none" },
          tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Following" }} />
        <Tabs.Screen name="browse" options={{ title: "Browse" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      </Tabs>
      <MiniPlayer />
    </View>
  );
}
