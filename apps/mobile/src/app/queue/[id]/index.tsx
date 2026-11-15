import { CreateQueueBody, defaultQueueSettings } from "@qpeer/shared";
import { type Href, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";

import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  ListItem,
  LoadingState,
  OverflowMenu,
  Screen,
  SectionHeader,
  StatusBanner,
  TextField,
} from "@/components/ui";
import { ApiError, useArchiveQueue, useQueue, useUpdateQueue } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { apiFieldErrors, type FieldErrors, useFieldErrors } from "@/lib/form";
import { useStored } from "@/lib/storage";
import { showErrorToast, showToast } from "@/lib/toast";
import { useUnsavedChangesGuard } from "@/lib/unsaved-changes";
import {
  QueueSettingsForm,
  type QueueSettingsFormHandle,
} from "@/screens/queue-settings-form";

function validateQueueName(name: string): FieldErrors {
  const parsed = CreateQueueBody.shape.name.safeParse(name);
  return parsed.success
    ? {}
    : { name: "Enter a queue name of 1 to 40 characters." };
}

/**
 * BIZ-11 rename/archive, BIZ-12 settings, BIZ-14 QR entry point. Job: an
 * owner shows the queue's QR, renames it or changes its rules (one Save in
 * the pinned bar while anything is unsaved), or archives it (app bar ⋮).
 */
export default function QueueScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useQueue(id);
  const update = useUpdateQueue(id);
  const archive = useArchiveQueue(id);
  const consoleQueue = useStored("consoleQueue");
  const [name, setName] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const nameForm = useFieldErrors(validateQueueName);
  const settingsForm = useRef<QueueSettingsFormHandle>(null);
  // B8: unsaved name or settings edits ask before leaving.
  const nameDirty = name !== null && name !== queue.data?.queue.name;
  useUnsavedChangesGuard(nameDirty || settingsDirty);

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

  const { queue: q } = queue.data;
  const archived = q.status === "archived";
  const editedName = name ?? q.name;

  /** One Save for the name and the settings: one request, one result. */
  const save = async () => {
    const nameOk = !nameDirty || nameForm.validateAll(editedName);
    const settings = settingsDirty ? settingsForm.current?.read() : undefined;
    if (!nameOk || settings === null) return;
    try {
      await update.mutateAsync({
        ...(nameDirty ? { name: editedName.trim() } : {}),
        ...(settings ? { settings } : {}),
      });
      setName(null);
      showToast({
        title: settings ? "Settings saved" : "Name saved",
        tone: "success",
      });
    } catch (e) {
      // The typed values stay; errors go next to their fields.
      const nameError =
        e instanceof ApiError ? apiFieldErrors(e.issues).name : undefined;
      if (nameError) nameForm.showErrors({ name: nameError });
      const onSettings = settingsForm.current?.showApiErrors(e) ?? false;
      if (!nameError && !onSettings) showErrorToast("Could not save", e);
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
      showToast({
        title: "Could not archive the queue",
        message:
          e instanceof ApiError && e.status === 409
            ? `${errorText(e)} If people are still waiting, serve or close the queue first.`
            : errorText(e),
        tone: "danger",
        durationMs: 8000,
      });
    }
  };

  /** Opens the console (Queue tab) on this queue. */
  const runQueue = () => {
    consoleQueue.set(q.id);
    if (router.canDismiss()) router.dismissAll();
    router.navigate("/queue" as Href);
  };

  return (
    <Screen
      refreshing={queue.isRefetching}
      onRefresh={() => {
        void queue.refetch();
      }}
      bottomBar={
        !archived && (nameDirty || settingsDirty) ? (
          <Button
            title="Save"
            size="large"
            icon="check"
            onPress={() => void save()}
            loading={update.isPending}
            needsNetwork
          />
        ) : undefined
      }
    >
      <Stack.Screen
        options={{
          title: q.name,
          headerRight: archived
            ? undefined
            : () => (
                <OverflowMenu
                  accessibilityLabel="More queue actions"
                  disabled={archive.isPending}
                  items={[
                    {
                      label: "Archive queue",
                      destructive: true,
                      onPress: () => void onArchive(),
                    },
                  ]}
                />
              ),
        }}
      />

      {archived ? (
        <StatusBanner
          tone="closed"
          title="Archived"
          detail="Archived queues cannot be edited or joined."
        />
      ) : (
        <>
          <ListItem
            icon="play_circle"
            title="Run this queue"
            subtitle="Open, pause, call next and close it in the console"
            onPress={runQueue}
          />
          <ListItem
            icon="qr_code_2"
            title="Show QR code"
            subtitle="Print it or share the join link"
            onPress={() =>
              router.push({ pathname: "/queue/[id]/qr", params: { id } })
            }
          />
        </>
      )}

      <SectionHeader title="Name" />
      <Card>
        <TextField
          label="Queue name"
          value={editedName}
          onChangeText={(v) => {
            setName(v);
            nameForm.revalidate(v, "name");
          }}
          error={nameForm.errors.name}
          editable={!archived}
          maxLength={40}
          autoCapitalize="words"
        />
      </Card>

      <SectionHeader title="Settings" />
      <QueueSettingsForm
        key={q.id}
        ref={settingsForm}
        settings={q.settings ?? defaultQueueSettings()}
        disabled={archived}
        onDirtyChange={setSettingsDirty}
      />
    </Screen>
  );
}
