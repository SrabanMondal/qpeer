import {
  type BusinessCategory,
  CreateBusinessBody,
  UpdateBusinessBody,
} from "@qpeer/shared";
import { useState } from "react";
import { Alert } from "react-native";

import { Button, ChoiceChips, TextField } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { apiFieldErrors, type FieldErrors, zodFieldErrors } from "@/lib/form";
import { CATEGORY_CHOICES } from "@/lib/format";

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

/**
 * Profile fields of a business (BIZ-01 create, BIZ-02 edit), validated on the
 * phone with the same shared zod schemas the API uses (BIZ-06).
 */
export function BusinessForm({
  mode,
  initial,
  submitLabel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: BusinessProfileValues;
  submitLabel: string;
  onSubmit: (values: BusinessProfileValues) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<BusinessCategory | null>(
    initial?.category ?? null,
  );
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmedPhone = phone.trim();
    const candidate = {
      name,
      category: category ?? undefined,
      address,
      phone:
        mode === "create" ? trimmedPhone || undefined : trimmedPhone || null,
    };
    const parsed =
      mode === "create"
        ? CreateBusinessBody.safeParse(candidate)
        : UpdateBusinessBody.safeParse(candidate);
    if (!parsed.success) {
      setErrors(friendly(zodFieldErrors(parsed.error)));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        category: category as BusinessCategory,
        address: address.trim(),
        phone: trimmedPhone || null,
      });
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) {
        setErrors(friendly(apiFieldErrors(e.issues)));
      } else {
        Alert.alert("Could not save", errorText(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TextField
        label="Business name"
        value={name}
        onChangeText={setName}
        error={errors.name}
        placeholder="e.g. City Clinic"
        autoCapitalize="words"
        maxLength={80}
      />
      <ChoiceChips
        label="Category"
        options={CATEGORY_CHOICES}
        value={category}
        onChange={setCategory}
        error={errors.category}
      />
      <TextField
        label="Address"
        value={address}
        onChangeText={setAddress}
        error={errors.address}
        placeholder="Street, area, city"
        multiline
        maxLength={200}
        hint="Helps customers find you. You set the exact map pin later."
      />
      <TextField
        label="Phone (optional)"
        value={phone}
        onChangeText={setPhone}
        error={errors.phone}
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <Button title={submitLabel} onPress={submit} loading={saving} />
    </>
  );
}
