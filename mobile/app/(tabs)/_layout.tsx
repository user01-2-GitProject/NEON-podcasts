import { Tabs } from "expo-router";
import { View } from "react-native";
import { MiniPlayer } from "../../components";
import { useTheme } from "../../lib/theme-context";

export default function TabsLayout() {
  const { colors: c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.bg, borderBottomColor: c.hairline },
          headerTintColor: c.text,
          tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.hairline },
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.muted,
          tabBarIconStyle: { display: "none" },
          tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Following" }} />
        <Tabs.Screen name="browse" options={{ title: "Browse" }} />
        <Tabs.Screen name="live" options={{ title: "Live" }} />
        <Tabs.Screen name="downloads" options={{ title: "Downloads" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      </Tabs>
      <MiniPlayer />
    </View>
  );
}
