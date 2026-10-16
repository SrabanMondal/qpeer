import { Linking, Platform } from "react-native";

/**
 * Opens the phone's maps app at a place (Android `geo:` intent, so the user
 * picks Google Maps or another app), with a Google Maps web link as fallback.
 */
export function openDirections(lat: number, lng: number, name: string) {
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  if (Platform.OS === "android") {
    const geo = `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`;
    Linking.openURL(geo).catch(() => {
      void Linking.openURL(web);
    });
    return;
  }
  void Linking.openURL(web);
}
