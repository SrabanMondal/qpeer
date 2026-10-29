import {
  QUEUE_SETTINGS_DEFAULTS,
  type QueueSettings,
  QueueSettingsPatch,
  TICKET_VALIDITY_PRESETS_MIN,
  ticketValidityLabel,
} from "@qpeer/shared";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ChoiceChips,
  SectionHeader,
  TextField,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { apiFieldErrors, type FieldErrors, useFieldErrors } from "@/lib/form";
import { formatRupees, paiseToRupeesText } from "@/lib/format";
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";

/** Plain number settings (the Step 4 switch/nullable ones need their own inputs). */
type SettingKey = {
  [K in keyof QueueSettings]: QueueSettings[K] extends number ? K : never;
}[keyof QueueSettings];

type FieldSpec = {
  key: SettingKey;
  label: string;
  /** "rupees": edited in ₹, stored in paise. */
  kind: "int" | "rupees";
  unit: string;
  help?: string;
};

/** The fields owners edit in v1 (BIZ-12), grouped as on the design. */
const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Joining",
    fields: [
      {
        key: "joinRadiusM",
        label: "Join radius",
        kind: "int",
        unit: "m",
        help: "Walk-in check: GPS. People must be this close to your pin to join in person.",
      },
      {
        key: "maxSize",
        label: "Max queue size",
        kind: "int",
        unit: "people",
      },
      {
        key: "walkinQuotaPct",
        label: "Walk-in share",
        kind: "int",
        unit: "%",
        help: "Share of places kept for people who are physically here.",
      },
    ],
  },
  {
    title: "Fees",
    fields: [
      {
        key: "reservationFeePaise",
        label: "Reservation fee",
        kind: "rupees",
        unit: "₹",
      },
      {
        key: "priorityFeePaise",
        label: "Priority fee",
        kind: "rupees",
        unit: "₹",
      },
    ],
  },
  {
    title: "Timing",
    fields: [
      {
        key: "graceMinutes",
        label: "Grace time",
        kind: "int",
        unit: "min",
        help: "How long a called person has to arrive.",
      },
      {
        key: "cancelWindowMin",
        label: "Cancel window",
        kind: "int",
        unit: "min",
        help: "Paid reservations can be cancelled up to this long before.",
      },
      {
        key: "serviceMinutesHint",
        label: "Typical service time",
        kind: "int",
        unit: "min",
        help: "Used for wait estimates until real data exists.",
      },
    ],
  },
  {
    title: "Counters",
    fields: [
      {
        key: "counters",
        label: "Counters serving this queue",
        kind: "int",
        unit: "",
      },
    ],
  },
];

const FIELDS = GROUPS.flatMap((g) => g.fields);

function bounds(key: SettingKey): { min: number; max: number } {
  const num = QueueSettingsPatch.shape[key].unwrap();
  return { min: num.minValue ?? 0, max: num.maxValue ?? 0 };
}

function show(spec: FieldSpec, value: number): string {
  return spec.kind === "rupees" ? formatRupees(value) : `${value} ${spec.unit}`;
}

function rangeText(spec: FieldSpec): string {
  const { min, max } = bounds(spec.key);
  return `${show(spec, min)} to ${show(spec, max)}`.trim();
}

function toText(spec: FieldSpec, value: number): string {
  return spec.kind === "rupees" ? paiseToRupeesText(value) : String(value);
}

/** Parses the typed text; null when it is not a number in the right format. */
function fromText(spec: FieldSpec, text: string): number | null {
  const t = text.trim();
  if (spec.kind === "rupees") {
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(Number(t) * 100);
  }
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

type Texts = Record<string, string>;

function textsOf(settings: QueueSettings): Texts {
  return Object.fromEntries(
    FIELDS.map((f) => [f.key, toText(f, settings[f.key])]),
  );
}

/** Reads every field; `errors` is empty when all are in range. */
function readTexts(text: Texts): {
  patch: Record<string, number>;
  errors: FieldErrors;
} {
  const patch: Record<string, number> = {};
  const errors: FieldErrors = {};
  for (const f of FIELDS) {
    const value = fromText(f, text[f.key] ?? "");
    const { min, max } = bounds(f.key);
    if (value === null || value < min || value > max) {
      errors[f.key] =
        f.kind === "rupees"
          ? `Enter an amount from ${rangeText(f)}, e.g. 20 or 20.50.`
          : `Enter a whole number from ${rangeText(f)}.`;
    } else {
      patch[f.key] = value;
    }
  }
  return { patch, errors };
}

/**
 * BIZ-12: queue settings with defaults; saved with PATCH /v1/queues/:id.
 * Errors clear as soon as a field becomes valid (B4); `onDirtyChange`
 * reports unsaved edits so the screen can guard leaving (B8).
 */
export function QueueSettingsForm({
  settings,
  disabled,
  onSave,
  onDirtyChange,
}: {
  settings: QueueSettings;
  disabled: boolean;
  onSave: (patch: QueueSettingsPatch) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [text, setText] = useState<Texts>(() => textsOf(settings));
  // C4: ticket validity is a choice of presets, not a typed number.
  const savedValidity = settings.ticketValidityMin ?? 0;
  const [validity, setValidity] = useState<number>(savedValidity);
  const form = useFieldErrors((t: Texts) => readTexts(t).errors);
  const { errors } = form;
  const [saving, setSaving] = useState(false);
  const offline = useOffline();
  const validityOptions = [
    ...new Set<number>([...TICKET_VALIDITY_PRESETS_MIN, savedValidity]),
  ]
    .sort((a, b) => a - b)
    .map((m) => ({ value: String(m), label: ticketValidityLabel(m) }));

  // Compared by value with the saved settings ("20" = "20.00"), so after a
  // successful save the form is clean again.
  const dirty =
    validity !== savedValidity ||
    FIELDS.some((f) => fromText(f, text[f.key] ?? "") !== settings[f.key]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (!form.validateAll(text)) return;
    const parsed = QueueSettingsPatch.safeParse({
      ...readTexts(text).patch,
      ticketValidityMin: validity,
    });
    if (!parsed.success) return;
    setSaving(true);
    try {
      await onSave(parsed.data);
      Alert.alert("Settings saved", "Changes apply to new tokens.");
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) {
        // API paths look like "settings.joinRadiusM".
        const byField: FieldErrors = {};
        for (const [path, msg] of Object.entries(apiFieldErrors(e.issues))) {
          byField[path.replace(/^settings\./, "")] = msg;
        }
        form.showErrors(byField);
      } else {
        Alert.alert("Could not save settings", errorText(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ThemedText type="small" themeColor="inkMuted">
        Changes apply to new tokens. People already in the queue keep the rules
        they joined with.
      </ThemedText>
      {GROUPS.map((group) => (
        <View key={group.title} style={{ gap: Spacing.three }}>
          <SectionHeader title={group.title} />
          <Card>
            {group.fields.map((f) => (
              <TextField
                key={f.key}
                label={f.unit ? `${f.label} (${f.unit})` : f.label}
                value={text[f.key] ?? ""}
                onChangeText={(v) => {
                  const next = { ...text, [f.key]: v };
                  setText(next);
                  form.revalidate(next, f.key);
                }}
                keyboardType={
                  f.kind === "rupees" ? "decimal-pad" : "number-pad"
                }
                editable={!disabled}
                error={errors[f.key]}
                hint={[
                  f.help,
                  `Default ${show(f, QUEUE_SETTINGS_DEFAULTS[f.key])}. Allowed ${rangeText(f)}.`,
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
          </Card>
        </View>
      ))}
      <SectionHeader title="Ticket validity" />
      <Card>
        <ChoiceChips
          label="A ticket stays valid"
          options={validityOptions}
          value={String(validity)}
          onChange={(v) => setValidity(Number(v))}
          disabled={disabled}
        />
        <ThemedText type="small" themeColor="inkMuted">
          {validity === 0
            ? "Tickets end when you close the queue (the default)."
            : `Tickets end ${ticketValidityLabel(validity)} after joining. If the queue closes earlier, waiting tickets that are still valid are kept and served first, with their number, when you open again.`}
        </ThemedText>
      </Card>
      <Button
        title="Save settings"
        onPress={save}
        loading={saving}
        disabled={disabled || offline}
      />
      {offline ? (
        <ThemedText type="small" themeColor="inkMuted">
          {OFFLINE_ACTION_TEXT}
        </ThemedText>
      ) : null}
    </>
  );
}
