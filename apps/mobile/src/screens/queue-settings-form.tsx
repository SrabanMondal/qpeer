import {
  MIN_ORDER_PAISE,
  PRIORITY_PER_REGULAR_PREFILL,
  PRIORITY_VALIDITY_PRESETS_MIN,
  QUEUE_SETTINGS_DEFAULTS,
  type QueueSettings,
  QueueSettingsPatch,
  TICKET_VALIDITY_PRESETS_MIN,
  ticketValidityLabel,
} from "@qpeer/shared";
import { type Ref, useEffect, useImperativeHandle, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  AppSwitch,
  Card,
  ChoiceChips,
  ExpandableSection,
  SectionHeader,
  TextField,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { ApiError } from "@/lib/api";
import { apiFieldErrors, type FieldErrors, useFieldErrors } from "@/lib/form";
import { formatRupees, paiseToRupeesText } from "@/lib/format";

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

type GroupId = "joining" | "reservations" | "timing";

/** The fields owners edit in v1 (BIZ-12), grouped as on the design. */
const GROUPS: { id: GroupId; title: string; fields: FieldSpec[] }[] = [
  {
    id: "joining",
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
    id: "reservations",
    title: "Reservations",
    fields: [
      {
        key: "reservationFeePaise",
        label: "Reservation fee",
        kind: "rupees",
        unit: "₹",
        help: "What a customer pays to hold a place from home. Below ₹1 a fee can't be paid online, so nobody can reserve.",
      },
      {
        key: "cancelWindowMin",
        label: "Cancel window",
        kind: "int",
        unit: "min",
        help: "A reservation cancelled at least this long before its estimated turn is refunded in full.",
      },
    ],
  },
  {
    id: "timing",
    title: "Timing",
    fields: [
      {
        key: "graceMinutes",
        label: "Grace time",
        kind: "int",
        unit: "min",
        help: "How long a called person has to arrive. After that their turn is missed.",
      },
      {
        key: "rejoinDelayMin",
        label: "Rejoin delay",
        kind: "int",
        unit: "min",
        help: "After a missed turn, I'm here puts the person back behind about this many minutes of service (also used by Skip).",
      },
      {
        key: "serviceMinutesHint",
        label: "Typical service time",
        kind: "int",
        unit: "min",
        help: "Used for wait estimates until real data exists.",
      },
      {
        key: "counters",
        label: "Counters serving this queue",
        kind: "int",
        unit: "",
      },
    ],
  },
];

/** Priority Pass fields (PRI-01), checked and saved only while the lane is on. */
const PRIORITY_FIELDS: FieldSpec[] = [
  {
    key: "priorityFeePaise",
    label: "Pass price",
    kind: "rupees",
    unit: "₹",
    help: "Price of a Priority Pass and of Skip ahead (₹1 or more).",
  },
  {
    key: "priorityPerRegular",
    label: "1 priority per N regulars",
    kind: "int",
    unit: "",
    help: "N: after every N regular calls, the next priority holder is called. 2 means 1 in 2.",
  },
  {
    key: "priorityCancelRefundPct",
    label: "Refund if cancelled before check-in",
    kind: "int",
    unit: "%",
  },
  {
    key: "upgradeMinSavingMin",
    label: "Show Skip ahead from a saving of",
    kind: "int",
    unit: "min",
    help: "Below this saving the offer is hidden, so nobody pays to save almost nothing.",
  },
];

const FIELDS = GROUPS.flatMap((g) => g.fields);
const RESERVATION_KEYS = new Set<string>(
  GROUPS.find((g) => g.id === "reservations")?.fields.map((f) => f.key),
);
const PRIORITY_KEYS = new Set<string>([
  ...PRIORITY_FIELDS.map((f) => f.key),
  "priorityDailyCap",
]);

function bounds(key: SettingKey): { min: number; max: number } {
  const num = QueueSettingsPatch.shape[key].unwrap();
  return { min: num.minValue ?? 0, max: num.maxValue ?? 0 };
}

/** Bounds of the two "number or none" settings. */
const CAP_BOUNDS = QueueSettingsPatch.shape.priorityDailyCap.unwrap().unwrap();
const LATE_BOUNDS = QueueSettingsPatch.shape.lateWindowMin.unwrap().unwrap();

/** "Until the end of today", "2 h", "1 day" (0 = end of today, IST). */
function passValidityLabel(minutes: number): string {
  return minutes <= 0 ? "Until the end of today" : ticketValidityLabel(minutes);
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

/** Everything the form edits besides the chips. */
type Values = {
  text: Texts;
  /** PRI-01 priority lane switch. */
  priorityOn: boolean;
  /** R1 late window: "No limit" (null). */
  noLateLimit: boolean;
};

function textsOf(settings: QueueSettings): Texts {
  return {
    ...Object.fromEntries(
      [...FIELDS, ...PRIORITY_FIELDS].map((f) => [
        f.key,
        toText(f, settings[f.key]),
      ]),
    ),
    priorityDailyCap:
      settings.priorityDailyCap === null
        ? ""
        : String(settings.priorityDailyCap),
    lateWindowMin:
      settings.lateWindowMin === null
        ? String(QUEUE_SETTINGS_DEFAULTS.lateWindowMin)
        : String(settings.lateWindowMin),
  };
}

function readField(
  f: FieldSpec,
  text: Texts,
  patch: Record<string, number | boolean | null>,
  errors: FieldErrors,
) {
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

/** A whole number in bounds, or null when the text isn't one. */
function wholeIn(
  text: string | undefined,
  b: { minValue: number | null; maxValue: number | null },
): number | null {
  const t = (text ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n < (b.minValue ?? 0) || n > (b.maxValue ?? n) ? null : n;
}

/**
 * Reads every field; `errors` is empty when all are in range. The priority
 * fields are read only while the lane is switched on (off keeps the saved
 * values for the next time it is switched on).
 */
function readValues(v: Values): {
  patch: Record<string, number | boolean | null>;
  errors: FieldErrors;
} {
  const patch: Record<string, number | boolean | null> = {};
  const errors: FieldErrors = {};
  for (const f of FIELDS) readField(f, v.text, patch, errors);

  if (v.noLateLimit) patch.lateWindowMin = null;
  else {
    const late = wholeIn(v.text.lateWindowMin, LATE_BOUNDS);
    if (late === null) {
      errors.lateWindowMin = `Enter a whole number of minutes from ${LATE_BOUNDS.minValue} to ${LATE_BOUNDS.maxValue}, or switch on No limit.`;
    } else patch.lateWindowMin = late;
  }

  patch.priorityEnabled = v.priorityOn;
  if (v.priorityOn) {
    for (const f of PRIORITY_FIELDS) readField(f, v.text, patch, errors);
    const fee = patch.priorityFeePaise;
    if (typeof fee === "number" && fee < MIN_ORDER_PAISE) {
      errors.priorityFeePaise = `A pass must cost at least ${formatRupees(MIN_ORDER_PAISE)} to be paid online.`;
    }
    const capText = (v.text.priorityDailyCap ?? "").trim();
    if (capText === "") patch.priorityDailyCap = null;
    else {
      const cap = wholeIn(capText, CAP_BOUNDS);
      if (cap === null) {
        errors.priorityDailyCap = `Enter a whole number from ${CAP_BOUNDS.minValue} to ${CAP_BOUNDS.maxValue}, or leave it empty for no cap.`;
      } else patch.priorityDailyCap = cap;
    }
  }
  return { patch, errors };
}

/** One numeric setting with its help and default; the range shows only in the error. */
function SettingField({
  spec: f,
  value,
  onChange,
  disabled,
  error,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  return (
    <TextField
      label={f.unit ? `${f.label} (${f.unit})` : f.label}
      value={value}
      onChangeText={onChange}
      keyboardType={f.kind === "rupees" ? "decimal-pad" : "number-pad"}
      editable={!disabled}
      error={error}
      hint={[f.help, `Default ${show(f, QUEUE_SETTINGS_DEFAULTS[f.key])}.`]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/** "₹20" from the typed text, or the text itself while it isn't a number. */
function typedRupees(text: string | undefined): string {
  const t = (text ?? "").trim();
  return /^\d+(\.\d{1,2})?$/.test(t)
    ? formatRupees(Math.round(Number(t) * 100))
    : t || "—";
}

export type QueueSettingsFormHandle = {
  /**
   * Validates every field. Returns the settings to send, or null when a
   * field is wrong: the errors are shown and their sections opened.
   */
  read: () => QueueSettingsPatch | null;
  /**
   * Shows the API's field errors (paths "settings.x"). Returns true when at
   * least one belonged to this form.
   */
  showApiErrors: (e: unknown) => boolean;
};

/**
 * BIZ-12: queue settings with defaults. The screen saves them (one Save in
 * its pinned bar, together with the name) through `ref`. Errors clear as
 * soon as a field becomes valid (B4); `onDirtyChange` reports unsaved edits
 * so the screen can guard leaving (B8) and show its Save. Reservations and
 * the Priority Pass start collapsed, with their current values in the
 * header.
 */
export function QueueSettingsForm({
  settings,
  disabled,
  onDirtyChange,
  ref,
}: {
  settings: QueueSettings;
  disabled: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  ref?: Ref<QueueSettingsFormHandle>;
}) {
  const [values, setValues] = useState<Values>(() => ({
    text: textsOf(settings),
    priorityOn: settings.priorityEnabled,
    noLateLimit: settings.lateWindowMin === null,
  }));
  const { text } = values;
  // C4: ticket validity is a choice of presets, not a typed number.
  const savedValidity = settings.ticketValidityMin ?? 0;
  const [validity, setValidity] = useState<number>(savedValidity);
  const savedPassValidity = settings.priorityValidityMin;
  const [passValidity, setPassValidity] = useState<number>(savedPassValidity);
  const form = useFieldErrors((v: Values) => readValues(v).errors);
  const { errors } = form;
  const [openReservations, setOpenReservations] = useState(false);
  const [openPriority, setOpenPriority] = useState(false);
  const validityOptions = [
    ...new Set<number>([...TICKET_VALIDITY_PRESETS_MIN, savedValidity]),
  ]
    .sort((a, b) => a - b)
    .map((m) => ({ value: String(m), label: ticketValidityLabel(m) }));
  const passValidityOptions = [
    ...new Set<number>([...PRIORITY_VALIDITY_PRESETS_MIN, savedPassValidity]),
  ]
    .sort((a, b) => a - b)
    .map((m) => ({ value: String(m), label: passValidityLabel(m) }));

  const setText = (key: string, v: string) => {
    const next = { ...values, text: { ...values.text, [key]: v } };
    setValues(next);
    form.revalidate(next, key);
  };

  const setPriorityOn = (on: boolean) => {
    // PRI-01: switching on prefills "1 in 2" unless the lane was on before.
    const nextText =
      on && !settings.priorityEnabled
        ? {
            ...values.text,
            priorityPerRegular: String(PRIORITY_PER_REGULAR_PREFILL),
          }
        : values.text;
    const next = { ...values, priorityOn: on, text: nextText };
    setValues(next);
    for (const f of PRIORITY_FIELDS) form.revalidate(next, f.key);
    form.revalidate(next, "priorityDailyCap");
  };

  const setNoLateLimit = (noLimit: boolean) => {
    const next = { ...values, noLateLimit: noLimit };
    setValues(next);
    form.revalidate(next, "lateWindowMin");
  };

  /** Opens the collapsed sections that hold one of these errors. */
  const openSectionsFor = (errs: FieldErrors) => {
    const keys = Object.keys(errs);
    if (keys.some((k) => RESERVATION_KEYS.has(k))) setOpenReservations(true);
    if (keys.some((k) => PRIORITY_KEYS.has(k))) setOpenPriority(true);
  };

  useImperativeHandle(ref, () => ({
    read: () => {
      const { errors: errs } = readValues(values);
      if (!form.validateAll(values)) {
        openSectionsFor(errs);
        return null;
      }
      const parsed = QueueSettingsPatch.safeParse({
        ...readValues(values).patch,
        ticketValidityMin: validity,
        ...(values.priorityOn ? { priorityValidityMin: passValidity } : {}),
      });
      return parsed.success ? parsed.data : null;
    },
    showApiErrors: (e: unknown) => {
      if (!(e instanceof ApiError) || e.issues.length === 0) return false;
      // API paths look like "settings.joinRadiusM".
      const byField: FieldErrors = {};
      for (const [path, msg] of Object.entries(apiFieldErrors(e.issues))) {
        if (path.startsWith("settings.")) {
          byField[path.replace(/^settings\./, "")] = msg;
        }
      }
      if (Object.keys(byField).length === 0) return false;
      form.showErrors(byField);
      openSectionsFor(byField);
      return true;
    },
  }));

  // Compared by value with the saved settings ("20" = "20.00"), so after a
  // successful save the form is clean again.
  const capText = (text.priorityDailyCap ?? "").trim();
  const savedCapText =
    settings.priorityDailyCap === null ? "" : String(settings.priorityDailyCap);
  const dirty =
    validity !== savedValidity ||
    FIELDS.some((f) => fromText(f, text[f.key] ?? "") !== settings[f.key]) ||
    values.noLateLimit !== (settings.lateWindowMin === null) ||
    (!values.noLateLimit &&
      (text.lateWindowMin ?? "").trim() !== String(settings.lateWindowMin)) ||
    values.priorityOn !== settings.priorityEnabled ||
    (values.priorityOn &&
      (passValidity !== savedPassValidity ||
        capText !== savedCapText ||
        PRIORITY_FIELDS.some(
          (f) => fromText(f, text[f.key] ?? "") !== settings[f.key],
        )));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const fields = (group: (typeof GROUPS)[number]) =>
    group.fields.map((f) => (
      <SettingField
        key={f.key}
        spec={f}
        value={text[f.key] ?? ""}
        onChange={(v) => setText(f.key, v)}
        disabled={disabled}
        error={errors[f.key]}
      />
    ));
  const [joining, reservations, timing] = GROUPS;

  const reservationSummary = `Fee ${typedRupees(text.reservationFeePaise)} · cancel window ${(text.cancelWindowMin ?? "").trim() || "—"} min`;
  const prioritySummary = values.priorityOn
    ? `On · ${typedRupees(text.priorityFeePaise)} · 1 in ${(text.priorityPerRegular ?? "").trim() || "—"}${capText ? ` · ${capText} a day` : ""}`
    : "Off";

  return (
    <>
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        Changes apply to new tokens. People already in the queue keep the rules
        they joined with.
      </ThemedText>

      <View style={styles.group}>
        <SectionHeader title={joining.title} />
        <Card>{fields(joining)}</Card>
      </View>

      <ExpandableSection
        title={reservations.title}
        summary={reservationSummary}
        expanded={openReservations}
        onToggle={() => setOpenReservations((o) => !o)}
      >
        <Card>{fields(reservations)}</Card>
      </ExpandableSection>

      <View style={styles.group}>
        <SectionHeader title={timing.title} />
        <Card>
          {fields(timing)}
          <AppSwitch
            label="No limit for coming back late"
            description="On: after a missed turn, I'm here always puts the person back behind the rejoin delay, however late. Off: only within the late window below; after it they go to the end of the line."
            value={values.noLateLimit}
            onValueChange={setNoLateLimit}
            disabled={disabled}
          />
          {!values.noLateLimit ? (
            <TextField
              label="Late window (min)"
              value={text.lateWindowMin ?? ""}
              onChangeText={(v) => setText("lateWindowMin", v)}
              keyboardType="number-pad"
              editable={!disabled}
              error={errors.lateWindowMin}
              hint={`How long after a missed turn I'm here still keeps a place near the front. Default ${QUEUE_SETTINGS_DEFAULTS.lateWindowMin} min.`}
            />
          ) : null}
        </Card>
      </View>

      <ExpandableSection
        title="Priority Pass"
        summary={prioritySummary}
        expanded={openPriority}
        onToggle={() => setOpenPriority((o) => !o)}
      >
        <Card>
          <AppSwitch
            label="Priority lane"
            description="Customers can buy a Priority Pass (and waiting customers can Skip ahead). Everyone sees “Priority lane on · 1 in N”."
            value={values.priorityOn}
            onValueChange={setPriorityOn}
            disabled={disabled}
          />
          {values.priorityOn ? (
            <>
              {PRIORITY_FIELDS.map((f) => (
                <SettingField
                  key={f.key}
                  spec={f}
                  value={text[f.key] ?? ""}
                  onChange={(v) => setText(f.key, v)}
                  disabled={disabled}
                  error={errors[f.key]}
                />
              ))}
              <TextField
                label="Daily sales cap (passes)"
                value={text.priorityDailyCap ?? ""}
                onChangeText={(v) => setText("priorityDailyCap", v)}
                keyboardType="number-pad"
                placeholder="No cap"
                editable={!disabled}
                error={errors.priorityDailyCap}
                hint="Passes and Skip ahead sold per day. When reached, customers see “Sold out”. Leave empty for no cap."
              />
              <ChoiceChips
                label="A pass must be checked in"
                options={passValidityOptions}
                value={String(passValidity)}
                onChange={(v) => setPassValidity(Number(v))}
                disabled={disabled}
              />
              <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
                {`${passValidity === 0 ? "Until the end of the day it was bought" : `Within ${passValidityLabel(passValidity)} of buying`}. A pass not checked in by then ends without a refund. After check-in the holder stays until served or the queue closes (then refunded in full).`}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              Off: everyone waits in one line (plus your triage tokens). Your
              priority settings are kept for when you switch it on.
            </ThemedText>
          )}
        </Card>
      </ExpandableSection>

      <View style={styles.group}>
        <SectionHeader title="Ticket validity" />
        <Card>
          <ChoiceChips
            label="A ticket stays valid"
            options={validityOptions}
            value={String(validity)}
            onChange={(v) => setValidity(Number(v))}
            disabled={disabled}
          />
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {validity === 0
              ? "Tickets end when you close the queue (the default)."
              : `Tickets end ${ticketValidityLabel(validity)} after joining. If the queue closes earlier, waiting tickets that are still valid are kept and served first, with their number, when you open again.`}
          </ThemedText>
        </Card>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.three },
});
