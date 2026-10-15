import { defaultQueueSettings } from "@qpeer/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
  StatusBanner,
  TextField,
} from "@/components/ui";
import { ApiError, useArchiveQueue, useQueue, useUpdateQueue } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { QueueSettingsForm } from "@/screens/queue-settings-form";

/** BIZ-11 rename/archive, BIZ-12 settings, BIZ-14 QR entry point. */
export default function QueueScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useQueue(id);
  const update = useUpdateQueue(id);
  const archive = useArchiveQueue(id);
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  if (!queue.data) {
    return (
      <Screen>
        {queue.isError ? (
          <ErrorState
            title="Could not load this queue"
            error={queue.error}
            onRetry={() => queue.refetch()}
            retrying={queue.isFetching}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const { queue: q, business } = queue.data;
  const archived = q.status === "archived";
  const editedName = name ?? q.name;

  const saveName = async () => {
    const trimmed = editedName.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      setNameError("Enter a queue name of 1 to 40 characters.");
      return;
    }
    setNameError(null);
    try {
      await update.mutateAsync({ name: trimmed });
      setName(null);
    } catch (e) {
      setNameError(errorText(e));
    }
  };

  const onArchive = async () => {
    const ok = await ConfirmDialog.show({
      title: "Archive this queue?",
      message:
        "Customers can no longer find or join it. You can only archive a queue with nobody waiting. This cannot be undone yet.",
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      await archive.mutateAsync(undefined);
    } catch (e) {
      const detail =
        e instanceof ApiError && e.status === 409
          ? `${errorText(e)}\n\nIf people are still waiting, serve or close the queue first.`
          : errorText(e);
      Alert.alert("Could not archive the queue", detail);
    }
  };

  return (
    <Screen
      refreshing={queue.isRefetching}
      onRefresh={() => {
        void queue.refetch();
      }}
    >
      <Stack.Screen options={{ title: q.name }} />

      <StatusBanner
        tone={archived ? "closed" : "active"}
        title={archived ? "Archived" : "Active"}
        detail={
          archived
            ? "Archived queues cannot be edited or joined."
            : `${business.name} · opening and closing for the day comes with the console in Step 2.`
        }
      />

      {!archived ? (
        <ListItem
          icon="qr_code_2"
          title="Show QR code"
          subtitle="Print it or share the join link"
          onPress={() =>
            router.push({ pathname: "/queue/[id]/qr", params: { id } })
          }
        />
      ) : null}

      <SectionHeader title="Name" />
      <Card>
        <TextField
          label="Queue name"
          value={editedName}
          onChangeText={setName}
          error={nameError}
          editable={!archived}
          maxLength={40}
          autoCapitalize="words"
        />
        {!archived && name !== null && name !== q.name ? (
          <Button
            title="Save name"
            onPress={saveName}
            loading={update.isPending}
          />
        ) : null}
      </Card>

      <SectionHeader title="Settings" />
      <QueueSettingsForm
        key={q.id}
        settings={q.settings ?? defaultQueueSettings()}
        disabled={archived}
        onSave={async (settings) => {
          await update.mutateAsync({ settings });
        }}
      />

      {!archived ? (
        <>
          <SectionHeader title="Archive" />
          <Button
            title="Archive queue"
            icon="archive"
            variant="danger-soft"
            onPress={onArchive}
            loading={archive.isPending}
          />
        </>
      ) : null}
    </Screen>
  );
}
