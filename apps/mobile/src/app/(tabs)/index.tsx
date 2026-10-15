import { Redirect } from "expo-router";

import { ConnectionBanner, EmptyState, Screen } from "@/components/ui";
import { useAppMode } from "@/lib/mode";

/** Customer Home. The live queue map (Step 3) replaces the placeholder. */
export default function HomeTab() {
  const { mode } = useAppMode();
  // Opened in Business mode (e.g. at launch): go to the business home.
  if (mode === "business") return <Redirect href="/business" />;

  return (
    <Screen bottomInset={false}>
      <ConnectionBanner />
      <EmptyState
        icon="map"
        title="Discover queues in Jammu"
        message="Live queue map arrives in Step 3. You will see nearby clinics, labs and salons with their wait times."
      />
      <EmptyState
        icon="storefront"
        title="Run a business?"
        message="Open Profile and switch to Business mode to set up your queues."
      />
    </Screen>
  );
}
