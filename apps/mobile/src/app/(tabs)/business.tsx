import { Redirect, useRouter } from "expo-router";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  Screen,
} from "@/components/ui";
import { useMyBusinesses } from "@/lib/api";
import { categoryLabel, listingBadge } from "@/lib/format";
import { useAppMode } from "@/lib/mode";

/**
 * Business mode home: the owner's businesses (BIZ-09, BIZ-15). The top
 * app bar with the mode switch is set in `(tabs)/_layout.tsx`.
 */
export default function BusinessTab() {
  const router = useRouter();
  const { mode } = useAppMode();
  const list = useMyBusinesses(mode === "business");

  if (mode !== "business") return <Redirect href="/" />;

  const create = () => router.push("/business/new");

  return (
    <Screen
      bottomInset={false}
      refreshing={list.isRefetching}
      onRefresh={() => {
        void list.refetch();
      }}
    >
      {list.isPending ? (
        <LoadingState label="Loading your businesses…" />
      ) : list.isError ? (
        <ErrorState
          title="Could not load your businesses"
          error={list.error}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon="storefront"
          title="Create your first business"
          message="Add your clinic, lab, salon or service centre, then create a queue for it."
          action={
            <Button title="Create business" icon="add" onPress={create} />
          }
        />
      ) : (
        <>
          {list.data.items.map((b) => {
            const badge = listingBadge(b);
            return (
              <ListItem
                key={b.id}
                icon="storefront"
                title={b.name}
                subtitle={[categoryLabel(b.category), b.address]
                  .filter(Boolean)
                  .join(" · ")}
                footer={<Badge label={badge.label} tone={badge.tone} />}
                accessibilityLabel={`${b.name}, ${badge.label}`}
                onPress={() =>
                  router.push({
                    pathname: "/business/[id]",
                    params: { id: b.id },
                  })
                }
              />
            );
          })}
          <Button
            title="Add another business"
            icon="add"
            variant="outlined"
            onPress={create}
          />
        </>
      )}
    </Screen>
  );
}
