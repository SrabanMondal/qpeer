# QPeer v1: UI Design Guide

The visual system is **"B · Token board"**, chosen by the owner on **2026-11-15** from three mocked-up directions (Token slip, Token board, Platform board). §1–§3 describe it; `apps/mobile/src/constants/theme.ts` holds every value. The four reference mockups in `docs/design/` still set the **layout and structure** of the screens (§4–§6); their colours and type are replaced by this system.

*Updated 2026-10-18: ratings (§5) and the Priority Pass, missed-turn and check-code screens (§5a) follow the decided v1 design (HLD §5.2, §6.7).*
*Updated 2026-11-15: direction B "Token board" chosen; §1–§3 rewritten, visual words in §4–§6 updated.*

| Reference | Shows | Used for |
|---|---|---|
| `design/map-interface.jpg` | Customer map: search bar, map, wait-time pill markers, bottom card with "Queue Now" / "Directions" | Step 3 (map), Step 4 (reserve) |
| `design/qpeer-client-interface.jpg` | Customer ticket: big number, status rows, bottom tabs Home / Queue / Profile | Step 2 (token screen) |
| `design/service-provider-interface.png` | Staff console: status banner, "Now Serving", big NEXT, Pause / Skip / Priority / Add person, Waiting / In service / Total, bottom tabs | Step 2 (console) |
| `design/business-interface.jpg` | Business dashboard: mode switch, Now Serving with NEXT, earnings split, wait-time bar chart | Steps 1, 2, 5 (business home, insights) |

---

## 1. Visual language

**Thesis.** The amber LED token display over every Indian clinic counter: "Token 14 → Counter 2". It is what people stare at while they wait, and it is the app's one signature. Everything else is calm Material 3.

- **One committed region, a restrained shell.** The **token board** (black face, amber dot-matrix LEDs) is the only black, high-chroma region. Screens around it are quiet tonal Material 3 surfaces with one brass accent. Never make a whole screen black or amber.
- **The board is the hero** wherever a number matters: the customer's ticket and the staff console's "Now serving". Map pills borrow its face (Doto on black) in a later phase.
- **Red LEDs mean "come now".** The board turns red only when it is the customer's turn ("YOUR TURN · NOW", "COME NOW · 4:12"). That switch is the app's one orchestrated animation.
- **Hierarchy from type and space, not boxes.** Not every group is a card. Tonal surfaces give depth; shadows only on things that float.
- **One primary action per state**, in the lower half, as a full-round brass button. NEXT is the biggest button in the app.

### Dos and don'ts

| Do | Don't |
|---|---|
| Use the board for the one number a screen is about | Put the board, Doto or black panels anywhere else (except map pills) |
| Use colour roles in their pairs (`onX` on `X`) | Put text in a container colour, or hex values in components |
| Pair every colour signal with a word or icon (Badge, StatusBanner) | Rely on red/green alone |
| Use space and type for groups; a tonal card when a group needs a boundary | Add shadows, borders or dividers to flat groups |
| Give each state one filled button | Put two filled buttons side by side |
| Keep sentences in Roboto | Use Doto or Archivo for sentences |

### Access rule

- When the phone's font scale is **≥ 1.3**, board text switches from Doto to **Archivo 800** (dot-matrix gets hard to read when large). The big number may grow to 1.3× and then stops, so it stays on screen.
- Every board is **one accessibility stop** whose `accessibilityLabel` says the whole meaning in words: "Your token 14. Check code K 7 P 2. Now serving 6."
- Touch targets are at least **48 × 48 dp** as real views (no `hitSlop`). Every icon-only control has a label. Text always scales (`allowFontScaling` stays on).
- Reduced motion: the board swaps instantly.

## 2. Design tokens

All values live in `apps/mobile/src/constants/theme.ts`. Components use tokens only. The one exception is the QR code's white quiet zone.

### Colour roles

Material 3 roles generated with the app-ui skill's `palette.mjs --seed "#E89A00" --neutral "#5E6470"` (contrast-checked, exit 0). Dark is its own palette, not an inversion. Brass `primary` is the brand accent; **tertiary green = success**; **error = destructive**.

| Role | Light | Dark | Use |
|---|---|---|---|
| `primary` / `onPrimary` | `#825507` / `#FFFFFF` | `#F6BC70` / `#442B00` | Filled buttons (NEXT, Check in, I'm here), links, focus |
| `primaryContainer` / `onPrimaryContainer` | `#FFDDB6` / `#271900` | `#633F00` / `#FFDDB6` | Skip-ahead row, priority chip, "paused / needs attention" banner |
| `secondaryContainer` / `onSecondaryContainer` | `#F2E0CD` / `#271900` | `#584329` / `#F2E0CD` | Tonal buttons, selected chip, nav-bar indicator, list icons |
| `tertiary` / `tertiaryContainer` / `onTertiaryContainer` | `#446738` / `#D2E9C8` / `#0E2000` | `#ABD19B` / `#2C4F22` / `#D2E9C8` | Success: "Open — service active", success badges |
| `error` / `errorContainer` / `onErrorContainer` | `#B4271F` / `#FFDAD3` / `#380C00` | `#FFB4A5` / `#93000B` / `#FFDAD3` | Leave queue, No-show, triage, problems |
| `surface` | `#F7F9FF` | `#10131A` | Screen background, top app bar |
| `surfaceContainerLow` | `#F1F4F9` | `#181C22` | Quiet cards (QR, tips, empty states) |
| `surfaceContainer` | `#EBEEF3` | `#1C2026` | Cards, list rows, navigation bar |
| `surfaceContainerHigh` / `Highest` | `#E6E8EE` / `#E0E2E8` | `#272A31` / `#31353C` | Connection strip, neutral badges |
| `onSurface` / `onSurfaceVariant` | `#181C22` / `#3F4756` | `#E0E2E8` / `#BEC7D9` | Text / secondary text and icons |
| `outline` / `outlineVariant` | `#6F7788` / `#BEC7D9` | `#8891A2` / `#3F4756` | Field and outlined-button borders / decoration |
| `inverseSurface` / `inverseOnSurface` / `inversePrimary` | `#2D3038` / `#EEF1F6` / `#F6BC70` | `#E0E2E8` / `#2D3038` / `#825507` | Snackbar (toast), the floating Undo bar |

The full set (secondary, tertiary, dim/bright surfaces, scrim) is in `theme.ts`.

**Old names** (`brand`, `brandSoft`, `primarySoft`, `danger`, `dangerSoft`, `warning`, `warningSoft`, `ink`, `inkMuted`, `header`, `bg`, `card`, `border`) still work as **deprecated aliases** mapped onto these roles (`brand` → `primary`, `ink` → `onSurface`, `card` → `surfaceContainer`, `warning` → `primary`, …), so screens not yet migrated pick up the new look. New code uses role names; phase 2 migrates screens one by one.

### Board tokens

Fixed, the same in both themes unless noted. Contrast measured on `boardBg`.

| Token | Value | Contrast | Use |
|---|---|---|---|
| `boardBg` | `#0B0B0C` | — | The board's face |
| `boardEdge` | `#26221B` light / `#31353C` dark | — | Inner 3 dp ring |
| `boardLed` | `#FFB020` | 10.8 : 1 | Digits and row labels |
| `boardLedDim` | `#B0832E` | 5.7 : 1 | Check code, ended/missed numbers, secondary rows |
| `boardAlert` | `#FF4A3D` | 5.9 : 1 | Red LEDs: "YOUR TURN", "COME NOW", the countdown |
| `boardGlow` / `boardAlertGlow` | LED colour at 45–50 % | — | Soft text shadow (radius 6 rows, 14 number) |
| `boardDots` / `boardRule` | LED at 7 % / `#2A2418` | decoration | The dot grid and the thin rule between rows |

### Type roles

Only these faces and weights are bundled (`@expo-google-fonts/*` + the expo-font config plugin; `useFonts` holds the splash so no text renders in the wrong face).

| Face | Roles | Use |
|---|---|---|
| **Doto 900** (dot-matrix) | `boardDisplay` 104/112, `boardLabel` 17/24 (min 15) | Only on the board and map pills. Never sentences |
| **Archivo 800** | `nextLabel` 22/28, `boardDisplaySolid`, `boardLabelSolid` | The NEXT label; the board at font scale ≥ 1.3 |
| **Archivo 700** | `figure` 22/28 tabular, `appTitle` 22/28 | Figures beside the board, stat numbers, screen titles |
| **Roboto** (system) | M3 roles: `displayLarge…Small`, `headlineLarge…Small`, `titleLarge` 22, `titleMedium` 16/500, `titleSmall` 14/500, `bodyLarge` 16, `bodyMedium` 14, `bodySmall` 12, `labelLarge` 14/500, `labelMedium` 12/500, `labelSmall` 11/500 | Everything people read in sentences, buttons, lists, forms |

Numbers use `fontVariant: ["tabular-nums"]`. Old type names stay as aliases: `display` → Archivo 800 57, `title` → headline small, `heading` → title medium (bold), `body` → body large, `label` → label large, `small` → body medium.

### Shape

Radius scale **xs 4 / sm 8 / md 12 / lg 16 / xl 28 / full**.
- Cards, list rows and the board: **16**. Chips and badges: **8**. Snackbar: **4**.
- Buttons: **full-round**. Heights: 48 (every button keeps a 48 dp target), 56 for a screen's primary action, **72 for NEXT** (≥ 64).
- Text fields: **outlined, radius 12**, everywhere (one input style).
- A corner nested inside another is the outer radius minus the padding.

### Spacing

4, 8, 12, 16, 24, 32 (`Spacing.one … five`). Screen padding 16; gaps grow with looser grouping: row < group < section.

### Surfaces and elevation

Depth comes from the tonal `surfaceContainer*` steps. **No shadows** except things that float: snackbar (toast), the floating Undo bar, FABs and sheets, which use `Elevation.level3` (`boxShadow`). The old soft card shadow and dark-mode card borders are gone.

### Icons

Material Symbols through the `Icon` component (expo-symbols), **outlined**. **Filled only for the selected tab.** An icon that is the only content of a control has an `accessibilityLabel`.

### Motion

Material 3 **Standard** springs in the physics form (`mass: 1`), `Spring` in `theme.ts`; effects springs never bounce.

**The one orchestrated moment:** when a ticket is called (CALLED, and again on GRACE), the board's LEDs **blank and re-light row by row** (top row, number, bottom row; 120 ms apart with the fast effects spring, ≈ 360 ms) into the red state. With reduced motion the board swaps instantly. No other decorative motion: no entrance animations, nothing that replays on every visit.

## 3. Components

All in `apps/mobile/src/components/ui/`.

| Component | Look |
|---|---|
| `TokenBoard` | The signature (replaces `NumberBadge`). Black face, 3 dp edge ring, radius 16, faint LED dot grid. A top row (label left, value right), the big padded number ("014"), a rule, a bottom row. Tones `led` / `dim` / `alert`. One accessibility stop; `relightKey` drives the re-light; access rule built in. `boardNumber()` pads labels ("6" → "006", "P3" → "P03") |
| `Button` | Full-round M3 buttons with ripple (`android_ripple`, content colour at 10 %): `filled` (primary), `tonal` (secondaryContainer), `outlined` (outline border, primary text), `text`, `danger` (error text button), `danger-tonal` (errorContainer). Sizes `medium` 48 / `large` 56 / `hero` 72 (Archivo 800 label). Busy = spinner on the button; disabled = onSurface at 10 % / 38 %. Old variant names still work |
| `Card` | Tonal container (default `surfaceContainer`, `tone` prop), radius 16, padding 16, no shadow, no border |
| `ListItem` | Tonal row, min 56 dp, radius 16, ripple, leading icon on a `secondaryContainer` circle, chevron when it navigates |
| `ChoiceChips` | M3 filter chips: 32 dp chip inside a 48 dp target, radius 8, check + secondaryContainer when selected, outline when not |
| `Badge` | Small label, radius 8, label medium, container + on-colour pairs (success = tertiary, warning = primary container, danger = error container, neutral) |
| `StatusBanner` | Tonal strip with an icon, title medium and a detail line: active = tertiary container, paused = primary container, closed = surface container highest |
| `StatRow` | Figures in columns: caption (body medium) above, the number in Archivo (`figure`) below. No card |
| `InfoRow` | Label (body large, onSurfaceVariant) left, value (title medium) right; wraps on large fonts |
| `TextField` | Outlined, radius 12, label always visible above, 2 dp primary border on focus, error colour and message when invalid |
| `HeaderButton` | Small text button, label large, a real 48 × 48 dp target with ripple (no hitSlop) |
| `ToastHost` | M3 snackbar look: inverseSurface, radius 4, level 3 shadow, under the status bar; the icon names the tone |
| `ConfirmDialog` | The native Android dialog (`Alert.alert`), only for decisions that cannot be undone |
| `ConnectionBanner` | Slim tonal strip (surfaceContainerHighest), icon + "Offline — showing saved info", a 48 dp "Retry" text button |
| `ModeSwitch` | Drawn like an M3 switch (primary track when Business), caption "Business / Customer", one 48 dp target |
| `AppSwitch` | M3 switch colours: primary track on, outline track off |
| `SectionHeader` | M3 list subheader: title small in primary, sentence case, space above |
| Tab bar (`(tabs)/_layout.tsx`) | M3 navigation bar on the platform tabs: surfaceContainer, 80 dp, labels always shown, 64 × 32 pill indicator on secondaryContainer, filled icon when selected |
| Top app bar (stack headers) | `surface`, no shadow line, title in Archivo 700 (`appTitle`) |

## 4. Navigation

- **Customer mode tabs:** **Home** (map — Step 3), **Queue** (my tokens / current ticket — Step 2), **Profile**.
- **Business mode tabs:** **Queue** (console for the selected queue — Step 2), **Business** (businesses, profile, pin, hours, queues — Step 1), **Insights** (analytics + earnings — Step 5), **Profile/Settings**.
- Until a tab's step is built, its tab shows a friendly placeholder card rather than being hidden, so the structure is visible early.
- The **mode switch** appears in Profile and in the Business tab's top app bar (as in the mockup).

## 5. Deliberate differences from the mockups

| Mockup shows | QPeer v1 does | Why |
|---|---|---|
| "BLE Proximity: ON" | **"Walk-in check: GPS · 150 m"** (or just "Service active") | We replaced BLE with the GPS check |
| £ amounts | **₹** (amounts in paise internally) | India |
| "Discover queues in London" | **"Discover queues in Jammu"** (or the user's area) | Demo city |
| "Update Position" button | **Pull to refresh** only; updates are live | Position updates automatically over the live connection |
| Earnings split "Walk-ins / QPeer Users" | **"Reservations / Priority Pass"** and **business share** | QPeer only knows the money that went through QPeer; walk-ins pay the business directly, outside the app |
| Photo in the map bottom card | **Category icon placeholder** in v1 | Business photos come after v1 (needs uploads) |
| One rating with stars | **Two ratings**, experience and service quality, **split by lane**: "Regular customers 4.2★ · Priority customers 4.6★". A lane's stars stay hidden until it has 5 ratings ("New · not enough ratings yet"). Stars only, no review text (Step 6 extra) | Verified ratings from served tickets; the lane split shows whether priority is used fairly |
| Blue number circle, teal/blue accents, dark header band | **The token board** and the brass Material 3 shell (§1–§3) | Direction B, chosen 2026-11-15 |

## 5a. Priority Pass, missed turn and check code (decided 2026-10-18)

Same look as the rest of the app: the board as the hero, tonal surfaces, one strong action per state. Customer actions are filled `primary` (brass) buttons.

| Element | Where | Look and text |
|---|---|---|
| Priority lane label | Business page, join screen, ticket (when the lane is on) | Small chip, radius 8, `primaryContainer` fill, `onPrimaryContainer` text and bolt icon: **"Priority lane on · 1 in N"**. Next to it, the lane-split rating line. Never hidden while the lane is on. |
| Buy pass preview | Before payment | `Card` with `InfoRow`s: "Priority wait ~X min", "Regular wait ~Y min", "You save ~Z min" (an Archivo figure in `primary`). Price on the filled button: "Buy Priority Pass · ₹X". "Sold out" replaces the button when the daily cap is reached. |
| BOOKED pass | Ticket screen, My tokens | Board: "PRIORITY PASS · K7P2", dim "P--", "CHECK IN · ON ARRIVAL". Under it "Priority Pass · booked", "Valid until …", one large filled **"Check in"** (runs the GPS check). No number yet: the P number appears after check-in. Outlined "Cancel pass" with the refund shown before confirming. |
| Skip-ahead row | Ticket screen, WAITING regular ticket | A tonal `primaryContainer` row: "Skip ahead · about N min faster" with the price in a filled **₹ chip**; the whole row is one button. **Hidden when the saving is under 5 min**; never show "save ~0 min". |
| Grace countdown | Ticket screen, GRACE | The board re-lights red: **"COME NOW · m:ss"**, the number, "GO TO · COUNTER N", counting down every second on the server-corrected clock. Under it the Archivo figures "Your turn: Now · Time left: 4 min 12 s" and the instruction line. The board is the hero while in GRACE. |
| MISSED screen | Ticket screen, MISSED | Board: "TURN MISSED", the number dimmed, "REJOIN BY · time". Title "You missed your turn". Body "When you're here, tap I'm here to rejoin." One large filled **"I'm here"** button (runs the location check; clear errors for too far / fake location). After the one rejoin the button is gone. If the late window has passed, add the line "You'll rejoin at the end of the line." |
| Check code | Ticket board, top row (R2, decided 2026-10-18) | Right end of the board's top row in `boardLedDim`: "YOUR TOKEN · K7P2" (selectable). Spoken letter by letter. Staff ask for it at the counter when the phone is dead. |

## 6. Writing style in the UI

Short, plain, friendly. Prefer "8 people ahead · about 25–35 min" over technical words. Errors say what happened and what to do ("You seem to be far from this clinic. Move closer or ask staff to add you."). Times in 12-hour format with AM/PM. Board rows are short capitals ("NOW SERVING", "COME NOW"); everything else is sentence case.
