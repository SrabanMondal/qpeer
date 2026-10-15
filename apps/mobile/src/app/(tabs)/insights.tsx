import { Redirect } from "expo-router";

import { EmptyState, Screen } from "@/components/ui";
import { useAppMode } from "@/lib/mode";

/** Business insights: analytics and earnings arrive in Step 5. */
export default function InsightsTab() {
  const { mode } = useAppMode();
  if (mode !== "business") return <Redirect href="/" />;

  return (
    <Screen bottomInset={false}>
      <EmptyState
        icon="insights"
        title="Insights"
        message="Wait times, busy hours and earnings (reservations, Priority Pass and your share, in ₹) arrive in Step 5."
      />
    </Screen>
  );
}
