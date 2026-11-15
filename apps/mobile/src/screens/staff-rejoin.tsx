import {
  CHECK_CODE_LENGTH,
  type ConsoleToken,
  normalizeCheckCode,
  parseTokenLabel,
} from "@qpeer/shared";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Sheet, TextField } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { ApiError, useStaffRejoin } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { useOffline } from "@/lib/network";
import { peopleAheadText } from "@/lib/queue-format";
import { showToast } from "@/lib/toast";

type Errors = { label?: string; code?: string };

/** Text for a staff rejoin error (R2: no match → 404; once only → 409). */
export function staffRejoinError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "not_found") {
      return "No missed ticket matches this number and check code. Check both with the customer, or add them as a new walk-in.";
    }
    if (e.code === "invalid_state") {
      return "This ticket can't rejoin: it isn't missed, or it already rejoined once.";
    }
    if (e.code === "queue_closed") return "The queue is closed.";
  }
  return errorText(e);
}

/**
 * R2 / QUE-29 "Rejoin for customer" as an M3 bottom sheet: after a missed
 * turn, staff type the ticket number + its 4-character check code (when
 * the customer's phone is dead), or scan the ticket QR from "Verify a
 * ticket". Same once-only and position rule as "I'm here"; staff never pick
 * the position. Swipe down, Back or the scrim closes it.
 */
export function StaffRejoinSheet({
  visible,
  queueId,
  prefill,
  onClose,
  onScan,
}: {
  visible: boolean;
  queueId: string;
  /** Pre-filled from a row of the Missed list; null for a blank form. */
  prefill: ConsoleToken | null;
  onClose: () => void;
  onScan: () => void;
}) {
  return (
    <Sheet visible={visible} onDismiss={onClose} title="Rejoin for customer">
      <StaffRejoinForm
        // A fresh form for each row (or the blank form).
        key={prefill?.id ?? "blank"}
        queueId={queueId}
        prefill={prefill}
        onDone={onClose}
        onScan={() => {
          onClose();
          onScan();
        }}
      />
    </Sheet>
  );
}

function StaffRejoinForm({
  queueId,
  prefill,
  onDone,
  onScan,
}: {
  queueId: string;
  prefill: ConsoleToken | null;
  onDone: () => void;
  onScan: () => void;
}) {
  const offline = useOffline();
  const rejoin = useStaffRejoin(queueId);
  const [label, setLabel] = useState(prefill?.label ?? "");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    const next: Errors = {};
    if (!parseTokenLabel(label))
      next.label = "Enter the ticket number, e.g. 14 or P3.";
    if (!normalizeCheckCode(code)) {
      next.code = `Enter the ${CHECK_CODE_LENGTH}-character check code under the number, e.g. K7P2.`;
    }
    setErrors(next);
    setFailure(null);
    if (next.label || next.code) return;
    try {
      const r = await rejoin.mutateAsync({
        label: label.trim().toUpperCase(),
        checkCode: code.trim().toUpperCase(),
      });
      const t = r.token;
      showToast({
        title: `#${t.label} is back in the line`,
        message:
          t.state === "WAITING"
            ? `${peopleAheadText(t.peopleAhead, t.peopleAheadHigh)} ahead of them.`
            : undefined,
        tone: "success",
      });
      setLabel("");
      setCode("");
      onDone();
    } catch (e) {
      setFailure(staffRejoinError(e));
    }
  };

  return (
    <View style={styles.form}>
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        For a missed ticket whose phone is dead: ask for the number and the
        check code under it. The ticket goes back in by the rejoin rule, once.
      </ThemedText>
      <View style={styles.fields}>
        <View style={styles.field}>
          <TextField
            label="Ticket number"
            value={label}
            onChangeText={(v) => {
              setLabel(v);
              if (errors.label) setErrors({ ...errors, label: undefined });
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            placeholder="14"
            error={errors.label}
          />
        </View>
        <View style={styles.field}>
          <TextField
            label="Check code"
            value={code}
            onChangeText={(v) => {
              setCode(v);
              if (errors.code) setErrors({ ...errors, code: undefined });
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            placeholder="K7P2"
            error={errors.code}
          />
        </View>
      </View>
      {failure ? (
        <ThemedText type="bodyMedium" themeColor="error">
          {failure}
        </ThemedText>
      ) : null}
      <Button
        title="Rejoin for customer"
        size="large"
        icon="restart_alt"
        loading={rejoin.isPending}
        disabled={offline}
        onPress={() => void submit()}
      />
      <Button
        title="Scan their ticket instead"
        variant="text"
        icon="qr_code_scanner"
        onPress={onScan}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.twoHalf },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.twoHalf },
  field: { flexGrow: 1, flexBasis: 120 },
});
