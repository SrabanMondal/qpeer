import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";
import { HeaderModeSwitch } from "@/components/header-mode-switch";
import { ThemedView } from "@/components/themed-view";
import { Icon, type IconName, LoadingState } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { useAppMode } from "@/lib/mode";

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon name={name} size={size} colorValue={color} />
  );
}

/**
 * Bottom tabs (design guide §4). Customer: Home, Queue, Profile. Business:
 * Queue, Business, Insights, Profile. Tabs of the other mode are hidden with
 * `href: null`; tabs whose step is not built show a placeholder card.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { initializing } = useAuth();
  const { mode, me, registered } = useAppMode();

  // A registered user may have chosen Business mode: wait for /v1/me so the
  // wrong set of tabs never flashes. On error, fall back to Customer mode
  // (Profile shows the error with Retry).
  if (initializing || (registered && !me.data && !me.isError)) {
    return (
      <ThemedView style={{ flex: 1, justifyContent: "center" }}>
        <LoadingState label="Starting…" />
      </ThemedView>
    );
  }

  const business = mode === "business";
  const customerOnly = business ? null : undefined;
  const businessOnly = business ? undefined : null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.inkMuted,
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: { ...Type.label },
        headerStyle: { backgroundColor: theme.card },
        headerTintColor: theme.ink,
        headerTitleStyle: { ...Type.heading },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          href: customerOnly,
          tabBarIcon: tabIcon("home"),
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: "Queue",
          headerTitle: business ? "Queue console" : "Your queue",
          tabBarIcon: tabIcon(business ? "queue" : "confirmation_number"),
        }}
      />
      <Tabs.Screen
        name="business"
        options={{
          title: "Business",
          headerTitle: "My businesses",
          href: businessOnly,
          tabBarIcon: tabIcon("storefront"),
          // Dark header band with the mode toggle (business-interface.jpg).
          headerStyle: { backgroundColor: theme.header },
          headerTintColor: theme.onPrimary,
          headerTitleStyle: { ...Type.heading, color: theme.onPrimary },
          headerLeft: () => <HeaderModeSwitch />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: "Insights",
          href: businessOnly,
          tabBarIcon: tabIcon("insights"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: tabIcon("person") }}
      />
    </Tabs>
  );
}
