import {
  type BusinessCategory,
  CreateBusinessBody,
  UpdateBusinessBody,
} from "@qpeer/shared";
import { useEffect, useState } from "react";

import { Button, ChoiceChips, TextField } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  apiFieldErrors,
  type FieldErrors,
  useFieldErrors,
  zodFieldErrors,
} from "@/lib/form";
import { CATEGORY_CHOICES } from "@/lib/format";
import { showErrorToast } from "@/lib/toast";

export type BusinessProfileValues = {
  name: string;
  category: BusinessCategory;
  address: string;
  /** null = no phone. */
  phone: string | null;
};

/** Friendlier text than zod's defaults, per field. */
const FIELD_MESSAGES: Record<string, string> = {
  name: "Enter a name of 2 to 80 characters.",
  category: "Pick a category.",
  address: "Keep the address under 200 characters.",
  phone: "Enter a phone number with 7 to 16 digits, e.g. +91 98765 43210.",
};

function friendly(errors: FieldErrors): FieldErrors {
  const out: FieldErrors = {};
  for (const key of Object.keys(errors)) {
    out[key] = FIELD_MESSAGES[key] ?? errors[key];
  }
  return out;
}

type Draft = {
  name: string;
  category: BusinessCategory | null;
  address: string;
  phone: string;
};

function toDraft(initial?: BusinessProfileValues): Draft {
  return {
    name: initial?.name ?? "",
    category: initial?.category ?? null,
    address: initial?.address ?? "",
    phone: initial?.phone ?? "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.category === b.category &&
    a.address === b.address &&
    a.phone === b.phone
  );
}

function validateDraft(mode: "create" | "edit", draft: Draft): FieldErrors {
  const trimmedPhone = draft.phone.trim();
  const candidate = {
    name: draft.name,
    category: draft.category ?? undefined,
    address: draft.address,
    phone: mode === "create" ? trimmedPhone || undefined : trimmedPhone || null,
  };
  const parsed =
    mode === "create"
      ? CreateBusinessBody.safeParse(candidate)
      : UpdateBusinessBody.safeParse(candidate);
  return parsed.success ? {} : friendly(zodFieldErrors(parsed.error));
}

/**
 * Profile fields of a business (BIZ-01 create, BIZ-02 edit), validated on the
 * phone with the same shared zod schemas the API uses (BIZ-06). Errors clear
 * as soon as a field becomes valid (B4). `onDirtyChange` reports unsaved
 * edits so the screen can guard leaving (B8).
 */
export function BusinessForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
  onDirtyChange,
}: {
  mode: "create" | "edit";
  initial?: BusinessProfileValues;
  submitLabel: string;
  onSubmit: (values: BusinessProfileValues) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [start] = useState(() => toDraft(initial));
  const [draft, setDraft] = useState<Draft>(start);
  const form = useFieldErrors((d: Draft) => validateDraft(mode, d));
  const [saving, setSaving] = useState(false);

  const dirty = !sameDraft(draft, start);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const change = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    form.revalidate(next, field);
  };

  const submit = async () => {
    if (!form.validateAll(draft)) return;
    setSaving(true);
    try {
      await onSubmit({
        name: draft.name.trim(),
        category: draft.category as BusinessCategory,
        address: draft.address.trim(),
        phone: draft.phone.trim() || null,
      });
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) {
        form.showErrors(friendly(apiFieldErrors(e.issues)));
      } else {
        // The typed values stay; the snackbar says what went wrong.
        showErrorToast("Could not save", e);
      }
    } finally {
      setSaving(false);
    }
  };

  const { errors } = form;
  return (
    <>
      <TextField
        label="Business name"
        value={draft.name}
        onChangeText={(v) => change("name", v)}
        error={errors.name}
        placeholder="e.g. City Clinic"
        autoCapitalize="words"
        maxLength={80}
      />
      <ChoiceChips
        label="Category"
        options={CATEGORY_CHOICES}
        value={draft.category}
        onChange={(v) => change("category", v)}
        error={errors.category}
      />
      <TextField
        label="Address"
        value={draft.address}
        onChangeText={(v) => change("address", v)}
        error={errors.address}
        placeholder="Street, area, city"
        multiline
        maxLength={200}
        hint="Helps customers find you. You set the exact map pin later."
      />
      <TextField
        label="Phone (optional)"
        value={draft.phone}
        onChangeText={(v) => change("phone", v)}
        error={errors.phone}
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <Button
        title={submitLabel}
        size="large"
        onPress={submit}
        loading={saving}
        needsNetwork
      />
    </>
  );
}
