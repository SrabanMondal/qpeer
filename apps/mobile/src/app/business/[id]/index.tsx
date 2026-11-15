import { type Href, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import {
  AppSwitch,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ExpandableSection,
  ListItem,
  LoadingState,
  OverflowMenu,
  Screen,
  SectionHeader,
  StatusBanner,
} from "@/components/ui";
import {
  useBusiness,
  useSetBusinessStatus,
  useUpdateBusiness,
} from "@/lib/api";
import {
  categoryLabel,
  formatLatLng,
  listingStatus,
  todayText,
} from "@/lib/format";
import { useOffline } from "@/lib/network";
import { showErrorToast } from "@/lib/toast";

/**
 * One business (BIZ-07). Job: an owner checks whether it is listed on the
 * map and opens the part to change: profile, pin, hours, queues, payments
 * or the public page. The app bar title is the business name; the rare,
 * serious "Deactivate" sits behind the app bar menu (⋮). The connection
 * strip at the top says when actions are offline.
 */
export default function BusinessScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const offline = useOffline();
  const business = useBusiness(id);
  const setStatus = useSetBusinessStatus(id);
  const update = useUpdateBusiness(id);
  const [showArchived, setShowArchived] = useState(false);

  if (!business.data) {
    return (
      <Screen>
        {business.isError ? (
          <ErrorState
            title="Could not load this business"
            error={business.error}
            onRetry={() => business.refetch()}
            retrying={business.isFetching}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const b = business.data;
  const status = listingStatus(b);
  const active = b.status === "active";
  const activeQueues = b.queues.filter((q) => q.status === "active");
  const archivedQueues = b.queues.filter((q) => q.status === "archived");
  const profileLine = [categoryLabel(b.category), b.address, b.phone]
    .filter(Boolean)
    .join(" · ");

  const onDeactivate = async () => {
    const ok = await ConfirmDialog.show({
      title: "Deactivate business?",
      message:
        "It will be hidden from the map and nobody can join its queues. Your data is kept, and you can activate it again later.",
      confirmLabel: "Deactivate",
    });
    if (!ok) return;
    try {
      await setStatus.mutateAsync(false);
    } catch (e) {
      showErrorToast("Could not deactivate", e);
    }
  };

  const onPublicStats = async (publicStats: boolean) => {
    try {
      await update.mutateAsync({ publicStats });
    } catch (e) {
      showErrorToast("Could not change public stats", e);
    }
  };

  const onActivate = async () => {
    try {
      await setStatus.mutateAsync(true);
    } catch (e) {
      showErrorToast("Could not activate", e);
    }
  };

  const createQueue = () =>
    router.push({ pathname: "/business/[id]/new-queue", params: { id } });

  return (
    <Screen
      refreshing={business.isRefetching}
      onRefresh={() => {
        void business.refetch();
      }}
    >
      <Stack.Screen
        options={{
          title: b.name,
          headerRight: active
            ? () => (
                <OverflowMenu
                  accessibilityLabel="More business actions"
                  disabled={offline || setStatus.isPending}
                  items={[
                    {
                      label: "Deactivate business",
                      destructive: true,
                      onPress: () => void onDeactivate(),
                    },
                  ]}
                />
              )
            : undefined,
        }}
      />

      <StatusBanner
        tone={status.tone}
        title={status.title}
        detail={status.detail}
      />
      {active ? null : (
        // Inactive: activating is this state's one primary action.
        <Button
          title="Activate business"
          size="large"
          icon="storefront"
          onPress={onActivate}
          loading={setStatus.isPending}
          disabled={offline}
        />
      )}

      <SectionHeader title="Set up" />
      <ListItem
        icon="edit"
        title="Edit profile"
        subtitle={profileLine || "Name, category, address, phone"}
        onPress={() =>
          router.push({ pathname: "/business/[id]/edit", params: { id } })
        }
      />
      <ListItem
        icon="location_on"
        title={b.location ? "Move pin" : "Set pin"}
        subtitle={
          b.location
            ? formatLatLng(b.location.lat, b.location.lng)
            : "No pin yet. Needed to show on the map."
        }
        onPress={() =>
          router.push({ pathname: "/business/[id]/location", params: { id } })
        }
      />
      <ListItem
        icon="schedule"
        title="Opening hours"
        subtitle={todayText(b.hours)}
        onPress={() =>
          router.push({ pathname: "/business/[id]/hours", params: { id } })
        }
      />

      <SectionHeader title={`Queues · ${activeQueues.length} active`} />
      {activeQueues.length === 0 ? (
        <EmptyState
          icon="queue"
          title="No queues yet"
          message="Create a queue, such as “OPD” or “Sample collection”. You need at least one to show on the map."
          action={
            <Button title="Create queue" icon="add" onPress={createQueue} />
          }
        />
      ) : (
        <>
          {activeQueues.map((q) => (
            <ListItem
              key={q.id}
              icon="queue"
              title={q.name}
              onPress={() =>
                router.push({ pathname: "/queue/[id]", params: { id: q.id } })
              }
            />
          ))}
          <Button
            title="Create queue"
            icon="add"
            variant="tonal"
            onPress={createQueue}
          />
        </>
      )}
      {archivedQueues.length > 0 ? (
        <ExpandableSection
          title={`Archived (${archivedQueues.length})`}
          summary="Cannot be edited or joined"
          expanded={showArchived}
          onToggle={() => setShowArchived((s) => !s)}
        >
          {archivedQueues.map((q) => (
            <ListItem
              key={q.id}
              icon="archive"
              title={q.name}
              onPress={() =>
                router.push({ pathname: "/queue/[id]", params: { id: q.id } })
              }
            />
          ))}
        </ExpandableSection>
      ) : null}

      {b.myRole === "owner" ? (
        <>
          <SectionHeader title="Money" />
          <ListItem
            icon="receipt_long"
            title="Payments"
            subtitle="Reservations, Priority Passes, refunds and your share"
            onPress={() =>
              router.push(
                `/business/${encodeURIComponent(id)}/payments` as Href,
              )
            }
          />
        </>
      ) : null}

      <SectionHeader title="Public page" />
      {b.myRole === "owner" ? (
        <Card>
          <AppSwitch
            label="Show public stats"
            description="Average wait and service time on your public page. Shown automatically after 14 days on the map."
            value={b.publicStats === true}
            onValueChange={(v) => void onPublicStats(v)}
            disabled={update.isPending || offline}
          />
        </Card>
      ) : null}
      <ListItem
        icon="storefront"
        title="View public page"
        subtitle="What customers see on the map"
        onPress={() =>
          router.push({ pathname: "/business/[id]/public", params: { id } })
        }
      />
    </Screen>
  );
}
