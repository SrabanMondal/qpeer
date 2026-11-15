import { Stack, useRouter } from "expo-router";
import type { ReactNode } from "react";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
} from "@/components/ui";
import { useMyPayments } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOffline } from "@/lib/network";
import { PaymentRow } from "@/screens/payment-list";

/** Profile → My payments (PAY-11): status paid / refunded x% / forfeited. */
export default function MyPaymentsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const offline = useOffline();
  const payments = useMyPayments();
  const items = payments.data?.pages.flatMap((p) => p.items) ?? [];

  let body: ReactNode;
  if (!user || user.isAnonymous) {
    body = (
      <EmptyState
        icon="receipt_long"
        title="No payments"
        message="Payments need a phone or Google sign-in. Free tickets never appear here."
        action={
          <Button
            title="Sign in"
            icon="login"
            onPress={() => router.push("/sign-in")}
          />
        }
      />
    );
  } else if (payments.isPending) {
    body = offline ? (
      <EmptyState
        icon="cloud_off"
        title="Payments need internet"
        message="They show as soon as you're online."
      />
    ) : (
      <LoadingState label="Loading your payments…" />
    );
  } else if (payments.isError && items.length === 0) {
    body = (
      <ErrorState
        title="Could not load your payments"
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
        message="Reservations, Priority Passes and Skip ahead payments show here, with any refund."
      />
    );
  } else {
    body = (
      <>
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          Test mode: no real money moves in this version. Refunds take 5–7 days
          to reach a real account.
        </ThemedText>
        {items.map((p) => (
          <PaymentRow
            key={p.id}
            payment={p}
            onPress={
              p.tokenId
                ? () =>
                    router.push({
                      pathname: "/token/[id]",
                      params: { id: p.tokenId ?? "" },
                    })
                : undefined
            }
          />
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
      <Stack.Screen options={{ title: "My payments" }} />
      {body}
    </Screen>
  );
}
