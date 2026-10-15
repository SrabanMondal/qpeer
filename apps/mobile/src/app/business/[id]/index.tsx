import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  InfoRow,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
  StatusBanner,
} from "@/components/ui";
import { useBusiness, useSetBusinessStatus } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import {
  categoryLabel,
  formatLatLng,
  listingStatus,
  todayText,
} from "@/lib/format";

/** One business: summary, listing status (BIZ-07) and every section to edit. */
export default function BusinessScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useBusiness(id);
  const setStatus = useSetBusinessStatus(id);

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
  const activeQueues = b.queues.filter((q) => q.status === "active");
  const archivedQueues = b.queues.filter((q) => q.status === "archived");

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
      Alert.alert("Could not deactivate", errorText(e));
    }
  };

  const onActivate = async () => {
    try {
      await setStatus.mutateAsync(true);
    } catch (e) {
      Alert.alert("Could not activate", errorText(e));
    }
  };

  return (
    <Screen
      refreshing={business.isRefetching}
      onRefresh={() => {
        void business.refetch();
      }}
    >
      <Stack.Screen options={{ title: b.name }} />

      <StatusBanner
        tone={status.tone}
        title={status.title}
        detail={status.detail}
      />

      <Card>
        <ThemedText type="title">{b.name}</ThemedText>
        <InfoRow label="Category" value={categoryLabel(b.category)} />
        <InfoRow label="Address" value={b.address || "—"} />
        <InfoRow label="Phone" value={b.phone ?? "—"} />
        <InfoRow label="Today" value={todayText(b.hours)} />
      </Card>

      <SectionHeader title="Profile" />
      <ListItem
        icon="edit"
        title="Edit profile"
        subtitle="Name, category, address, phone"
        onPress={() =>
          router.push({ pathname: "/business/[id]/edit", params: { id } })
        }
      />

      <SectionHeader title="Location" />
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

      <SectionHeader title="Hours" />
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
        />
      ) : null}
      {[...activeQueues, ...archivedQueues].map((q) => (
        <ListItem
          key={q.id}
          icon="queue"
          title={q.name}
          footer={
            q.status === "archived" ? (
              <Badge label="Archived" tone="neutral" />
            ) : null
          }
          onPress={() =>
            router.push({ pathname: "/queue/[id]", params: { id: q.id } })
          }
        />
      ))}
      <Button
        title="Create queue"
        icon="add"
        variant="secondary"
        onPress={() =>
          router.push({ pathname: "/business/[id]/new-queue", params: { id } })
        }
      />

      <SectionHeader title="Status" />
      {b.status === "active" ? (
        <Button
          title="Deactivate business"
          variant="danger-soft"
          onPress={onDeactivate}
          loading={setStatus.isPending}
        />
      ) : (
        <Button
          title="Activate business"
          variant="brand"
          onPress={onActivate}
          loading={setStatus.isPending}
        />
      )}
    </Screen>
  );
}
