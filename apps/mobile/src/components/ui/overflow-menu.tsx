import {
  Text as ComposeText,
  DropdownMenu,
  DropdownMenuItem,
  Host,
  RNHostView,
} from "@expo/ui/jetpack-compose";
import { type Ref, useImperativeHandle, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useIsDark, useTheme } from "@/hooks/use-theme";

export type MenuItem = {
  label: string;
  onPress: () => void;
  /** Destructive actions ("Close for the day") are drawn in `error`. */
  destructive?: boolean;
  disabled?: boolean;
};

export type OverflowMenuHandle = {
  /** Opens the menu at its ⋮ anchor (e.g. from a row's long-press). */
  open: () => void;
};

/**
 * An M3 menu anchored to a ⋮ icon button (Jetpack Compose `DropdownMenu`
 * from `@expo/ui`, stable API): `surfaceContainer`, label large items,
 * destructive items in `error`. Picking an item closes the menu, then runs
 * it. For rare actions in a top app bar or on a list row.
 */
export function OverflowMenu({
  items,
  accessibilityLabel,
  disabled = false,
  ref,
}: {
  items: readonly MenuItem[];
  /** Spoken label of the ⋮ button, e.g. "More actions for #14". */
  accessibilityLabel: string;
  disabled?: boolean;
  ref?: Ref<OverflowMenuHandle>;
}) {
  const theme = useTheme();
  const dark = useIsDark();
  const [open, setOpen] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!disabled) setOpen(true);
      },
    }),
    [disabled],
  );

  return (
    <Host matchContents colorScheme={dark ? "dark" : "light"}>
      <DropdownMenu
        expanded={open}
        onDismissRequest={() => setOpen(false)}
        color={theme.surfaceContainer}
        // Unclipped popups stay attached to their anchor near the screen's
        // bottom edge (edge to edge).
        properties={{ clippingEnabled: false }}
      >
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <IconButton
              icon="more_vert"
              accessibilityLabel={accessibilityLabel}
              disabled={disabled}
              onPress={() => setOpen(true)}
            />
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {items.map((item) => {
            const color = item.destructive ? theme.error : theme.onSurface;
            return (
              <DropdownMenuItem
                key={item.label}
                enabled={!item.disabled}
                elementColors={{ textColor: color }}
                onClick={() => {
                  setOpen(false);
                  item.onPress();
                }}
              >
                <DropdownMenuItem.Text>
                  <ComposeText
                    color={color}
                    style={{ typography: "labelLarge" }}
                  >
                    {item.label}
                  </ComposeText>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
