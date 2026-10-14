# QPeer: See the Line Before You Go

### Pitch: the problem, the product, who pays, and where it goes

> **Check the queue from home. Join it from anywhere. Pay only if you want to skip the trip or the wait.**

---

## 1. What QPeer Is

QPeer is a **map and app for queues**. Wherever people wait, such as a clinic, a lab, a vehicle service centre or a salon, QPeer shows the live queue and lets people join it.

A customer opens QPeer and sees nearby places on a map, each with:

- **how many people are waiting now**
- **the estimated wait time**
- **the star rating and reviews from verified visitors**
- **the average service and waiting time over recent weeks**

Then the customer chooses how to join:

| How they join | Cost | How it works |
|---|---|---|
| **Walk-in** | **Free** | Go to the place, scan the QR code at the counter, get a token, and wait anywhere nearby. |
| **Reserve from home** | Small fee | Book a place in the queue without travelling. QPeer says when to leave home. |
| **Priority Pass** | Higher fee | Get served earlier for the same service. *(The exact rules are still being decided. See Section 5.)* |

Part of every fee goes to the business, and part goes to QPeer.

For the business, QPeer replaces the token system and the crowd at the counter. It also adds **a new source of income and analytics about their own queue**.

---

## 2. The Problem

### For customers: the wasted trip and the wasted wait

- **You don't know how long the line is until you get there.** People spend time and money to travel to a clinic or service centre, only to find a two-hour wait.
- **Then you have two bad choices.** You can stand in the line for hours, or you can go home and come back another day, which means paying the travel cost twice.
- **You can't step away.** Without a clear wait time, people watch the counter in case they miss their turn.
- **You can't compare places.** The clinic or garage next door may have no wait at all, but there is no way to know.
- **Online reviews say nothing about waiting.** Ratings on maps and booking apps rarely show how long people actually waited, and many of these ratings can't be checked.

### For businesses: the crowd costs money

- **Customers leave.** A long, unclear wait sends people to a competitor before they are served, or stops them from coming at all.
- **The waiting area is full and chaotic.** Staff spend time answering "When is my turn?" and settling arguments about the order.
- **Staff lose time taking bookings by phone.** Many clinics already take "book my number" calls every morning, with no system behind them.
- **No data.** Owners guess when the peak hours are, whether waits are getting longer, and when they need another counter or more staff.
- **Waiting is time with no income.** People spend hours on the premises, and the business earns nothing from it.

> **The core problem: people waste time and money because they can't see, join or skip a queue without being physically there. Businesses lose customers and income because of the same queue.**

---

## 3. How QPeer Solves It

### The customer's journey

```text
TODAY                                   WITH QPeer

Travel to the clinic                    Open the QPeer map at home
   ↓                                       ↓
Find a 2-hour wait                      Compare 3 nearby clinics: wait, rating, distance
   ↓                                       ↓
Stand in line, or go home               Pick one, and join:
and come back another day                 • Reserve from home (small fee), or
   ↓                                       • Walk in and scan the QR (free)
Watch the counter for hours                ↓
   ↓                                    "8 ahead · about 25–35 min · leave home by 11:10"
Get served                                 ↓
                                        Arrive on time, get served
                                           ↓
                                        Rate the visit (verified, because QPeer knows you were served)
```

### The business's journey

```text
Sign up  →  Put the QPeer QR at the counter  →  Call the next customer (one tap, or automatically from billing)
         →  Receive your share of the fees    →  See your queue analytics
```

The business does not have to buy machines or change how it delivers the service. QPeer handles only the waiting.

---

## 4. Features

### 4.1 Live queue map

Customers see live queue length, estimated wait, rating and distance for nearby places on one map. They can decide where to go **before** they leave home.

- People don't waste trips on places with long waits.
- People spread out across places instead of crowding one.
- A business with a short wait gets customers it would otherwise never have had.

### 4.2 Free walk-in joining

Anyone at the premises can scan the QR code and get a token for free. They don't need an account, a phone number, or any personal details. They can wait in a café, in their car, or outside, and they get an alert when their turn is near.

People without a smartphone get a paper slip with a token number **in the same single queue**. Nobody is left out.

### 4.3 Reserve from home

For a small fee, a customer can join the queue without travelling to the premises.

- **You pay to skip the trip, not to jump ahead of anyone.** Your place in the queue is fixed at the moment you pay, in the same order as walk-ins.
- **"Leave home by" alerts** take travel time into account.
- **Part of each hour's places are kept for walk-ins**, so remote bookings can't fill the day before anyone arrives.
- **The fee works as a deposit.** If you don't show up, you lose it, and part of it goes to the business. A no-show costs the business nothing.

### 4.4 Priority Pass *(rules still to be decided)*

For a higher fee, customers can be served earlier for the same service. Section 5 explains the open decision about how it works.

### 4.5 Analytics for the business

The business sees its own queue data. This covers more than the daily totals: it includes **trends and patterns over time**:

- peak hours for each day of the week
- whether average waiting time is rising over weeks or months
- average service time per counter
- how many customers left before being served
- income from reservations and priority fees
- **comparison with similar businesses nearby**, for example "your average wait is 40% longer than other labs in your area"

This helps owners answer practical questions: *When do we need another counter? Is service getting slower? Which hours should we staff more?*

### 4.6 Verified reviews and ratings

After a visit, customers can give a star rating and write a review. **Only people whose token was actually served can review**, so QPeer reviews come from real visits, which most review sites can't promise.

Over time each business on the map shows:

- star rating and reviews
- average waiting time
- average service time
- how accurate its estimated wait times are

Customers can then pick the best place to go, and judge whether a reservation or Priority Pass there is worth paying for.

**Rankings can't be bought.** A business's position and rating depend only on verified visit data. Paid promotion, if we ever offer it, will always be clearly labelled "Sponsored".

---

## 5. Open Decision: How the Priority Pass Works

This decision is still open and needs agreement from the project team before launch.

**Option A: "VIP Entry: pay to skip the queue"**
A paid pass moves the customer ahead of free customers. This is the simplest to explain and the strongest marketing message.

**Option B: Limited priority**
A paid pass moves the customer ahead, but with limits that protect everyone else:

- a maximum number of passes per hour, for example 1 for every 10 regular tokens
- free customers see it openly, for example "2 priority entries ahead of you", and their time estimates include them
- never used for medical urgency. Medical triage always comes first and is never sold.
- not offered at public hospitals or government offices

**Why the limits matter:** Each priority pass delays every free customer. Without limits:

- free customers' time estimates become unreliable, which damages the trust in the map (4.1) and the reviews (4.6)
- free customers may turn against the business and leave bad reviews
- selling priority in healthcare can raise ethical and legal problems

India already accepts paid fast lanes when they have clear rules, such as Tatkal train tickets, Tatkal passports and paid special-entry darshan at temples. Option B follows that model.

---

## 6. Who Pays: Target Customers

QPeer sells to **private businesses that serve mostly walk-ins and compete for customers**. For these businesses, a long or unclear wait means lost income.

### What makes a good customer

1. Mostly walk-ins, with regular waits of more than 30 minutes
2. A competitor nearby
3. The owner decides alone, with no tender or committee
4. Already pays for software or marketing
5. Doesn't profit from the crowd

### Target customers, in priority order

| # | Segment | Who decides | Why they join |
|---|---|---|---|
| 1 | **Private clinics and polyclinics** (GPs, paediatricians, gynaecologists, dermatologists, orthopaedists), especially busy doctors in tier-2/3 cities | Doctor-owner | Packed waiting rooms, morning phone calls for tokens, patients going to rival clinics |
| 2 | **Diagnostic labs and imaging centres** | Owner or chain operations head | Morning sample rush, crowded X-ray and ultrasound queues, a competing lab nearby |
| 3 | **Two-wheeler and car service centres** | Dealer owner or service manager | Weekend rush, customers going to local garages |
| 4 | **Mid-size private hospitals' outpatient departments** | Hospital admin | Competing for patients, crowded halls |
| 5 | **Salons and barbers** | Owner | Weekend queues. Free to join, earning only from fees |
| 6 | **Busy restaurants** | Owner or manager | Weekend waitlists, walk-outs |
| 7 | **Chains**: bank branches, telecom and phone service stores, insurance offices | Regional operations head | Replacing token machines with something that needs no hardware and supports remote waiting |
| 8 | **Colleges and universities** | Registrar | Admission and fee-counter crowds. Used for pilots, not revenue |

### The customers who wait

The **walk-in lane is free for everyone**. People who pay for reservations or priority are usually:

- working professionals who can't spend a morning in a waiting room
- parents with sick children
- adult children booking for elderly parents
- people who live far from the business

### Who we don't target (for now)

- places that are fine with crowding, or that profit from informal priority
- public hospitals and government offices. These come later, and only with clear rules and support from the authorities in charge.

---

## 7. Business Model

### Income

| Source | Who pays | How |
|---|---|---|
| **Reservation fee** | Customer | Small fee per booking, shared between the business and QPeer |
| **Priority Pass fee** | Customer | Higher fee, shared between the business and QPeer |
| **No-show deposits** | Customer who doesn't arrive | Shared between the business and QPeer |
| **Pro plan** | Business | Monthly fee for advanced analytics, comparison with nearby businesses, billing-software integration, TV display and multiple counters |
| **Chain contracts** | Chains and brands | One contract for many branches |
| **Engine licensing** (later) | Other platforms | Using QPeer's queue engine inside their apps (see Section 10) |

### Why a business says yes

> **"QPeer costs you nothing to start, earns you money from people who are already waiting, brings you customers from the map, and tells you exactly when your queue is the problem."**

- **New income:** a share of every reservation, Priority Pass and missed booking
- **More customers:** found on the map, especially when the wait is short
- **Calmer premises:** fewer people crowding the counter
- **Less staff time:** no phone bookings, no "When is my turn?"
- **Data:** peak hours, trends, and comparison with nearby businesses
- **Nothing to buy:** a QR code and a phone. Integration with billing systems is optional.

Exact fee amounts and revenue shares will be set after interviews and pilots with businesses.

---

## 8. Existing Solutions and How QPeer Is Different

| Solution | What it does | What's missing |
|---|---|---|
| **Paper tokens and token display boards** | Fixes the order at the counter | You must stay nearby. No wait time. No data. Easy to manipulate. |
| **Queue machines and kiosks** (Qmatic, Wavetec, local vendors) | Prints tokens, shows numbers on screens | Expensive hardware. People still wait in the hall. No income for the business. |
| **Waitlist software** (Waitwhile, Qminder, QLess, Qwaiting) | Online waitlists for businesses | Usually a monthly cost only. No map for discovering businesses. Not built for Indian walk-in businesses. |
| **Doctor booking apps** (Practo and similar) | Appointment booking and reviews | Built around appointments, not live walk-in queues. Reviews are not tied to a verified, served token. |
| **Restaurant booking apps** (Zomato's District, Swiggy Dineout) | Table reservations | Restaurants only. No live walk-in queue. |
| **Map apps** (Google Maps) | Reviews, "popular times" estimates | Shows that a place is busy, but you can't join the queue or see the real number of people waiting. |

### What makes QPeer different

1. **Live queue data on a map.** QPeer shows the real number of people waiting, not just an estimate of how busy a place is.
2. **One queue, three ways in.** Free walk-in, paid reservation and Priority Pass all share one fair and visible order.
3. **Verified-visit reviews.** Only customers who were actually served can rate a business.
4. **Queue performance in the ratings.** Ratings include waiting time and how accurate the estimates were, not just star ratings.
5. **The business earns money.** Unlike queue machines and waitlist software, QPeer is an income source, not just a cost.
6. **Built for walk-in businesses in India**: QR joining, paper-slip fallback, regional languages, and prices that suit Indian businesses.

---

## 9. Impact

Making money and doing good don't conflict here, because the free walk-in lane is always available.

- **Time saved:** no wasted trips, and no hours standing at a counter
- **Less crowding:** people wait anywhere, and crowds spread across nearby businesses
- **Easier for people who struggle to stand in line:** the elderly, the sick, pregnant women, people with disabilities, and parents with small children
- **Clearer for customers:** live numbers and verified reviews show which businesses serve people well
- **Better service over time:** analytics and public waiting-time ratings encourage businesses to add counters and speed up service
- **Privacy in the free lane:** walk-in customers don't give any personal details

---

## 10. Vision

### Mission

> **Partner with every business that has a waiting line, turn waiting time into a new source of income for that business by selling convenience, and give every customer a better experience for free.**

### Stage 1: Win one category in one city

Sign up every busy clinic and diagnostic lab in **one tier-2 city**. A queue map is only useful when it shows enough places nearby, so it's better to cover one city well than many cities thinly.

### Stage 2: More categories, more cities

Add vehicle service centres, salons, private hospitals and restaurants. Expand city by city, keeping the same app and the same QR code.

### Stage 3: A trusted map for every service

QPeer becomes the place people check **before going anywhere they might have to wait**. It offers live queues, verified ratings, real waiting-time data, and a way to join or skip the line from home.

### Stage 4: The queue engine behind other apps

Once QPeer connects thousands of businesses and has years of real waiting-time data, other platforms may want to use it instead of building their own. For example, a restaurant booking app could show "live queue: 12 waiting · join from home" using QPeer behind the scenes. This is a long-term option, not part of the core plan.

---

## 11. Why This Is Feasible

- **People already scan QR codes,** because UPI made it a daily habit in India.
- **Businesses don't need new hardware,** just a printed QR code and a phone.
- **Customers already pay for convenience,** for example Tatkal tickets, delivery fees and booking fees.
- **Clinics already take phone bookings informally.** QPeer turns that habit into a proper system.
- **The software can be built by a small team** using widely available app, map and payment services.
- **The first market is small and reachable:** clinics and labs in one city, sold to owners who decide alone.

### Main risks and our plan

| Risk | Plan |
|---|---|
| The map is empty at first, so few people use it | Fill one category in one city before expanding |
| Paid entries make free customers angry | Limits on priority, a share of places kept for walk-ins, open display, and a free lane that always moves |
| People think ratings are paid for | Ratings come only from verified visits, and higher rankings are never sold |
| Businesses with slow service don't want public wait times | Start with private analytics, and show public numbers once businesses opt in or have been listed for a set time |
| Remote bookers don't show up | Deposits, "leave home by" alerts and a grace period |
| Large map or booking platforms copy the idea | Move fast in one niche, and build strong relationships with businesses and a record of real waiting-time data |

---

## 12. In One Line

> **QPeer shows you every queue near you, lets you join it for free on-site or from home for a small fee, and turns the time people spend waiting into income for the businesses that serve them.**
