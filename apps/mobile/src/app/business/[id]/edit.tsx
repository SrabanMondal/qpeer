import { useLocalSearchParams, useRouter } from "expo-router";

import { ErrorState, LoadingState, Screen } from "@/components/ui";
import { useBusiness, useUpdateBusiness } from "@/lib/api";
import { BusinessForm } from "@/screens/business-form";

/** BIZ-02: edit every profile field. */
export default function EditBusinessScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useBusiness(id);
  const update = useUpdateBusiness(id);

  if (!business.data) {
    return (
      <Screen>
        {business.isError ? (
          <ErrorState
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
  return (
    <Screen>
      <BusinessForm
        mode="edit"
        initial={{
          name: b.name,
          category: b.category,
          address: b.address,
          phone: b.phone,
        }}
        submitLabel="Save changes"
        onSubmit={async (v) => {
          await update.mutateAsync({
            name: v.name,
            category: v.category,
            address: v.address,
            phone: v.phone,
          });
          router.back();
        }}
      />
    </Screen>
  );
}
