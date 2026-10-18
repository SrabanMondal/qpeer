# QPeer v1: UI Design Guide

Based on the four reference mockups in `docs/design/`. They set the **look and layout**; this guide turns them into rules the app follows, and lists where QPeer v1 deliberately differs from them.

*Updated 2026-10-18: ratings (§5) and the new Priority Pass, missed-turn and check-code screens (§5a) follow the decided v1 design (HLD §5.2, §6.7).*

| Reference | Shows | Used for |
|---|---|---|
| `design/map-interface.jpg` | Customer map: search bar, teal map, wait-time pill markers, bottom card with "Queue Now" / "Directions" | Step 3 (map), Step 4 (reserve) |
| `design/qpeer-client-interface.jpg` | Customer ticket: big number circle, status rows, bottom tabs Home / Queue / Profile | Step 2 (token screen) |
| `design/service-provider-interface.png` | Staff console: status banner, "Now Serving", big NEXT, Pause / Skip / Priority / Add person, Waiting / In service / Total, bottom tabs Queue / History / Settings | Step 2 (console) |
| `design/business-interface.jpg` | Business dashboard: mode switch, Now Serving card with NEXT, earnings split, wait-time bar chart | Steps 1, 2, 5 (business home, insights) |

---

## 1. Visual language

- **Calm and clean:** light grey background, white rounded cards, lots of space, one strong action per screen.
- **Numbers are the hero:** queue numbers and "Now Serving" are very large and bold. Everything else is secondary.
- **Two accent colours with fixed meanings:** **teal** for customer/brand actions (Queue Now, success, map), **blue** for the operational primary action (NEXT, ticket number).
- **Pills and rounded shapes:** buttons and map markers are pill-shaped; cards have generous corner radius.

## 2. Design tokens

Values are matched by eye from the mockups. Keep them in one theme file (`src/constants/theme.ts`) and use only tokens in components.

### Colours (light)

| Token | Hex | Use |
|---|---|---|
| `brand` (teal) | `#1E9E7F` | Brand, "Queue Now", success states, map tint, mode-switch on |
| `brandSoft` | `#E3F5EF` | Teal tinted backgrounds (status banner "Service active") |
| `primary` (blue) | `#2F7FE0` | NEXT, ticket number circle, primary operational buttons |
| `primarySoft` | `#E6EEF9` | Secondary operational buttons (Pause, Skip, Add person) |
| `danger` | `#C62828` | Destructive actions, triage text (the mockup's "Priority" button = free triage insert; the paid Priority Pass uses `brand`, §5a) |
| `dangerSoft` | `#FDE7E7` | Triage button background |
| `warning` | `#E8A317` | Grace period (countdown card), missed, paused |
| `ink` | `#1B2A41` | Main text, big numbers |
| `inkMuted` | `#5B6472` | Secondary text, labels |
| `header` | `#2E3E55` | Dark header band (ticket screen, dashboard top) |
| `bg` | `#F2F4F7` | Screen background |
| `card` | `#FFFFFF` | Cards, sheets, tab bar |
| `border` | `#E2E6EC` | Dividers, outlined buttons |

### Colours (dark)
Same roles: `bg #0F141B`, `card #1A222D`, `ink #EEF2F7`, `inkMuted #9AA5B4`, `header #16202C`, `border #2A3441`; keep `brand` and `primary` but lighten slightly (`#2BB892`, `#4A93EC`) for contrast; soft colours become 15–20 % opacity versions.

### Type scale

| Token | Size / weight | Use |
|---|---|---|
| `display` | 64–72 / 800 | "#42" now serving, ticket number |
| `title` | 26–28 / 700 | Screen titles ("Dashboard", "Your Ticket") |
| `heading` | 18–20 / 700 | Card titles ("Daily earnings", "Wait time analytics") |
| `body` | 16 / 400–500 | Rows, form fields |
| `label` | 13–14 / 600, uppercase optional | Small labels ("NOW SERVING", stat captions) |

System font. Respect the phone's font scaling; the display size may cap at 1.3× to stay on screen.

### Shape and spacing
- Spacing scale: 4, 8, 12, 16, 24, 32. Screen padding 16; gap between cards 16.
- Radius: cards 16, buttons 14 (large) / pill 999 (markers, chips), inputs 12.
- Shadows: very soft (`0 2 8` at ~6 % opacity) on light; borders instead of shadows on dark.
- Touch targets ≥ 44 dp; the NEXT button ≥ 64 dp tall.

## 3. Components

| Component | Look |
|---|---|
| `Button` primary | Solid `primary` (operational) or `brand` (customer), white bold text, radius 14, height 52 (NEXT: 64+ with icon) |
| `Button` secondary | `primarySoft` fill, `ink` text, icon left (Pause / Skip / Add person) |
| `Button` outline | White/`card` fill, `border` outline, `ink` text ("Directions", "Leave Queue") |
| `Button` danger-soft | `dangerSoft` fill, `danger` text and icon (triage) |
| `Card` | `card` fill, radius 16, padding 16, soft shadow |
| `StatusBanner` | `brandSoft` (active) / `warning` tint (paused) / grey (closed) with a coloured dot and two lines of text |
| `StatRow` | Three equal columns: caption above, icon + big number below (Waiting / In service / Total) |
| `InfoRow` | Label left (`inkMuted`), value right (`ink`, bold) — ticket details |
| `NumberBadge` | Large circle in `primary` with the white ticket number |
| `MapPill` | White pill with category icon + "15m wait", tail pointing to the location; teal-tinted when open, grey when closed |
| `BottomSheetCard` | Rounded top sheet over the map: photo (later), name, wait + rating row, primary + outline buttons |
| `ModeSwitch` | Toggle with caption "Business / User" (top-left of business home) |
| `Tabs` | White bottom bar, icon + label, active tint `primary` |

## 4. Navigation

- **Customer mode tabs:** **Home** (map — Step 3), **Queue** (my tokens / current ticket — Step 2), **Profile**.
- **Business mode tabs:** **Queue** (console for the selected queue — Step 2), **Business** (businesses, profile, pin, hours, queues — Step 1), **Insights** (analytics + earnings — Step 5), **Profile/Settings**.
- Until a tab's step is built, its tab shows a friendly placeholder card rather than being hidden, so the structure is visible early.
- The **mode switch** appears in Profile and as the toggle on the business home header (as in the mockup).

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

## 5a. Priority Pass, missed turn and check code (decided 2026-10-18)

Same look as the rest of the app: white cards, big numbers, one strong action per card. Customer actions use `brand` (teal); the ticket number stays in `primary`.

| Element | Where | Look and text |
|---|---|---|
| Priority lane label | Business page, join screen, ticket (when the lane is on) | Small pill chip, `brandSoft` fill, `ink` text: **"Priority lane on · 1 in N"**. Next to it, the lane-split rating line. Never hidden while the lane is on. |
| Buy pass preview | Before payment | `Card` with three `InfoRow`s: "Priority wait ~X min", "Regular wait ~Y min", "You save ~Z min" (bold, `brand`). Price on the `brand` button: "Buy Priority Pass · ₹X". "Sold out" replaces the button when the daily cap is reached. |
| BOOKED pass card | Ticket screen, My tokens | `Card` with "Priority Pass · booked", the business and queue name, "Valid until …", and one large `brand` button **"Check in"** (runs the GPS check). No number yet: the P number appears after check-in. Small outline "Cancel" with the refund shown before confirming. |
| Skip-ahead card | Ticket screen, WAITING regular ticket | `Card`: "Skip ahead for ₹X · about N min faster", `brand` button. **Hidden when the saving is under 5 min**; never show "save ~0 min". |
| Grace countdown | Ticket screen, GRACE | Large `warning`-tinted card at the top: **"Come now — m:ss left"** in `display` size, counting down every second on the server-corrected clock. Under it: "Counter N". This card is the hero of the screen while in GRACE. |
| MISSED screen | Ticket screen, MISSED | Header "You missed your turn". Body "When you're here, tap I'm here to rejoin." One large `brand` button **"I'm here"** (runs the location check; clear errors for too far / fake location). After the one rejoin the button is gone. If the late window has passed, add the line "You'll rejoin at the end of the line." |
| Check code | Ticket screen, under the number (R2, decided 2026-10-18) | Under the `NumberBadge`: "#14 · K7P2" in `label` style, letter-spaced, `inkMuted`. Staff ask for it at the counter when the phone is dead. |

## 6. Writing style in the UI

Short, plain, friendly. Prefer "8 people ahead · about 25–35 min" over technical words. Errors say what happened and what to do ("You seem to be far from this clinic. Move closer or ask staff to add you."). Times in 12-hour format with AM/PM.
