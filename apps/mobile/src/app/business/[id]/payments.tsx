import { Stack, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
} from "@/components/ui";
import { useBusiness, useBusinessPayments } from "@/lib/api";
import { useOffline } from "@/lib/network";
import { PaymentRow } from "@/screens/payment-list";

/**
 * Owner: a business's payments with the net split from the ledger (PAY-11,
 * business side). Shares are after refunds; a forfeited fee keeps its split.
 */
export default function BusinessPaymentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = id ?? "";
  const offline = useOffline();
  const business = useBusiness(businessId);
  const payments = useBusinessPayments(businessId);
  const items = payments.data?.pages.flatMap((p) => p.items) ?? [];

  let body: ReactNode;
  if (payments.isPending) {
    body = offline ? (
      <EmptyState
        icon="cloud_off"
        title="Payments need internet"
        message="They show as soon as you're online."
      />
    ) : (
      <LoadingState label="Loading payments…" />
    );
  } else if (payments.isError && items.length === 0) {
    body = (
      <ErrorState
        title="Could not load payments"
        error={payments.error}
        onRetry={() => payments.refetch()}
        retrying={payments.isFetching}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon="receipt_long"
        title="No payments yet"
        message="Reservations, Priority Passes and Skip ahead payments for your queues show here, with your share."
      />
    );
  } else {
    body = (
      <>
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          Walk-ins pay you directly, outside Qpeer.
        </ThemedText>
        {items.map((p) => (
          <PaymentRow key={p.id} payment={p} showBusiness={false} />
        ))}
        {payments.hasNextPage ? (
          <Button
            title="Show older payments"
            variant="tonal"
            loading={payments.isFetchingNextPage}
            onPress={() => void payments.fetchNextPage()}
            needsNetwork
          />
        ) : null}
      </>
    );
  }

  return (
    <Screen
      refreshing={payments.isRefetching}
      onRefresh={() => {
        void payments.refetch();
      }}
    >
      <Stack.Screen
        options={{
          title: business.data
            ? `Payments · ${business.data.name}`
            : "Payments",
        }}
      />
      {body}
    </Screen>
  );
}
