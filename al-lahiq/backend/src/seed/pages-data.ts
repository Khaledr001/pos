/** Starter content pages (markdown). Staff edit these in the admin panel. */
export const PAGES: { slug: string; title: string; kind: string; excerpt?: string; body: string }[] = [
  {
    slug: 'about',
    title: 'About Al-Lahiq',
    kind: 'page',
    body: `Al-Lahiq Building Materials has supplied contractors, maintenance teams and homeowners across the UAE with plumbing, electrical, sanitary ware, tools and building materials.

## What we stock
- **Plumbing** — PPR and uPVC pipes, fittings, valves, pumps and water heaters
- **Sanitary ware** — mixers, showers, toilets, basins and accessories
- **Electrical** — cables, wiring devices, breakers and lighting
- **Hardware & tools** — power tools, hand tools, fasteners, locks and PPE
- **Paints & chemicals** — interior and exterior paint, sealants and waterproofing
- **Building materials** — cement, tiles, gypsum boards and rebar

## Why buy from us
- Genuine products with manufacturer warranties
- Tax invoices with our TRN on every order
- Trade accounts with project pricing for contractors
- Three branches for pickup: Al Quoz (Dubai), Sharjah Industrial Area and Mussafah (Abu Dhabi)`,
  },
  {
    slug: 'delivery-returns',
    title: 'Delivery & Returns',
    kind: 'page',
    body: `## Courier delivery
We deliver to all seven emirates. Fees depend on the emirate and the total weight, and are shown at checkout before you pay.

| Emirate | From (incl. VAT) | Free over (incl. VAT) | Usually arrives |
|---|---|---|---|
| Dubai | AED 21.00 | AED 525 | Next working day |
| Sharjah, Ajman | AED 26.25 | AED 630 | 1–2 working days |
| Abu Dhabi, Umm Al Quwain | AED 36.75 | AED 787.50 | 2 working days |
| Ras Al Khaimah, Fujairah | AED 42.00+ | AED 945 | 2–3 working days |

Courier orders are limited to 30 kg. Heavy and bulky items such as cement, rebar, gypsum boards and long drainage pipes are **store pickup only** — these are marked on the product page.

## Store pickup
Choose a branch and a 2-hour pickup window at checkout. We will message you when your order is ready. Please bring your order number.

## Returns
Unused items in their original packaging can be returned within 14 days with the tax invoice. Cut-to-length cable, tinted paint and special orders cannot be returned. Refunds go back to the original payment method.`,
  },
  {
    slug: 'warranty',
    title: 'Warranty',
    kind: 'page',
    body: `All products are covered by the manufacturer's warranty in the UAE. Warranty periods are listed on each product page where available.

To make a claim, bring the product and your tax invoice to any branch, or contact us on WhatsApp with your order number and photos of the fault. We handle the claim with the brand on your behalf.`,
  },
  {
    slug: 'faq',
    title: 'Frequently asked questions',
    kind: 'page',
    body: `### Are your prices inclusive of VAT?
Yes. All prices on the website include 5% UAE VAT. Your tax invoice shows the VAT separately.

### Can I get a tax invoice in my company's name?
Yes. Enter your company name and TRN at checkout, or save them in your account.

### Do you offer trade prices?
Contractors and maintenance companies can apply for a trade account. Once approved, you see your trade prices when logged in.

### Can I pay cash on delivery?
Yes, for orders up to AED 2,000. For store pickup you can pay at the counter.

### How do I buy cable by the metre?
Choose "m" as the unit and enter the length you need, or choose "roll" for full 100 m coils at a lower price per metre.`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    kind: 'page',
    body: `We collect the information you give us to process orders and run your account: your name, contact details, delivery addresses and order history. We process it in line with the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021).

We share delivery details with our courier partners and payment details are handled directly by our payment provider — we never see or store your card number.

You can ask us to access, correct or delete your personal data at any time by contacting us.`,
  },
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    kind: 'page',
    body: `By placing an order you agree to these terms. Prices are in UAE Dirhams and include VAT. We confirm availability after you order; if an item is unavailable we will contact you and refund any payment for it.

Product images are for illustration. Colours of tiles and paint may vary slightly between batches — buy enough for your whole project in one order.`,
  },
  {
    slug: 'how-many-tiles-do-i-need',
    title: 'How many tiles do I need?',
    kind: 'blog',
    excerpt: 'Measure the room, add 10% for cuts, and round up to full boxes. Here is the quick way to get it right first time.',
    body: `1. **Measure** the length and width of the floor in metres and multiply them. A 4 m × 3.5 m room is 14 m².
2. **Add wastage**: 10% for straight lay, 15% for diagonal or herringbone. 14 m² + 10% = 15.4 m².
3. **Round up to boxes.** Our 60 × 60 cm porcelain tiles come 4 to a box (1.44 m²), so 15.4 ÷ 1.44 = 10.7 → **11 boxes**.

Buy all your tiles in one order: different production batches can vary slightly in shade. Use the tile calculator on any tile product page to do this for you.`,
  },
  {
    slug: 'choosing-cable-size',
    title: 'Choosing the right cable size for home circuits',
    kind: 'blog',
    excerpt: 'A quick guide to the single-core cable sizes used in UAE homes, and which breaker goes with each.',
    body: `Typical UAE residential wiring in conduit uses single-core PVC copper cable:

| Circuit | Cable | Breaker |
|---|---|---|
| Lighting | 1.5 mm² | 10 A MCB |
| 13 A sockets (radial) | 2.5 mm² | 20 A MCB |
| Water heater | 4 mm² | 20–32 A MCB |
| Cooker / large AC | 6 mm² | 32 A MCB |
| Earth | Green/Yellow, per DEWA/ADDC rules | — |

Always follow your local authority's regulations (DEWA, SEWA, ADDC/AADC or FEWA) and have installations carried out by a licensed electrician. Longer runs may need a bigger cable to limit voltage drop.`,
  },
];
