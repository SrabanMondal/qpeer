import { Redirect } from "expo-router";

import { useAppMode } from "@/lib/mode";
import { InsightsScreen } from "@/screens/insights/insights-screen";

/** Business mode → Insights: analytics and earnings (Step 5, INS-01…08). */
export default function InsightsTab() {
  const { mode } = useAppMode();
  if (mode !== "business") return <Redirect href="/" />;
  return <InsightsScreen />;
}
