import type { BusinessCategory, WeeklyHours } from "@qpeer/shared";

/**
 * The demo city (DEM-01): 12 made-up businesses across Jammu (≈32.73 N,
 * 74.86 E) in real neighbourhoods, every category, with queues, pins and
 * hours. Names are invented (no real shop or brand). Ids are fixed and
 * UUID-shaped with the `de30000x-` prefixes, which is how reset finds exactly
 * these rows (never anything a real user made).
 */

export const DEMO_BUSINESS_PREFIX = "de300000-";
export const DEMO_QUEUE_PREFIX = "de300001-";
export const DEMO_PAYMENT_PREFIX = "de300002-";
/** `payments.user_id` of every seeded payment (no user row, no real person). */
export const DEMO_CUSTOMER_ID = "demo-seed-customer";

const pad = (n: number, w: number) => String(n).padStart(w, "0");

export const demoBusinessId = (i: number) =>
  `${DEMO_BUSINESS_PREFIX}0000-4000-8000-${pad(i, 12)}`;
export const demoQueueId = (i: number, j: number) =>
  `${DEMO_QUEUE_PREFIX}0000-4000-8000-${pad(i * 10 + j, 12)}`;
/** Payment ids of business `i`: this + a 12-digit counter. */
export const demoPaymentPrefix = (i: number) =>
  `${DEMO_PAYMENT_PREFIX}${pad(i, 4)}-4000-8000-`;

export interface DemoQueueSpec {
  name: string;
  /** Average joins per open hour at the start of the history. */
  baseJoinsPerHour: number;
  serviceMin: number;
  /** Priority lane on (1 priority per 2 regulars, ₹100). */
  priority: boolean;
}

export interface DemoBusinessSpec {
  name: string;
  category: BusinessCategory;
  area: string;
  lat: number;
  lng: number;
  hours: WeeklyHours;
  queues: DemoQueueSpec[];
}

type Range = { from: string; to: string };
const week = (
  weekday: Range[],
  sat: Range[] = weekday,
  sun: Range[] = [],
): WeeklyHours => ({
  mon: weekday,
  tue: weekday,
  wed: weekday,
  thu: weekday,
  fri: weekday,
  sat,
  sun,
});
const r = (from: string, to: string): Range => ({ from, to });
const q = (
  name: string,
  baseJoinsPerHour: number,
  serviceMin: number,
  priority = false,
): DemoQueueSpec => ({ name, baseJoinsPerHour, serviceMin, priority });

export const DEMO_CATALOG: readonly DemoBusinessSpec[] = [
  {
    name: "Shifa Family Clinic",
    category: "clinic",
    area: "Gandhi Nagar",
    lat: 32.7105,
    lng: 74.8602,
    hours: week(
      [r("09:00", "13:00"), r("17:00", "20:30")],
      [r("09:00", "13:00")],
    ),
    queues: [q("OPD", 6, 6, true), q("Pharmacy", 4, 3)],
  },
  {
    name: "Trikuta Pathology Lab",
    category: "lab",
    area: "Trikuta Nagar",
    lat: 32.6962,
    lng: 74.8685,
    hours: week(
      [r("07:00", "19:00")],
      [r("07:00", "19:00")],
      [r("07:00", "12:00")],
    ),
    queues: [q("Sample collection", 8, 4, true), q("Report counter", 3, 3)],
  },
  {
    name: "Bakshi Nagar Mobile Point",
    category: "service_centre",
    area: "Bakshi Nagar",
    lat: 32.7372,
    lng: 74.8745,
    hours: week([r("10:00", "20:00")]),
    queues: [q("Repairs", 3, 12)],
  },
  {
    name: "Glow Unisex Salon",
    category: "salon",
    area: "Rehari",
    lat: 32.7402,
    lng: 74.8555,
    hours: week(
      [r("10:00", "21:00")],
      [r("10:00", "21:00")],
      [r("10:00", "21:00")],
    ),
    queues: [q("Walk-ins", 2.5, 20, true)],
  },
  {
    name: "Talab Tillo Health Centre",
    category: "clinic",
    area: "Talab Tillo",
    lat: 32.7468,
    lng: 74.8462,
    hours: week([r("08:00", "14:00")]),
    queues: [q("General OPD", 8, 5, true), q("Dental", 2, 15)],
  },
  {
    name: "Janipur Diagnostics",
    category: "lab",
    area: "Janipur",
    lat: 32.7515,
    lng: 74.8378,
    hours: week([r("08:00", "18:00")]),
    queues: [q("Blood tests", 6, 4)],
  },
  {
    name: "Channi Bill Payment Centre",
    category: "other",
    area: "Channi Himmat",
    lat: 32.687,
    lng: 74.88,
    hours: week([r("09:30", "17:30")]),
    queues: [q("Counter", 7, 4)],
  },
  {
    name: "Raghunath Bazar Barbers",
    category: "salon",
    area: "Raghunath Bazar, Old City",
    lat: 32.7299,
    lng: 74.8647,
    hours: week(
      [r("08:00", "22:00")],
      [r("08:00", "22:00")],
      [r("08:00", "22:00")],
    ),
    queues: [q("Haircut", 3, 15)],
  },
  {
    name: "Residency Road Eye Care",
    category: "clinic",
    area: "Residency Road",
    lat: 32.7323,
    lng: 74.862,
    hours: week([r("10:00", "14:00"), r("17:00", "20:00")]),
    queues: [q("Eye OPD", 4, 8, true)],
  },
  {
    name: "Shastri Nagar Bike Service",
    category: "service_centre",
    area: "Shastri Nagar",
    lat: 32.7056,
    lng: 74.8781,
    hours: week([r("09:00", "19:00")]),
    queues: [q("Service desk", 3, 15)],
  },
  {
    name: "Nanak Nagar Dental Studio",
    category: "clinic",
    area: "Nanak Nagar",
    lat: 32.7003,
    lng: 74.8655,
    hours: week([r("10:00", "13:00"), r("16:00", "20:00")]),
    queues: [q("Dental chair", 2, 20)],
  },
  {
    name: "Sainik Colony Gas Refill Point",
    category: "other",
    area: "Sainik Colony",
    lat: 32.6755,
    lng: 74.9035,
    hours: week([r("09:00", "17:00")]),
    queues: [q("Refill booking", 6, 3)],
  },
];
