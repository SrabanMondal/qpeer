import type { BusinessPaymentView, PaymentView } from "@qpeer/shared";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Badge, Card, HeaderButton } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { formatRupees } from "@/lib/format";
import { PAYMENT_KIND_LABELS, paymentStatus } from "@/lib/payment-format";
import { formatDateTime } from "@/lib/queue-format";

/** One payment (PAY-11): what, where, when, amount and status. */
export function PaymentRow({
  payment: p,
  onPress,
  showBusiness = true,
}: {
  payment: PaymentView | BusinessPaymentView;
  onPress?: () => void;
  showBusiness?: boolean;
}) {
  const status = paymentStatus(p);
  const net = "businessSharePaise" in p ? p : null;
  return (
    <Card>
      <View style={styles.top}>
        <View style={styles.flex}>
          <ThemedText type="heading">{PAYMENT_KIND_LABELS[p.kind]}</ThemedText>
          <ThemedText type="small" themeColor="inkMuted">
            {showBusiness ? `${p.businessName} · ${p.queueName}` : p.queueName}
          </ThemedText>
        </View>
        <ThemedText type="heading">{formatRupees(p.amountPaise)}</ThemedText>
      </View>
      <View style={styles.top}>
        <ThemedText type="small" themeColor="inkMuted" style={styles.flex}>
          {formatDateTime(p.createdAt)}
        </ThemedText>
        <Badge label={status.label} tone={status.tone} />
      </View>
      {status.detail && !net ? (
        <ThemedText type="small" themeColor="inkMuted">
          {status.detail}
        </ThemedText>
      ) : null}
      {net ? (
        <ThemedText type="small" themeColor="inkMuted">
          {`Your share ${formatRupees(net.businessSharePaise)} · Qpeer ${formatRupees(net.platformSharePaise)}`}
        </ThemedText>
      ) : null}
      {onPress ? (
        <View style={styles.link}>
          <HeaderButton title="Open ticket" onPress={onPress} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  flex: { flex: 1, gap: Spacing.half },
  link: { alignItems: "flex-start" },
});
