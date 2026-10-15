import Mapbox from "@rnmapbox/maps";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  type Theme,
  ThemeProvider,
} from "expo-router";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { config } from "@/config";
import { Type } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";

if (config.mapboxToken) {
  Mapbox.setAccessToken(config.mapboxToken);
}

/** Retry once, but never on 4xx answers: retrying cannot change them. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

/**
 * Root native stack: the bottom tabs `(tabs)` plus every detail screen pushed
 * on top of them (Android back pops one screen, NFR-16).
 */
export default function RootLayout() {
  const dark = useIsDark();
  const colors = useTheme();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: shouldRetry, staleTime: 30_000 },
        },
      }),
  );

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
            </Stack>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
