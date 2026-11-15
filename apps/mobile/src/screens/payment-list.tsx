import type { BusinessPaymentView, PaymentView } from "@qpeer/shared";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Badge, Icon } from "@/components/ui";
import { Radius, RIPPLE_ALPHA, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatRupees } from "@/lib/format";
import { PAYMENT_KIND_LABELS, paymentStatus } from "@/lib/payment-format";
import { formatDateTime } from "@/lib/queue-format";

/**
 * One payment (PAY-11): what, where, when, amount and status, on a tonal
 * row (radius 16). With a ticket the whole row opens it (ripple and a
 * chevron).
 */
export function PaymentRow({
  payment: p,
  onPress,
  showBusiness = true,
}: {
  payment: PaymentView | BusinessPaymentView;
  /** Opens the ticket this payment belongs to. */
  onPress?: () => void;
  showBusiness?: boolean;
}) {
  const theme = useTheme();
  const status = paymentStatus(p);
  const net = "businessSharePaise" in p ? p : null;
  const kind = PAYMENT_KIND_LABELS[p.kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityHint={onPress ? "Opens the ticket" : undefined}
      android_ripple={
        onPress ? { color: theme.onSurface, alpha: RIPPLE_ALPHA } : undefined
      }
      style={[styles.row, { backgroundColor: theme.surfaceContainer }]}
    >
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={styles.flex}>
            <ThemedText type="titleMedium">{kind}</ThemedText>
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              {showBusiness
                ? `${p.businessName} · ${p.queueName}`
                : p.queueName}
            </ThemedText>
          </View>
          <ThemedText type="titleMedium" style={styles.amount}>
            {formatRupees(p.amountPaise)}
          </ThemedText>
        </View>
        <View style={styles.top}>
          <ThemedText
            type="bodyMedium"
            themeColor="onSurfaceVariant"
            style={styles.flex}
          >
            {formatDateTime(p.createdAt)}
          </ThemedText>
          <Badge label={status.label} tone={status.tone} />
        </View>
        {status.detail && !net ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {status.detail}
          </ThemedText>
        ) : null}
        {net ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {`Your share ${formatRupees(net.businessSharePaise)} · Qpeer ${formatRupees(net.platformSharePaise)}`}
          </ThemedText>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron_right" color="onSurfaceVariant" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  body: { flex: 1, gap: Spacing.two },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  flex: { flex: 1, gap: Spacing.half },
  amount: { fontVariant: ["tabular-nums"] },
});
