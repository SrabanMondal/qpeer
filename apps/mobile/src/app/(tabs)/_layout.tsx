import { Tabs } from "expo-router/js-tabs";
import { useEffect, useState } from "react";
import type { ColorValue } from "react-native";
import { HeaderModeSwitch } from "@/components/header-mode-switch";
import { ThemedView } from "@/components/themed-view";
import { Icon, type IconName, LoadingState } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { useAppMode } from "@/lib/mode";

/** Longest wait for the first /v1/me answer before the tabs open anyway. */
const STARTUP_WAIT_MS = 2500;

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
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  // Once the tabs are shown they stay shown (B1). Before, a refetch of /v1/me
  // without data reset the query to "pending", which put "Starting…" back,
  // unmounted the tabs, and the remounted screens refetched again: a loop.
  const [opened, setOpened] = useState(false);

  // A registered user may have chosen Business mode: briefly wait for the
  // first /v1/me answer so the wrong set of tabs does not flash. Never block
  // on the network: on the first failure (e.g. offline) or after 2.5 s, open
  // in Customer mode and switch when /v1/me arrives.
  const settled =
    !initializing &&
    (!registered ||
      me.data !== undefined ||
      me.isError ||
      me.failureCount > 0 ||
      waitedLongEnough);
  // Latch during render (React's "derived state" pattern, no extra effect).
  if (settled && !opened) setOpened(true);

  useEffect(() => {
    if (initializing) return;
    const timer = setTimeout(() => setWaitedLongEnough(true), STARTUP_WAIT_MS);
    return () => clearTimeout(timer);
  }, [initializing]);

  if (!opened && !settled) {
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
          // Full-screen map with its own top bar (map-interface.jpg).
          headerShown: false,
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
          // B3: title on the left takes the free space and truncates; the
          // toggle is a compact pill on the right that never shrinks.
          headerStyle: { backgroundColor: theme.header },
          headerTintColor: theme.onPrimary,
          headerTitleStyle: { ...Type.heading, color: theme.onPrimary },
          headerTitleAlign: "left",
          headerTitleContainerStyle: { flex: 1, maxWidth: "100%" },
          headerRightContainerStyle: { flexGrow: 0, flexBasis: "auto" },
          headerRight: () => <HeaderModeSwitch />,
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
