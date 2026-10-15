import { useQueryClient } from "@tanstack/react-query";

import { HeaderButton } from "@/components/ui/header-button";
import { StatusBanner } from "@/components/ui/status-banner";
import { useAuth } from "@/lib/auth";
import { retryNetworkFailures, useOffline } from "@/lib/network";

/**
 * Non-blocking connection strip, shown at the top of every `Screen`:
 * - "Connecting…" while the automatic anonymous sign-in is retried (IDN-01);
 * - "Offline — reconnecting…" while API requests fail with network errors
 *   (B1). It disappears with the next successful request.
 */
export function ConnectionBanner() {
  const { connecting, error, retry } = useAuth();
  const offline = useOffline();
  const queryClient = useQueryClient();

  if (connecting) {
    return (
      <StatusBanner
        tone="paused"
        title="Connecting…"
        detail={error ? `${error} Trying again automatically.` : undefined}
        right={<HeaderButton title="Retry" onPress={retry} />}
      />
    );
  }
  if (offline) {
    return (
      <StatusBanner
        tone="paused"
        title="Offline — reconnecting…"
        detail="Showing what was loaded last. Trying again automatically."
        right={
          <HeaderButton
            title="Retry"
            onPress={() => retryNetworkFailures(queryClient)}
          />
        }
      />
    );
  }
  return null;
}
