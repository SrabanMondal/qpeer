import { StyleSheet, View } from "react-native";

import { ModeSwitch } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useModeToggle } from "@/lib/mode";

/**
 * The mode toggle in the Business tab's top app bar
 * (business-interface.jpg): compact, on the right of the header, so it
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
  wrap: { paddingLeft: Spacing.two, paddingRight: Spacing.two },
});
