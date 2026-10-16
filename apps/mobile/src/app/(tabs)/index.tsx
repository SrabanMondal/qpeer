import { Redirect } from "expo-router";

import { useAppMode } from "@/lib/mode";
import { DiscoverScreen } from "@/screens/discover/discover-screen";

/** Customer Home: the live queue map and list (Step 3, MAP-01…07). */
export default function HomeTab() {
  const { mode } = useAppMode();
  // Opened in Business mode (e.g. at launch): go to the business home.
  if (mode === "business") return <Redirect href="/business" />;
  return <DiscoverScreen />;
}
