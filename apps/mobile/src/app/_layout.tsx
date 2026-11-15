import { Archivo_700Bold } from "@expo-google-fonts/archivo/700Bold";
import { Archivo_800ExtraBold } from "@expo-google-fonts/archivo/800ExtraBold";
import { Doto_900Black } from "@expo-google-fonts/doto/900Black";
import Mapbox from "@rnmapbox/maps";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  type Theme,
  ThemeProvider,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ClockGuard } from "@/components/clock-guard";
import { ToastHost } from "@/components/ui";
import { config } from "@/config";
import { FontFamily, Type } from "@/constants/theme";
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

// The splash stays up until the board and figure fonts are ready, so no
// text ever renders in the wrong face first.
void SplashScreen.preventAutoHideAsync();

/**
 * Token board type (design guide §2). Release builds embed these files with
 * the expo-font config plugin (app.config.ts); loading them here as well
 * covers builds made before the plugin was added. Same family names.
 */
const APP_FONTS = {
  [FontFamily.board]: Doto_900Black,
  [FontFamily.figure]: Archivo_700Bold,
  [FontFamily.figureHeavy]: Archivo_800ExtraBold,
};

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
  // A failed font load (should not happen: the files are bundled) must not
  // keep the splash up for ever; text then falls back to Roboto.
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (fontsReady) SplashScreen.hide();
  }, [fontsReady]);

  if (!fontsReady) return null;

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.surface,
      card: colors.surface,
      text: colors.onSurface,
      border: colors.outlineVariant,
      notification: colors.error,
    },
  };

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider value={navTheme}>
            <Stack
              screenOptions={{
                // M3 top app bar: surface, no shadow line, title large in
                // Archivo (screen titles are figures of the brand).
                headerStyle: { backgroundColor: colors.surface },
                headerShadowVisible: false,
                headerTintColor: colors.onSurface,
                headerTitleStyle: { ...Type.appTitle },
                contentStyle: { backgroundColor: colors.surface },
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
                options={{ title: "Your ticket" }}
              />
              <Stack.Screen name="pay" options={{ title: "Payment" }} />
              <Stack.Screen
                name="payments"
                options={{ title: "My payments" }}
              />
              <Stack.Screen
                name="business/[id]/payments"
                options={{ title: "Payments" }}
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
