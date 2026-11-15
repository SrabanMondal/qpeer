import { CreateQueueBody } from "@qpeer/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { ThemedText } from "@/components/themed-text";
import { Button, Screen, TextField } from "@/components/ui";
import { useCreateQueue } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { type FieldErrors, useFieldErrors } from "@/lib/form";

/** BIZ-10: create a queue with default settings, then open it. */
export default function NewQueueScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const create = useCreateQueue(id);
  const [name, setName] = useState("");
  const form = useFieldErrors(
    (value: string): FieldErrors =>
      CreateQueueBody.shape.name.safeParse(value).success
        ? {}
        : { name: "Enter a queue name of 1 to 40 characters." },
  );

  const submit = async () => {
    if (!form.validateAll(name)) return;
    try {
      const queue = await create.mutateAsync({ name: name.trim() });
      router.replace({ pathname: "/queue/[id]", params: { id: queue.id } });
    } catch (e) {
      form.showErrors({ name: errorText(e) });
    }
  };

  return (
    <Screen>
      <TextField
        label="Queue name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          form.revalidate(v, "name");
        }}
        error={form.errors.name}
        placeholder="e.g. OPD, Sample collection"
        autoFocus
        maxLength={40}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        The queue starts with default settings. You can change them next.
      </ThemedText>
      <Button
        title="Create queue"
        size="large"
        icon="add"
        onPress={submit}
        loading={create.isPending}
        needsNetwork
      />
    </Screen>
  );
}
