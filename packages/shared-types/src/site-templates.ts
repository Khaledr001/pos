/**
 * The starting points a tenant can pick: a shop, a product catalogue with
 * enquiries, a company site and a one-page landing site.
 *
 * Applying one copies it into the tenant's own settings, pages and forms (see
 * SiteAdminService.applyTemplate), so everything here must pass the same
 * validation a tenant's own edits do — a spec in the API checks every template
 * against the real schemas, so a template the API would reject cannot ship.
 */
import { DEFAULT_HOME_SECTIONS, type HomeSection } from "./storefront-appearance.js";
import { CONTACT_FORM_SLUG } from "./storefront-forms.js";
import { DEFAULT_ENQUIRY_FORM_SLUG, type SiteTemplate, type SiteTemplateId } from "./storefront-site.js";

const contactForm: SiteTemplate["forms"][number] = {
  slug: CONTACT_FORM_SLUG,
  name: "Contact us",
  fields: [
    { key: "name", type: "text", label: "Your name", required: true, role: "name" },
    { key: "email", type: "email", label: "Email", required: true, role: "email" },
    { key: "phone", type: "phone", label: "Phone", required: false, role: "phone" },
    { key: "message", type: "textarea", label: "How can we help?", required: true },
  ],
  submitLabel: "Send message",
  successMessage: "Thanks! We'll get back to you shortly.",
  notifyEmails: [],
  acknowledge: true,
  isActive: true,
};

const enquiryForm: SiteTemplate["forms"][number] = {
  ...contactForm,
  slug: DEFAULT_ENQUIRY_FORM_SLUG,
  name: "Product enquiry",
  fields: [
    { key: "name", type: "text", label: "Your name", required: true, role: "name" },
    { key: "phone", type: "phone", label: "Phone / WhatsApp", required: true, role: "phone" },
    { key: "email", type: "email", label: "Email", required: false, role: "email" },
    { key: "quantity", type: "text", label: "Quantity needed", required: false },
    { key: "message", type: "textarea", label: "Anything else we should know?", required: false },
  ],
  submitLabel: "Send enquiry",
  successMessage: "Thanks! We'll contact you about this product shortly.",
};

// ── shared pieces ────────────────────────────────────────────────────────
//
// Copy is deliberately generic: it has to read fine for any business and be
// obviously something to edit. No images are shipped — a tenant uploads their
// own, and a section without one falls back to the shop's colours.

const aboutBody =
  "We started with a simple idea: do the work properly, be honest about what it costs, and look after people long after the job is done.\n\n" +
  "Today our team brings years of hands-on experience, a wide network of trusted suppliers and a habit of answering the phone. " +
  "Tell us what you need and we'll tell you plainly how we can help.";

const faqItems = [
  { q: "How do I get a quote?", a: "Send us a message with a few details about what you need and we'll reply with a clear, itemised quote — usually within one working day." },
  { q: "How quickly can you start?", a: "It depends on the size of the job. After we hear from you we'll confirm a realistic start date before you commit to anything." },
  { q: "Do you work with businesses as well as individuals?", a: "Yes. We work with homeowners, small businesses and larger organisations, and can set up regular or account arrangements." },
  { q: "What if something isn't right?", a: "Tell us straight away. We stand behind our work and will put it right." },
];

const testimonialItems = [
  { quote: "Clear communication from the first call to the final handover. Everything arrived on time and exactly as agreed.", name: "A happy customer", role: "Homeowner" },
  { quote: "They took the time to understand what we needed and never tried to sell us more than we had to buy.", name: "A business client", role: "Operations manager" },
  { quote: "Reliable, tidy and fair on price. We've recommended them to everyone we know.", name: "A repeat customer", role: "Property owner" },
];

const contactPage = (): SiteTemplate["pages"][number] => ({
  slug: "contact",
  title: "Contact us",
  seoDescription: "Get in touch: send us a message, call us or visit.",
  layout: "full",
  sections: [
    { id: "intro", type: "hero", enabled: true, settings: { variant: "minimal", headline: "Contact us", subheadline: "Tell us what you need and we'll get back to you shortly." } },
    { id: "details", type: "contact_info", enabled: true, settings: { title: "Find us", showBranches: true, showHours: true, showSocial: true } },
    { id: "message", type: "form", enabled: true, settings: { title: "Send us a message", subtitle: "We usually reply within one working day.", formSlug: CONTACT_FORM_SLUG, layout: "split" }, style: { background: "surface" } },
    { id: "map", type: "map", enabled: true, settings: { mode: "branches", height: "md" } },
  ],
});

const aboutPage = (extra: HomeSection[] = []): SiteTemplate["pages"][number] => ({
  slug: "about",
  title: "About us",
  seoDescription: "Who we are, what we believe in and how we work.",
  layout: "full",
  sections: [
    { id: "intro", type: "hero", enabled: true, settings: { variant: "minimal", headline: "About us", subheadline: "Who we are and what we stand for." } },
    { id: "story", type: "image_text", enabled: true, settings: { title: "Our story", body: aboutBody, imageSide: "right", bullets: ["Straightforward advice", "Fair, upfront prices", "Support after the sale"] } },
    ...extra,
    { id: "next", type: "cta_banner", enabled: true, settings: { headline: "Let's talk about what you need", text: "A short message is all it takes to get started.", ctaLabel: "Contact us", ctaHref: "/pages/contact", showWhatsapp: true }, style: { background: "accent" } },
  ],
});

const legalFooter = { title: "Company", links: [{ label: "About us", href: "/pages/about" }, { label: "Contact", href: "/pages/contact" }] };

export const SITE_TEMPLATES: Record<SiteTemplateId, SiteTemplate> = {
  shop: {
    id: "shop",
    label: "Online shop",
    blurb: "Sell online: catalogue, cart, checkout, customer accounts.",
    bestFor: "Retailers who want to take orders and payments on the website.",
    mode: "shop",
    themePreset: "workshop",
    layout: { header: "classic", footer: "dark" },
    site: { template: "shop", mode: "shop" },
    navigation: { header: [], footerColumns: [], legal: [], footerNote: "" },
    homeSections: DEFAULT_HOME_SECTIONS,
    pages: [],
    forms: [contactForm],
  },
  catalogue: {
    id: "catalogue",
    label: "Catalogue + enquiry",
    blurb: "Show your products and let customers ask, instead of buying online.",
    bestFor: "Wholesalers, trade suppliers and showrooms that sell by quote or in person.",
    mode: "catalogue",
    themePreset: "ocean",
    layout: { header: "classic", productCard: "bordered", footer: "dark", container: "boxed", stickyHeader: true },
    site: {
      template: "catalogue",
      mode: "catalogue",
      showPrices: true,
      enquiry: { form: true, whatsapp: true, call: false, formSlug: DEFAULT_ENQUIRY_FORM_SLUG },
      features: { search: true, account: false },
      headerCta: { label: "Get a quote", href: "/pages/contact" },
    },
    navigation: {
      header: [
        { label: "About", href: "/pages/about" },
        { label: "Contact", href: "/pages/contact" },
      ],
      footerColumns: [legalFooter],
      legal: [],
      footerNote: "",
    },
    homeSections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        settings: {
          variant: "split",
          headline: "Everything you need, ready when you are",
          subheadline: "Browse our full range, then message us for availability, quantities and the best price for your order.",
          ctaLabel: "Browse the catalogue",
          ctaHref: "/departments",
          secondaryLabel: "Request a quote",
          secondaryHref: "/pages/contact",
        },
      },
      { id: "departments", type: "categories", enabled: true, settings: { title: "Shop by department", limit: 8 } },
      { id: "popular", type: "products", enabled: true, settings: { title: "Popular products", source: "best_sellers", limit: 8 } },
      {
        id: "why",
        type: "features",
        enabled: true,
        settings: {
          title: "Why order from us",
          columns: 4,
          items: [
            { icon: "badge-check", title: "Genuine products", text: "Sourced from authorised suppliers, every time." },
            { icon: "package", title: "Wide range in stock", text: "Most items available to collect or deliver quickly." },
            { icon: "headset", title: "Real advice", text: "Talk to people who know the products." },
            { icon: "thumbs-up", title: "Fair trade prices", text: "Ask for a quote on larger orders." },
          ],
        },
        style: { background: "surface" },
      },
      {
        id: "numbers",
        type: "stats",
        enabled: true,
        settings: {
          items: [
            { value: "10+", label: "Years in business" },
            { value: "1,000s", label: "Products available" },
            { value: "98%", label: "Orders right first time" },
          ],
        },
        style: { background: "dark" },
      },
      { id: "reviews", type: "testimonials", enabled: true, settings: { title: "What customers say", items: testimonialItems }, style: { background: "tint" } },
      {
        id: "help",
        type: "cta_banner",
        enabled: true,
        settings: { headline: "Can't find what you need?", text: "We can source almost anything. Tell us what you're looking for.", ctaLabel: "Contact us", ctaHref: "/pages/contact", showWhatsapp: true },
        style: { background: "accent" },
      },
    ],
    pages: [aboutPage(), contactPage()],
    forms: [enquiryForm, contactForm],
  },
  corporate: {
    id: "corporate",
    label: "Company website",
    blurb: "A professional site: services, projects, team and a contact form.",
    bestFor: "Service businesses, contractors, consultancies and agencies that don't sell products online.",
    mode: "showcase",
    themePreset: "boutique",
    layout: { header: "simple", productCard: "standard", footer: "dark", container: "boxed", stickyHeader: true },
    site: {
      template: "corporate",
      mode: "showcase",
      showPrices: false,
      features: { search: false, account: false },
      headerCta: { label: "Get a quote", href: "/pages/contact" },
    },
    navigation: {
      header: [
        { label: "Home", href: "/" },
        { label: "About", href: "/pages/about" },
        { label: "Services", href: "/pages/services" },
        { label: "Projects", href: "/pages/projects" },
        { label: "Contact", href: "/pages/contact" },
      ],
      footerColumns: [
        legalFooter,
        {
          title: "Explore",
          links: [
            { label: "Our services", href: "/pages/services" },
            { label: "Our projects", href: "/pages/projects" },
          ],
        },
      ],
      legal: [],
      footerNote: "",
    },
    homeSections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        settings: {
          variant: "image",
          headline: "Practical solutions for growing businesses",
          subheadline: "Experienced people, clear pricing and work you can rely on — from the first conversation to the final handover.",
          ctaLabel: "Our services",
          ctaHref: "/pages/services",
          secondaryLabel: "Get in touch",
          secondaryHref: "/pages/contact",
          align: "left",
          height: "lg",
        },
      },
      {
        id: "why",
        type: "features",
        enabled: true,
        settings: {
          title: "Why clients choose us",
          subtitle: "The basics, done properly.",
          columns: 4,
          items: [
            { icon: "award", title: "Experienced team", text: "Years of hands-on work behind every project." },
            { icon: "clock", title: "On time", text: "We agree timelines up front and keep to them." },
            { icon: "shield", title: "Quality guaranteed", text: "We stand behind everything we deliver." },
            { icon: "users", title: "Personal service", text: "One point of contact from start to finish." },
          ],
        },
      },
      {
        id: "about",
        type: "image_text",
        enabled: true,
        settings: {
          title: "A team that treats your business as its own",
          body: "We keep things simple: listen first, give honest advice, then do the work well. Most of our clients come back — or send a friend.",
          bullets: ["Clear, itemised quotes", "Straightforward timelines", "Support after the job is done"],
          ctaLabel: "More about us",
          ctaHref: "/pages/about",
          imageSide: "right",
        },
        style: { background: "surface" },
      },
      {
        id: "services",
        type: "cards",
        enabled: true,
        settings: {
          title: "What we do",
          subtitle: "A few of the ways we can help.",
          variant: "card",
          columns: 3,
          items: [
            { title: "Consulting & planning", text: "We work out what you need and how to get there before any money is spent.", href: "/pages/services", label: "Learn more" },
            { title: "Delivery & installation", text: "Skilled people, the right materials and a tidy finish.", href: "/pages/services", label: "Learn more" },
            { title: "Support & maintenance", text: "Ongoing care so everything keeps working as it should.", href: "/pages/services", label: "Learn more" },
          ],
        },
      },
      {
        id: "numbers",
        type: "stats",
        enabled: true,
        settings: {
          items: [
            { value: "15+", label: "Years of experience" },
            { value: "500+", label: "Projects completed" },
            { value: "100%", label: "Commitment to quality" },
            { value: "24h", label: "Typical reply time" },
          ],
        },
        style: { background: "dark" },
      },
      {
        id: "process",
        type: "steps",
        enabled: true,
        settings: {
          title: "How we work",
          subtitle: "Four simple steps.",
          items: [
            { title: "Tell us what you need", text: "A short call or message is all it takes." },
            { title: "Get a clear quote", text: "Itemised, with timings, before you commit." },
            { title: "We get to work", text: "Regular updates, no surprises." },
            { title: "Handover and support", text: "We check everything with you and stay available." },
          ],
        },
      },
      { id: "work", type: "gallery", enabled: true, settings: { title: "Selected projects", columns: 3, items: [] } },
      { id: "reviews", type: "testimonials", enabled: true, settings: { title: "Kind words", items: testimonialItems }, style: { background: "tint" } },
      { id: "clients", type: "logos", enabled: true, settings: { title: "Trusted by", items: [] } },
      {
        id: "start",
        type: "cta_banner",
        enabled: true,
        settings: { headline: "Ready to start your project?", text: "Tell us a little about it and we'll be in touch.", ctaLabel: "Contact us", ctaHref: "/pages/contact", secondaryLabel: "Our services", secondaryHref: "/pages/services", showWhatsapp: true },
        style: { background: "accent" },
      },
      {
        id: "contact",
        type: "form",
        enabled: true,
        settings: { title: "Get in touch", subtitle: "We usually reply within one working day.", formSlug: CONTACT_FORM_SLUG, layout: "split" },
      },
    ],
    pages: [
      aboutPage([
        {
          id: "numbers",
          type: "stats",
          enabled: true,
          settings: {
            items: [
              { value: "15+", label: "Years of experience" },
              { value: "500+", label: "Projects completed" },
              { value: "100%", label: "Commitment to quality" },
            ],
          },
          style: { background: "dark" },
        },
        {
          id: "team",
          type: "cards",
          enabled: true,
          settings: {
            title: "The team",
            subtitle: "The people you'll work with.",
            variant: "person",
            columns: 3,
            items: [
              { title: "Founder & Director", text: "Leads the business and every major project." },
              { title: "Operations Manager", text: "Keeps schedules, suppliers and people on track." },
              { title: "Customer Care Lead", text: "Your first call for questions and support." },
            ],
          },
        },
      ]),
      {
        slug: "services",
        title: "Services",
        seoDescription: "What we do and how we work.",
        layout: "full",
        sections: [
          { id: "intro", type: "hero", enabled: true, settings: { variant: "minimal", headline: "Our services", subheadline: "Everything you need, from the first idea to ongoing support." } },
          {
            id: "list",
            type: "cards",
            enabled: true,
            settings: {
              title: "What we offer",
              variant: "card",
              columns: 3,
              items: [
                { title: "Consulting & planning", text: "Understand the need, set the scope and agree a plan and budget." },
                { title: "Delivery & installation", text: "Skilled people and quality materials, delivered to the agreed timeline." },
                { title: "Support & maintenance", text: "Regular checks and fast help when something needs attention." },
              ],
            },
          },
          {
            id: "process",
            type: "steps",
            enabled: true,
            settings: {
              title: "Our process",
              items: [
                { title: "Discuss", text: "We listen and ask the right questions." },
                { title: "Quote", text: "A clear, itemised price with timings." },
                { title: "Deliver", text: "We do the work and keep you updated." },
                { title: "Support", text: "We're here after the job is done." },
              ],
            },
            style: { background: "surface" },
          },
          { id: "faq", type: "faq", enabled: true, settings: { title: "Common questions", items: faqItems } },
          { id: "next", type: "cta_banner", enabled: true, settings: { headline: "Have a project in mind?", ctaLabel: "Request a quote", ctaHref: "/pages/contact", showWhatsapp: true }, style: { background: "accent" } },
        ],
      },
      {
        slug: "projects",
        title: "Projects",
        seoDescription: "A look at some of our recent work.",
        layout: "full",
        sections: [
          { id: "intro", type: "hero", enabled: true, settings: { variant: "minimal", headline: "Our projects", subheadline: "A look at some of our recent work." } },
          { id: "gallery", type: "gallery", enabled: true, settings: { title: "Gallery", columns: 3, items: [] } },
          {
            id: "featured",
            type: "cards",
            enabled: true,
            settings: {
              title: "Featured projects",
              variant: "overlay",
              columns: 3,
              items: [
                { title: "Project one", text: "A short description of the brief and the result." },
                { title: "Project two", text: "A short description of the brief and the result." },
                { title: "Project three", text: "A short description of the brief and the result." },
              ],
            },
          },
          { id: "next", type: "cta_banner", enabled: true, settings: { headline: "Want results like these?", ctaLabel: "Get in touch", ctaHref: "/pages/contact" }, style: { background: "accent" } },
        ],
      },
      contactPage(),
    ],
    forms: [contactForm],
  },
  landing: {
    id: "landing",
    label: "One-page landing",
    blurb: "A single scrolling page that explains one offer and collects enquiries.",
    bestFor: "Launching a service, a campaign or a new business with a single clear call to action.",
    mode: "showcase",
    themePreset: "midnight",
    layout: { header: "simple", productCard: "standard", footer: "minimal", container: "boxed", stickyHeader: true },
    site: {
      template: "landing",
      mode: "showcase",
      showPrices: false,
      features: { search: false, account: false },
      headerCta: { label: "Get started", href: "/#contact" },
    },
    navigation: {
      header: [
        { label: "Features", href: "/#features" },
        { label: "How it works", href: "/#how-it-works" },
        { label: "FAQ", href: "/#faq" },
        { label: "Contact", href: "/#contact" },
      ],
      footerColumns: [],
      legal: [],
      footerNote: "",
    },
    homeSections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        settings: {
          variant: "image",
          headline: "One clear promise, delivered well",
          subheadline: "Say what you do, who it's for and why it's better — in a sentence. Then make it easy to get in touch.",
          ctaLabel: "Get started",
          ctaHref: "/#contact",
          secondaryLabel: "How it works",
          secondaryHref: "/#how-it-works",
          align: "center",
          height: "lg",
        },
      },
      {
        id: "features",
        type: "features",
        enabled: true,
        settings: {
          title: "Everything you need",
          subtitle: "The reasons people choose us.",
          columns: 3,
          items: [
            { icon: "zap", title: "Fast to start", text: "Get going in days, not months." },
            { icon: "shield", title: "Reliable", text: "Built to work every time you need it." },
            { icon: "heart", title: "Made for you", text: "Tailored to the way you actually work." },
            { icon: "lock", title: "Safe and private", text: "Your information stays yours." },
            { icon: "headset", title: "Real support", text: "A real person answers when you ask." },
            { icon: "chart", title: "Clear results", text: "See exactly what you're getting." },
          ],
        },
        style: { anchor: "features" },
      },
      {
        id: "story",
        type: "image_text",
        enabled: true,
        settings: {
          title: "Built around what matters to you",
          body: "Describe the problem you solve and what makes your approach different. Keep it short, specific and honest.",
          bullets: ["A benefit that matters", "Another reason to choose you", "Something that builds trust"],
          imageSide: "left",
        },
        style: { background: "surface" },
      },
      {
        id: "steps",
        type: "steps",
        enabled: true,
        settings: {
          title: "How it works",
          subtitle: "Three steps to get started.",
          items: [
            { title: "Get in touch", text: "Send a quick message about what you need." },
            { title: "We plan it together", text: "A short conversation to agree the details." },
            { title: "You're up and running", text: "We deliver and stay on hand to help." },
          ],
        },
        style: { anchor: "how-it-works" },
      },
      { id: "reviews", type: "testimonials", enabled: true, settings: { title: "People like working with us", items: testimonialItems }, style: { background: "tint" } },
      { id: "faq", type: "faq", enabled: true, settings: { title: "Questions, answered", items: faqItems }, style: { anchor: "faq" } },
      {
        id: "contact",
        type: "form",
        enabled: true,
        settings: { title: "Ready when you are", subtitle: "Send us a message and we'll reply shortly.", formSlug: CONTACT_FORM_SLUG, layout: "split" },
        style: { background: "surface", anchor: "contact" },
      },
      {
        id: "close",
        type: "cta_banner",
        enabled: true,
        settings: { headline: "Prefer to chat?", text: "Message us directly and we'll answer as soon as we can.", ctaLabel: "Get started", ctaHref: "/#contact", showWhatsapp: true },
        style: { background: "accent" },
      },
    ],
    pages: [],
    forms: [contactForm],
  },
};

export const SITE_TEMPLATE_ORDER: readonly SiteTemplateId[] = ["shop", "catalogue", "corporate", "landing"];
