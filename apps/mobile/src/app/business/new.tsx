import { useRouter } from "expo-router";
import { useState } from "react";

import { Screen } from "@/components/ui";
import { useCreateBusiness } from "@/lib/api";
import { useUnsavedChangesGuard } from "@/lib/unsaved-changes";
import { BusinessForm } from "@/screens/business-form";

/** BIZ-01 / BIZ-06: create a business, then open it. */
export default function NewBusinessScreen() {
  const router = useRouter();
  const create = useCreateBusiness();
  const [dirty, setDirty] = useState(false);
  const allowLeave = useUnsavedChangesGuard(dirty);

  return (
    <Screen>
      <BusinessForm
        mode="create"
        submitLabel="Create business"
        onDirtyChange={setDirty}
        onSubmit={async (v) => {
          const view = await create.mutateAsync({
            name: v.name,
            category: v.category,
            address: v.address,
            ...(v.phone ? { phone: v.phone } : {}),
          });
          allowLeave();
          router.replace({
            pathname: "/business/[id]",
            params: { id: view.id },
          });
        }}
      />
    </Screen>
  );
}
