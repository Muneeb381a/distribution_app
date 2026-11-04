# Distribution Application: Product & Engineering Plan

**Version:** 1.1 (updated with the client's answers)
**Date:** 4 November 2026
**Sources of requirements:**
1. WhatsApp voice note `PTT-20261103-WA0017.opus` (2 min 29 s, Punjabi with some Urdu/English words)
2. Muneeb's written answers to the open questions (4 November 2026), see [§7](#7-decisions-log-answers-to-the-open-questions)

**Status:** Requirements come only from these two sources. Where the client said "search online", I researched and made a decision with sources. Questions still open are in [§8](#8-still-open).

### What changed from v1.0
- Rice is **sold at the shop and delivered** to shops, like bottles.
- **Multiple godowns**, and the shop's stock is separate from the godown's.
- **Salesman/vehicle tracking** on each sale.
- **Supplier accounts** (Coke/Pepsi distributors, rice mills).
- **Credit limits** for udhaar shopkeepers.
- **Payment slips** printed for every payment, with a full ledger of who paid what.
- **Part-cash / part-udhaar** bills.
- **Empty bottle/crate deposits** and **returns** of damaged or expired items.
- **Daily-wage workers, commissions and attendance/leave deductions.**
- **User roles** for owner and employees.
- **Offline-capable web app.**
- Bills on **thermal, A4 and WhatsApp PDF**, in **Urdu and English**.
- **Import** of old khata registers, customers and stock.
- Cost method is **latest purchase price**.

---

## 0. How this plan was produced

1. The audio was transcribed with OpenAI Whisper (`small` model, via faster-whisper) in four passes: Hindi script, Urdu script, Urdu→English and Punjabi→English. Larger models were blocked by the network in this environment, so I reconstructed the meaning by reading the passes side by side.
2. The client then confirmed the uncertain points: about 45–46 bottle items, and sizes 1 L, 1.5 L, 1.75 L and 2.25 L.
3. The client answered the follow-up questions in writing. Where an either/or question was answered with a bare "yes", this plan reads it as **"all of the options"** and says so.

---

## 1. What the voice note says (reconstructed)

| Time | What was said (English meaning) |
|---|---|
| 0:00–0:20 | "Our requirement is this: we have a **rice (chawal) shop**, and we also do **bottle (soft drink) distribution**, meaning we sell **wholesale to shops** by going to the shops. We have a **godown**, shops, **employees** and **customers**. We need a **complete distribution management system**." |
| 0:20–0:40 | "We should know **how much stock is in the godown**. In bottles alone we have about **45–46 items**, such as **Coke 1 L, 1.5 L, 1.75 L, 2.25 L**, **Pepsi, Sprite** and other products. Rice also has its categories." |
| 0:40–1:00 | "Rice has categories, such as **Super Kernel**. I want **bottle sales and rice sales kept separate**. I want to **add each shopkeeper as a customer**, so we know **each shopkeeper's rate**." |
| 1:00–1:20 | "**Not every shop gets the same rate**; we put **our own rate**, and the **bill is generated**. **At the end of the day** we should know **how many bottles and how much rice were sold**, what **they cost us**, and **the whole day's expenses**." |
| 1:20–1:40 | "Our total, **what we saved (profit)**, daily and **monthly**. For rice: **how much we sold and how much we bought**. These are the **reports** we need." |
| 1:40–2:00 | "Then an **employee management system**. We pay **salaries**, but during the month employees **take advances**. I should be able to add those, e.g. **1,000 the first time, 2,000 the second time**…" |
| 2:00–2:20 | "…**deducted automatically from their salary**. Some shopkeepers **pay cash (naqd)**, some take **credit (udhaar)**. Credit shopkeepers have **one running ledger (khata)**." |
| 2:20–2:29 | "When they make their **next purchase**, the **previous balance appears on the bill**. We need a whole system like this." |

---

## 2. Business context

- **Two business lines**, kept separate in sales and reports:
  1. **Rice:** sold over the counter at the rice shop **and delivered to shops**. Sold **loose and packed**, by **kg, maund and bag**.
  2. **Bottled soft drinks:** Coke, Pepsi, Sprite and others, about **45–46 items**, sizes including **1 L, 1.5 L, 1.75 L, 2.25 L**. Delivered wholesale to shops by **vehicle and salesman**.
- **Locations:** **more than one godown**, plus the **shop**, which has its own separate stock.
- **People:** the owner; **employees** (salaried, daily-wage, and some on commission), who use the app with permissions; **customers** (shopkeepers, cash or udhaar, with credit limits); **suppliers** (Coke/Pepsi distributors, rice mills).
- **Billing:** a simple bill is enough. No GST/FBR invoice.

---

## 3. Requirements

Source codes: **VN** = voice note (timestamp), **A-n** = answer to question n (see §7), **R** = research-based decision (see §7).

### 3.1 Products, categories & units
| ID | Requirement | Source |
|---|---|---|
| PR-1 | Products belong to one of **two business lines: Bottles, Rice**. | VN 0:00 |
| PR-2 | Products have **categories**: bottles by brand and size; rice by variety and form (see §7.1). | VN 0:20–0:45, R |
| PR-3 | Bottles: about 45–46 SKUs, each with **brand, flavour and size** (1 L, 1.5 L, 1.75 L, 2.25 L, others). | VN 0:25, A-1 |
| PR-4 | Bottles are sold by **carton and single bottle**. The **default carton is 6 bottles**, editable per product (see §7.2). | A-5, R |
| PR-5 | Rice is sold by **kg, maund (40 kg) and bag**. Bag sizes are set per product (e.g. 5, 10, 25, 50 kg). | A-6 |
| PR-6 | Rice can be **loose or packed**: separate SKUs, or the same variety in different packings. | A-6 |
| PR-7 | Stock is held in one **base unit** (bottle; kg). Every other unit converts to it. | A-5, A-6 |

### 3.2 Locations & stock
| ID | Requirement | Source |
|---|---|---|
| ST-1 | **Multiple locations**: several godowns, the shop, and each delivery **vehicle**. | A-7, A-4 |
| ST-2 | Stock is shown **per location** and in total. | VN 0:20, A-7 |
| ST-3 | **Stock transfers** between locations (godown → shop, godown → vehicle, vehicle → godown). | A-7, A-4 |
| ST-4 | Stock goes up on purchases and returns, down on sales and write-offs, and moves with transfers. | VN 1:20, A-14 |
| ST-5 | **Damaged/expired returns** go to a separate "damaged" status, not back to saleable stock, unless approved. | A-14 |

### 3.3 Suppliers & purchases
| ID | Requirement | Source |
|---|---|---|
| PU-1 | Keep **supplier accounts** (Coke/Pepsi distributors, rice mills), each with its own **ledger**. | A-9 |
| PU-2 | Record purchases: supplier, location received into, items, quantity, unit and **purchase price**. | VN 1:25 |
| PU-3 | Record **payments to suppliers**, in full or part. | A-9 |
| PU-4 | Record **returns to suppliers**, e.g. damaged or expired stock sent back. | A-14 |
| PU-5 | Track **empties/crates owed to or by suppliers**. | A-14 |

### 3.4 Customers (shopkeepers)
| ID | Requirement | Source |
|---|---|---|
| CU-1 | Add shopkeepers as customers: name, shop, phone, address, **area/route**. | VN 0:50 |
| CU-2 | Each customer can have a **fixed rate per product**. The rate can also be **changed on each bill**. | VN 0:55–1:05, A-13 |
| CU-3 | Customers are **cash** or **udhaar**. | VN 2:05 |
| CU-4 | Udhaar customers have a **running ledger (khata)**. | VN 2:15 |
| CU-5 | Each udhaar customer has a **credit limit**. The app **warns** when a bill would cross it. Only users with a special permission (e.g. the owner) can **override** it. | A-10 |
| CU-6 | Track **empty bottles/crates held by each customer**, and any **deposit** charged or refunded. | A-14 |

### 3.5 Sales & billing
| ID | Requirement | Source |
|---|---|---|
| SA-1 | **Bottle and rice sales are kept separate**: a bill belongs to one line, with separate numbering and reports. | VN 0:45 |
| SA-2 | Two sale types: **counter sale** at the shop and **delivery sale** from a vehicle. Both apply to rice and bottles. | A-3, A-4 |
| SA-3 | Every sale records the **salesman** and, for deliveries, the **vehicle**. | A-4 |
| SA-4 | The rate pre-fills from the customer's fixed rate and can be edited if the user has permission. | A-13 |
| SA-5 | A bill can be paid **in full cash, fully on udhaar, or part cash + part udhaar**. | VN 2:05, A-12, R |
| SA-6 | The bill shows **previous balance, this bill, paid now, and new balance**. | VN 2:20 |
| SA-7 | Bills can be **empties-aware**: empties delivered and collected are shown on the bill. | A-14 |
| SA-8 | **Customer returns** (damaged/expired) are recorded as a sale return with a credit to the khata. | A-14 |
| SA-9 | Bill output: **thermal (58/80 mm), A4, and a WhatsApp-shareable PDF**, in **Urdu and English**. | A-21 |
| SA-10 | No GST/FBR fields. Simple bill. | A-16 |

### 3.6 Payments & collection
| ID | Requirement | Source |
|---|---|---|
| PA-1 | The **owner and permitted employees** record payments received from shopkeepers. | A-11 |
| PA-2 | Every payment prints or shares a **payment slip** (receipt) with the receipt no., amount, previous balance and new balance. | A-11 |
| PA-3 | The **full ledger** shows who paid how much, when, and **which user recorded it** ("kab, kis ne, kitni payment ki"). | A-11 |
| PA-4 | Payment methods: cash and others (bank, JazzCash/Easypaisa, cheque). The list is configurable. See Q-B. | A-11 |

### 3.7 Expenses
| ID | Requirement | Source |
|---|---|---|
| EX-1 | Record expenses with date, amount, category and note. | VN 1:15 |
| EX-2 | Default categories: **utility bills, rent, salaries**. More can be added. | A-15 |
| EX-3 | An expense can be tagged **Bottles, Rice or Shared**, so each line's profit can be reported. Shared costs are reported separately unless an allocation rule is chosen (Q-C). | A-15 |
| EX-4 | Paid salaries post to the "salaries" expense automatically. | A-15 |

### 3.8 Employees & payroll
| ID | Requirement | Source |
|---|---|---|
| EM-1 | Employee types: **monthly salaried, daily-wage, and commission** (commission can also be added on top of salary). | VN 1:40, A-18 |
| EM-2 | Record **advances** any number of times in a month. | VN 1:45 |
| EM-3 | Advances are **deducted automatically** at salary time. | VN 2:00 |
| EM-4 | If advances exceed the salary, the **excess carries to next month**. | A-17 |
| EM-5 | **Attendance and leave** are recorded, and absences are deducted by rule (see Q-D). | A-18 |
| EM-6 | **Commission** is calculated from the salesman's sales (rule to confirm, Q-E). | A-18 |
| EM-7 | Daily-wage workers are paid per day worked. | A-18 |
| EM-8 | Salary slip: gross, commission, deductions, advances, carry-forward, net paid. | VN 2:00 |

### 3.9 Users & permissions
| ID | Requirement | Source |
|---|---|---|
| US-1 | The **owner and employees** log in with their own accounts. | A-19 |
| US-2 | **Role-based permissions**, e.g. Owner (everything), Cashier/Shop, Salesman, Godown keeper. | A-19, A-11 |
| US-3 | **Audit log:** every bill, payment, rate change and stock change records who did it and when. | A-11 |

### 3.10 Offline
| ID | Requirement | Source |
|---|---|---|
| OF-1 | The web app works **without internet** for selling, recording payments and printing slips. Data syncs when back online. **Decision (kickoff):** offline is needed on the **PC only**. Phones and tablets stay online-only. | A-20 |

### 3.11 Reports
| ID | Requirement | Source |
|---|---|---|
| RE-1 | **End-of-day:** per line, quantity sold, sales value, cost, gross profit; expenses; **net profit**; cash received vs. udhaar given. | VN 1:08–1:25 |
| RE-2 | **Monthly** version of RE-1. | VN 1:25 |
| RE-3 | **Rice: sold vs. purchased**, by variety. | VN 1:30 |
| RE-4 | **Customer ledger/statement** and an **outstanding balances** list, including customers over their credit limit. | VN 2:15, A-10 |
| RE-5 | **Supplier ledger** and payables. | A-9 |
| RE-6 | **Stock by location**, plus a stock movement history. | A-7 |
| RE-7 | **Salesman/vehicle report:** sales, collections, commission, empties. | A-4, A-18 |
| RE-8 | **Empties report:** held by customers, owed to suppliers. | A-14 |
| RE-9 | **Returns/damaged** stock report. | A-14 |
| RE-10 | **Payroll** report: salaries, advances, carry-forward. | VN 1:40, A-17 |
| RE-11 | **Collections log:** payments by user and by day. | A-11 |

### 3.12 Data import
| ID | Requirement | Source |
|---|---|---|
| IM-1 | Import **customers, opening khata balances, products and opening stock** from Excel/CSV templates. Paper khata registers are entered as opening balances. | A-23 |

### 3.13 Still out of scope
Not requested: GST/FBR invoicing (A-16 says a simple bill is enough), GPS live tracking, an online ordering portal for shopkeepers, schemes and discounts, barcode scanning. Any of these can be added later.

---

## 4. Solution overview

A single **offline-capable web app (PWA)**. It is used on a PC at the shop and godown, and on phones/tablets by salesmen. Only the PC works offline; phones need internet.

```
┌───────────────────────────────────────────────────────────────────┐
│                  Distribution App (PWA, offline)                  │
├───────────────┬───────────────┬───────────────┬───────────────────┤
│ Products,     │ Locations &   │ Purchases &   │ Sales & Billing   │
│ Units, Rates  │ Stock/Transfer│ Supplier Khata│ (counter/delivery)│
├───────────────┼───────────────┼───────────────┼───────────────────┤
│ Customer Khata│ Payments &    │ Empties &     │ Expenses          │
│ & Credit Limit│ Receipt Slips │ Returns       │                   │
├───────────────┼───────────────┼───────────────┼───────────────────┤
│ Employees,    │ Reports       │ Users, Roles  │ Import / Backup   │
│ Attendance,   │ (day/month/…) │ & Audit Log   │                   │
│ Payroll       │               │               │                   │
└───────────────┴───────────────┴───────────────┴───────────────────┘
```

---

## 5. Key workflows

### 5.1 Delivery day (bottles or rice)
1. **Load vehicle:** transfer stock from godown → vehicle, assigned to a salesman (ST-3).
2. **At each shop:** create a bill. Rates pre-fill. Record empties delivered and collected. Record any damaged/expired return. Take payment as cash, udhaar or part of each. The credit-limit check runs. Print or share the bill (works offline).
3. **Return to godown:** unload the remaining stock and empties back to the godown, and settle the vehicle by reconciling cash collected against bills.
4. Sync when online.

### 5.2 Counter sale at the shop
Same as 5.1 step 2, from the **shop** location, with no vehicle.

### 5.3 Bill layout
```
Previous balance        Rs 12,000
This bill               Rs  8,500
Returns credit         −Rs    500
Paid now (cash)        −Rs  2,000
-----------------------------------
New balance             Rs 18,000
Empties: given 6 · collected 4 · held by shop 14
Credit limit Rs 25,000 · available Rs 7,000
```

### 5.4 Receiving a payment
Select customer → amount → method → save. A **receipt slip** prints or shares, showing previous and new balance. The ledger entry stores the user who recorded it (PA-1 to PA-3).

### 5.5 Purchases from suppliers
Choose supplier and godown → items, quantity, unit, price → save. Stock goes up, the supplier khata goes up, and the **latest cost** is updated (§7.4). Pay suppliers in full or part.

### 5.6 Payroll (month end)
For each employee: base (monthly salary or days × daily wage) + commission − attendance/leave deductions − advances − previous carry-forward = **net**. A negative net carries to next month (EM-4). Print the slip and post the expense.

### 5.7 End of day
Day report (RE-1) per line, plus vehicle settlements and the collections log.

---

## 6. Data model (draft)

```
-- master data
business_line      (id, name: BOTTLES | RICE)
category           (id, business_line_id, name, parent_id)        -- Coke > 1.5 L ; Basmati > Super Kernel > Sella
product            (id, category_id, name, brand, size, base_unit: BOTTLE|KG, is_packed, is_active,
                    returnable_empty BOOL)
product_unit       (product_id, unit_name: BOTTLE|CARTON|KG|MAUND|BAG, factor_to_base)   -- carton=6, maund=40
location           (id, name, type: GODOWN|SHOP|VEHICLE)
employee           (id, name, phone, type: MONTHLY|DAILY, monthly_salary, daily_wage,
                    commission_rule_id, join_date, is_active)
app_user           (id, employee_id NULL, username, role_id, is_active)
role / permission  (role_id, permission_code)                    -- e.g. RATE_EDIT, CREDIT_OVERRIDE, PAYMENT_RECORD
customer           (id, name, shop_name, phone, address, area, type: CASH|CREDIT, credit_limit)
customer_rate      (customer_id, product_id, unit_name, rate)
supplier           (id, name, phone, type: BEVERAGE|RICE_MILL|OTHER)

-- stock
stock_movement     (id, product_id, location_id, qty_base, status: OK|DAMAGED, type:
                    PURCHASE|SALE|TRANSFER_OUT|TRANSFER_IN|SALE_RETURN|PURCHASE_RETURN|ADJUST|WRITE_OFF,
                    ref_type, ref_id, user_id, created_at)
product_cost       (product_id, latest_unit_cost_base, updated_at)           -- latest-cost method

-- purchasing
purchase / purchase_item / purchase_return
supplier_ledger    (id, supplier_id, date, debit, credit, ref_type, ref_id, user_id)

-- sales
sale               (id, bill_no, business_line_id, sale_type: COUNTER|DELIVERY, customer_id,
                    location_id, salesman_id, vehicle_location_id NULL, date,
                    gross, returns_credit, paid_now, payment_method, previous_balance_snapshot,
                    new_balance_snapshot, created_by, device_id, status: ACTIVE|CANCELLED)
sale_item          (id, sale_id, product_id, unit_name, qty, qty_base, rate, unit_cost_at_sale)
sale_return_item   (id, sale_id, product_id, qty_base, reason: DAMAGED|EXPIRED, credit_amount)
customer_ledger    (id, customer_id, date, debit, credit, ref_type: SALE|PAYMENT|RETURN|OPENING|DEPOSIT,
                    ref_id, recorded_by, created_at)
payment_receipt    (id, receipt_no, customer_id, amount, method, recorded_by, created_at)
empties_ledger     (id, party_type: CUSTOMER|SUPPLIER, party_id, product_or_crate_type, qty_out, qty_in,
                    deposit_amount, ref_id)

-- expenses & payroll
expense            (id, date, category, business_line_id NULL /*shared*/, amount, note, user_id)
attendance         (employee_id, date, status: PRESENT|ABSENT|LEAVE|HALF_DAY)
salary_advance     (id, employee_id, date, amount, recorded_by)
payroll_run        (id, employee_id, month, base, commission, deductions, advances, carry_in,
                    net, carry_out, paid_on)

-- system
audit_log          (id, user_id, action, entity, entity_id, before_json, after_json, at)
```

Design notes:
- **Ledgers, not balances.** Each customer and supplier balance is the sum of ledger entries. The bill stores a **snapshot** of previous and new balance, so reprints match what the customer saw.
- **Cost at sale is frozen** on each sale line (`unit_cost_at_sale` = the latest cost at that moment), so past profit never changes.
- **Units:** everything is stored in base units (bottle, kg). `product_unit.factor_to_base` converts cartons, maunds and bags.
- **Offline-safe IDs:** use UUIDs generated on the device. Bill and receipt numbers carry a **device prefix** (e.g. `B-V2-000123`), so two offline devices can never create the same number.

---

## 7. Decisions log (answers to the open questions)

| Q | Question (short) | Client answer | Decision in this plan |
|---|---|---|---|
| 1 | About 45–46 bottle items; sizes 1 L/1.5 L/1.75 L/2.25 L? | Yes | Confirmed (PR-3). |
| 2 | Rice categories? | "Search online" | Researched; see §7.1. |
| 3 | Rice: shop only or also delivered? | Both | Counter and delivery sales for rice (SA-2). |
| 4 | Bottles by vehicle or salesman? Track who sold? | Yes | Read as **both vehicle and salesman, and yes, track** (SA-3, ST-1). |
| 5 | Carton, crate or single? Bottles per carton? | 6 per carton; "search online" | Carton + single; default 6, editable per product; see §7.2. |
| 6 | Rice by kg, maund or bag? Loose or packed? | Both | Read as **all units, loose and packed** (PR-5, PR-6). |
| 7 | More than one godown? Shop stock separate? | Yes | Multiple godowns; shop is its own location (ST-1). |
| 8 | Cost method? | Latest | Latest purchase price; see §7.4. |
| 9 | Supplier accounts? | Yes | Supplier ledger (PU-1). |
| 10 | Credit limit? Warn or block? | Yes | Read as **yes, with warn and block**: warn for everyone, block without override permission (CU-5). |
| 11 | How are udhaar payments recorded? | Owner and permitted employees, print slip, complete ledger of who paid how much | PA-1 to PA-3. |
| 12 | Part cash and part udhaar? | "Search yourself" | Researched; **yes, supported**; see §7.3. |
| 13 | Rate fixed per customer or typed per bill? | Both | Fixed default, editable per bill (CU-2, SA-4). |
| 14 | Empties deposits? Damaged/expired returns? | Yes | Both supported (CU-6, SA-7, SA-8, PU-4, PU-5). |
| 15 | Expense categories? Split by line? | Shop expenses like bills, rent, salaries | Default categories set; split rule open (Q-C). |
| 16 | GST/FBR? | Simple bill | No tax fields (SA-10). |
| 17 | Carry excess advance? | Yes | EM-4. |
| 18 | Daily wage, commission, attendance? | Yes | Read as **all three** (EM-1, EM-5 to EM-7). |
| 19 | Users and permissions? | Employees and shop owner | Roles (US-1, US-2). |
| 20 | Offline? | Yes | Offline PWA (OF-1, §9). |
| 21 | Thermal, A4 or WhatsApp? Urdu or English? | Yes | Read as **all three outputs, both languages** (SA-9). |
| 22 | Send balance by SMS/WhatsApp? | *(not answered)* | Still open (Q-A). |
| 23 | Old data to import? | Yes | IM-1. |
| 24 | Budget, timeline, platform? | Web app | Web app. Budget and timeline still open (Q-F). |

### 7.1 Rice categories (research)
Pakistan's main commercial rice varieties are **1121 Basmati, Super Kernel Basmati, D-98 Basmati** (basmati), and **PK-386, IRRI-6, IRRI-9** (non-basmati). They are sold in different **forms**: **white/raw, sella (parboiled), steam**, and **broken grades** (e.g. IRRI-6 at 5%, 25% or 100% broken) ([PakistanRice varieties](https://pakistanrice-com.pages.dev/varieties/)). TDAP also lists Super Basmati, Basmati 385, Basmati 515, Kissan Basmati, PK-1121 Aromatic, and coarse types such as KS-282 ([TDAP – Pakistan Rice](https://agro.tdap.gov.pk/?p=2299)).

**Decision:** a three-level category tree, **Type → Variety → Form**, which the owner can edit. Starting list:

| Type | Variety | Forms |
|---|---|---|
| Basmati | Super Kernel, 1121, D-98, Super Basmati, 385, 515, Kissan | White, Sella, Steam |
| Non-basmati | PK-386, IRRI-6, IRRI-9, KS-282 | White, Sella, Steam, Parboiled |
| Broken | (per variety) | 5%, 25%, 100% broken ("tota") |

The owner should remove what they don't stock. Brand names (if they sell packed brands) are added as products under the variety.

### 7.2 Bottle pack sizes (research)
Pakistani retail listings show **Coca-Cola 1.5 L × 6** ([Carrefour PK](https://carrefour.pk/mafpak/en/cola/coca-cola-1-5ltrx6/p/47793)), **Pepsi 1 L × 6** ([Carrefour PK](https://carrefour.pk/mafpak/en/cola/pepsi-1ltrx6/p/49287)) and **Coca-Cola 1 L × 6** ([Daraz](https://www.daraz.pk/products/coca-cola-1-l-pack-of-6-i107036675.html)). That matches the client's "6 per carton" for the large sizes. Smaller sizes are packed differently: **500 ml × 12** ([Carrefour PK](https://carrefour.pk/mafpak/en/cola/coca-cola-500mlx12/p/47803)), and 345 ml / 250 ml cans also exist ([foodpanda](https://www.foodpanda.pk/groceries/product/554P45/pepsi-pet-345ml)).

**Decision:** default **6 bottles per carton** for 1 L, 1.5 L, 1.75 L and 2.25 L. **Pack size is a field on each product**, so 500 ml (12) or smaller packs can be set correctly. Sell by carton or single bottle.

### 7.3 Part cash / part udhaar (research)
Standard accounting and distribution software accepts a **partial payment on an invoice**. The invoice stays open with the unpaid balance carried in the customer's account ([Microsoft Dynamics 365 – partial customer payments](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/customer-payments-partial-amount); [Odoo partial payment module](https://apps.odoo.com/apps/modules/17.0/bi_partial_payment_invoice)). It is also how local khata practice works, where a shop pays part now and the rest goes in the khata ([Udhaar Book](https://udhaar.pk/2025/05/20)).

**Decision:** every bill has a **"Paid now"** field. Paid now = total means a cash bill. Paid now = 0 means full udhaar. Anything in between is part cash and part udhaar. The udhaar part is checked against the credit limit. **Cash customers** must pay in full unless a user with permission overrides it.

### 7.4 Latest-cost method: what it means for profit
Each sale's cost is the **most recent purchase price** of that product at the moment of sale. That cost is frozen on the bill line. It is simple and matches how the owner thinks about prices. The trade-off is that if prices rise, older cheaper stock is costed at the new price, so profit on that stock looks slightly lower. A report can still show stock value at latest cost.

---

## 8. Still open

- **Q-A (was Q-22):** Should bills or balance reminders also go to shopkeepers automatically by SMS/WhatsApp? Manual WhatsApp PDF sharing is already included.
- **Q-B:** Which payment methods are used besides cash (bank transfer, JazzCash, Easypaisa, cheque)?
- **Q-C:** How are **shared expenses** (rent, bills) split between bottles and rice for profit: not split, 50/50, or by sales share?
- **Q-D:** Attendance deduction rule, e.g. salary ÷ 30 per absent day? Is there paid leave?
- **Q-E:** Commission rule: % of sales, per carton, or on collections? Which employees earn it?
- **Q-F (was Q-24):** **Budget and timeline.**
- **Q-G:** Empties: is a **cash deposit** charged per empty/crate, or are only counts tracked? What happens when a shop doesn't return empties?
- **Q-H:** Credit limit: one limit for everyone or per customer? Who can override?
- **Q-I:** Roughly how many **users, devices, vehicles and customers** will there be? This sizes the offline sync and hosting.
- **Q-J:** Format of the old data (Excel, paper registers, another software)?

---

## 9. Technical approach

| Concern | Choice | Why |
|---|---|---|
| App type | **Web app, installable PWA, offline-first** | Client chose a web app and needs offline use (A-20, A-24). |
| Frontend | React + TypeScript (Next.js) | Mature; good PWA and printing support. |
| Offline storage | **IndexedDB** on the device (e.g. Dexie or RxDB) with a background **sync queue** | Bills, payments and slips must work without internet. |
| Sync | Each device pushes its operations; the server applies them in a transaction and returns updates. Pre-filled rates, balances and stock are refreshed on every sync. | Prevents lost or duplicate bills. |
| Conflicts | Ledgers and stock are **append-only movements**, so offline writes merge without overwriting. Credit-limit checks offline use the last-synced balance, and the server flags any breach on sync. | Safe merging. |
| Backend | Node.js (NestJS) REST API | Same language as the frontend. |
| Database | **PostgreSQL**, money as `NUMERIC(14,2)` | Transactions and exact amounts. |
| Auth & roles | Username + password, role-based permissions; sessions cached for offline login | US-1, US-2. |
| Printing | Thermal via ESC/POS (browser print with a 58/80 mm layout, or a small print bridge if needed); A4 and PDF rendering | SA-9. Test on the client's actual printer model. |
| Urdu | Nastaliq-capable font (e.g. Noto Nastaliq Urdu) and right-to-left layout on bills and UI | SA-9. Thermal printers need the bill rendered as an image for Urdu. |
| Hosting | Managed VPS or cloud with managed Postgres, **daily backups** with tested restore | Khata data is critical. |
| Import | Excel/CSV templates with validation and a preview before commit | IM-1. |

Engineering rules:
- Every bill, payment, transfer and payroll run is **one transaction**.
- **No hard deletes.** Cancelling creates reversing entries, and the audit log records the user.
- Bill and receipt numbers are sequential **per business line and per device**.
- Permission checks run on the server too, not only in the UI.

---

## 10. Comparable software reviewed

| Product | Relevant features | Gap vs. this request |
|---|---|---|
| [Salesflo](https://www.salesflo.com/?p=17380) (Pakistan) | Order management, credit-limit checks, receivables, promotions, dashboards | Aimed at large FMCG companies; no employee advances. |
| [HysabOne](https://hysabone.com/industries/fmcg/) (Pakistan) | FMCG billing, routes, sales-force app; [guide](https://blog.hysabone.com/?p=43) covers credit limits, vehicle loading sheets, vehicle stock, returns | Payroll not covered. |
| [SoftVirtue DMS](https://softvirtue.com/software/distribution-management) (Pakistan) | Mobile order booking, routes and drivers, per-retailer credit, multiple price lists | Previous balance on bill and payroll not mentioned. |
| [Beatroute](https://beatroute.io/platform/distributor-management-system/distributor-management-software-guide/) | Inventory, claims/returns, account statements, **offline mobile app** | Enterprise-oriented. |
| [Udhaar Book](https://udhaar.pk/2025/05/20) (Pakistan) | Digital khata, simple POS | No multi-location stock or payroll. |

**Takeaway:** the features the client confirmed (vehicle stock, returns, credit limits, offline) are standard in these products, which supports the design. None of them combines two business lines, empties, khata on the bill and payroll with advances in one simple app.

---

## 11. Delivery phases

| Phase | Scope | Outcome |
|---|---|---|
| **0. Discovery** | Answer §8, collect the product list with pack sizes, customer list, rates, old khata balances, a sample bill, and the printer model. | Signed-off requirements and data templates. |
| **1. Foundation** | Users, roles, audit log; products, units, categories; locations; customers with rates and credit limits; suppliers; **data import**. | Master data loaded. |
| **2. Stock & purchasing** | Purchases, supplier ledger and payments, transfers (godown/shop/vehicle), latest cost, damaged stock. | Accurate stock per location. |
| **3. Sales & khata (online)** | Counter and delivery bills, part payment, previous balance on bill, credit-limit check, payment receipts, returns, empties; thermal/A4/PDF in Urdu and English. | Daily selling runs in the app. |
| **4. Offline** | PWA install, offline billing, receipts and printing, sync queue, device-prefixed numbering, conflict flags. | The PC keeps billing without internet. |
| **5. Expenses, payroll & reports** | Expenses; attendance, daily wage, commission, advances with carry-forward, salary slips; all RE-1 to RE-11 reports; vehicle settlement. | Everything in the voice note and answers is done. |
| **6. Go-live** | Parallel run against paper for one week, staff training, backups verified. | Live. |

Durations will be set after Q-F (budget/timeline) and Q-I (scale) are answered. Phase 4 (offline) is the largest technical risk, so a small offline prototype should be built early in Phase 1 to prove printing and sync on the client's devices.

---

## 12. Acceptance criteria

- [ ] Stock is correct per godown, shop and vehicle after purchases, transfers, sales and returns.
- [ ] Bottles sell by carton (default 6, editable per product) and by bottle. Rice sells by kg, maund and bag, loose or packed.
- [ ] Each shopkeeper's fixed rate pre-fills and can be changed per bill by permitted users.
- [ ] Bottle and rice bills are numbered and reported separately.
- [ ] A bill can be full cash, full udhaar, or part of each. It prints previous balance, this bill, paid now and new balance.
- [ ] Crossing the credit limit shows a warning. Saving is blocked without override permission.
- [ ] Each payment prints a slip, and the ledger shows date, amount and the user who recorded it.
- [ ] Empties given and collected are tracked per customer and supplier.
- [ ] Damaged/expired returns credit the khata and go to damaged stock.
- [ ] A salesman can bill, take payments and print **with no internet**. Everything syncs later without duplicates.
- [ ] Bills print on thermal and A4 and share as PDF, in Urdu and English.
- [ ] End-of-day and monthly reports show sales, cost (latest cost), expenses and net profit per line.
- [ ] Rice sold vs. purchased report by variety.
- [ ] Payroll handles monthly and daily-wage staff, commission, attendance deductions, multiple advances and carry-forward.
- [ ] Old customers, balances, products and stock import from Excel.

---

## 13. Testing plan

- **Unit:** unit conversions, latest-cost capture, bill totals with part payment and returns, credit-limit logic, payroll (advances > salary carry-forward, daily wage, commission, absences).
- **Integration:** bill → stock + ledger + empties + audit in one transaction; cancellation reverses everything.
- **Offline/sync:** two devices billing offline at once; sync with no duplicate numbers; the stale credit-limit case is flagged.
- **Printing:** the client's thermal printer model, Urdu rendering, A4, PDF on WhatsApp.
- **UAT:** one week in parallel with the paper registers; totals must match.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Offline sync errors (duplicate bills, wrong balances) | Append-only ledgers, device-prefixed numbers, early prototype, sync tests. |
| Offline credit check uses a stale balance | Server re-checks on sync and flags breaches; frequent sync when online. |
| Urdu on thermal printers | Render the bill as an image; test on the real printer in Discovery. |
| Latest-cost understates profit when prices rise | Explained to the owner (§7.4); stock valuation report. |
| Disputes over khata or payments | Full ledger with recorded-by user, printed slips, no deletes. |
| Bad imported data | Templates, validation and preview; owner signs off on opening balances. |
| Staff misuse (rate edits, overrides) | Permissions plus audit log; override report for the owner. |
| Data loss | Daily automatic backups with tested restore. |
