import { StyleSheet, View } from "react-native";

import { ModeSwitch } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useModeToggle } from "@/lib/mode";

/**
 * The mode toggle on the dark header band of the Business tab
 * (business-interface.jpg): a compact pill on the right of the header, so it
 * never runs into the title (B3).
 */
export function HeaderModeSwitch() {
  const { mode, switching, change } = useModeToggle();
  return (
    <View style={styles.wrap}>
      <ModeSwitch
        mode={mode}
        onChange={(m) => {
          void change(m);
        }}
        disabled={switching}
        onDark
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingLeft: Spacing.two, paddingRight: Spacing.three },
});
