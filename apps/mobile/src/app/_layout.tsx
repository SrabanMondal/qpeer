import Mapbox from "@rnmapbox/maps";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  type Theme,
  ThemeProvider,
} from "expo-router";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ClockGuard } from "@/components/clock-guard";
import { ToastHost } from "@/components/ui";
import { config } from "@/config";
import { Type } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";
import { AuthProvider } from "@/lib/auth";
import { createQueryClient, useAppFocusRefetch } from "@/lib/network";
import { usePushSetup } from "@/lib/push";
import { preloadStorage } from "@/lib/storage";

if (config.mapboxToken) {
  Mapbox.setAccessToken(config.mapboxToken);
}

// C1: saved tickets, map choices and keys are read before the first screens
// need them (each read is also safe on its own).
void preloadStorage();

/**
 * A deep link (`qpeer://q/<id>`) or an alert tap on a cold start opens its
 * screen on top of the tabs, so Back returns to the app (NFR-16).
 */
export const unstable_settings = { anchor: "(tabs)" };

/** Push setup (ALR-01–06) needs the auth and query providers above it. */
function PushSetup() {
  usePushSetup();
  return null;
}

/**
 * Root native stack: the bottom tabs `(tabs)` plus every detail screen pushed
 * on top of them (Android back pops one screen, NFR-16).
 */
export default function RootLayout() {
  const dark = useIsDark();
  const colors = useTheme();
  // Retries back off 1 s → 30 s on network errors (B1); see lib/network.ts.
  const [queryClient] = useState(createQueryClient);
  useAppFocusRefetch(queryClient);

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.card,
      text: colors.ink,
      border: colors.border,
      notification: colors.danger,
    },
  };

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider value={navTheme}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.card },
                headerTintColor: colors.ink,
                headerTitleStyle: { ...Type.heading },
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
              <Stack.Screen name="map-check" options={{ title: "Map check" }} />
              <Stack.Screen
                name="business/new"
                options={{ title: "New business" }}
              />
              <Stack.Screen
                name="business/[id]/index"
                options={{ title: "Business" }}
              />
              <Stack.Screen
                name="business/[id]/edit"
                options={{ title: "Edit profile" }}
              />
              <Stack.Screen
                name="business/[id]/location"
                options={{ title: "Set pin" }}
              />
              <Stack.Screen
                name="business/[id]/hours"
                options={{ title: "Opening hours" }}
              />
              <Stack.Screen
                name="business/[id]/public"
                options={{ title: "Business" }}
              />
              <Stack.Screen
                name="business/[id]/new-queue"
                options={{ title: "New queue" }}
              />
              <Stack.Screen
                name="queue/[id]/index"
                options={{ title: "Queue" }}
              />
              <Stack.Screen
                name="queue/[id]/qr"
                options={{ title: "QR code" }}
              />
              <Stack.Screen
                name="queue/[id]/verify"
                options={{ title: "Verify ticket" }}
              />
              <Stack.Screen name="scan" options={{ title: "Scan queue QR" }} />
              <Stack.Screen name="q/[id]" options={{ title: "Join queue" }} />
              <Stack.Screen
                name="token/[id]"
                options={{ title: "Your Ticket" }}
              />
            </Stack>
            <PushSetup />
            <ToastHost />
            <ClockGuard />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
