/**
 * Tabalt — Outbound Staff Augmentation sales deck (8–10 slides).
 * Modern SaaS / McKinsey-style brevity. Staff augmentation ONLY.
 */

const DEFAULT_STAFF_AUG_OUTBOUND_DECK = [
  {
    id: 1,
    layout: 'cover',
    eyebrow: 'Tabalt • UK × India • Staff augmentation',
    headline: 'Hire Salesforce & Data Talent in 7 Days — Risk-Free',
    subline: 'Start fast. Pilot first. Continue only when the work proves itself.',
    visualCue: 'Full-bleed abstract: gradient mesh navy → cyan; optional hero image anchor right.',
  },
  {
    id: 2,
    layout: 'stack',
    title: 'The problem',
    headline: 'Hiring specialised talent hurts before it helps.',
    bullets: ['Slow cycles — reqs, panels, approvals.', 'Expensive contractors — budgets stretch fast.', 'Offshore stigma — coordination and quality worries.'],
    foot: '',
    visualCue: 'Minimal: three monochrome icons aligned to bullets.',
  },
  {
    id: 3,
    layout: 'spotlight',
    title: 'Reframe',
    headline: 'What if you could try before committing?',
    callout: 'A short pilot. A visible output. Exit without drama if standards aren’t met.',
    visualCue: 'Single centred question → light blue spotlight panel beneath.',
  },
  {
    id: 4,
    layout: 'pillars',
    title: 'The model',
    headline: '2-week pilot. Pay only if satisfied. Start inside ~7 days.',
    pillars: [
      { title: 'Pilot first', text: 'Two weeks scoped like a sprint — tangible delivery, clear bar.' },
      { title: 'Pay for value', text: 'Commercials aligned so you commit only when outcomes land.' },
      { title: 'Speed', text: 'Resourcing that matches hiring urgency — not procurement theatre.' },
    ],
    visualCue: 'Three equal columns; icons optional (shield, handshake, zap).',
  },
  {
    id: 5,
    layout: 'proof',
    title: 'Signal',
    headline: 'We’ve backed serious delivery teams.',
    body:
      'We have supported a leading global consulting firm (BCG) by deploying Salesforce, Tableau, and Power BI developers from India.\nExact scope differs by wave — happy to contextualise live.',
    foot: 'Messaging uses “supported / deployed” deliberately — factual, not embellished.',
    visualCue: 'Single proof card; optional subtle crest-style placeholder (no logo reproduction without approval).',
  },
  {
    id: 6,
    layout: 'grid4',
    title: 'Roles',
    headline: 'What we augment — four lanes only.',
    cards: [
      { title: 'Salesforce Developers', text: 'Builds, integrations, backlog execution.' },
      { title: 'Data Engineers', text: 'Pipelines, models, dependable datasets.' },
      { title: 'Tableau Developers', text: 'Governed dashboards your leadership trusts.' },
      { title: 'Power BI Developers', text: 'Semantic models, enterprise BI patterns.' },
    ],
    foot: '',
    visualCue: '2×2 card grid — white tiles, faint border, SaaS whitespace.',
  },
  {
    id: 7,
    layout: 'steps3',
    title: 'How it works',
    headline: 'Three moves. No theatre.',
    steps: [
      { n: '1', title: 'Align', text: '15 minutes on role, cadence, tools, and pilot scope.' },
      { n: '2', title: 'Embed', text: 'Resource joins your rituals — stand-ups, tickets, demos.' },
      { n: '3', title: 'Decide', text: 'Review output; scale, adjust, or stop with clarity.' },
    ],
    visualCue: 'Horizontal stepper desktop; stacked mobile.',
  },
  {
    id: 8,
    layout: 'check',
    title: 'Why Tabalt',
    headline: 'Built for delivery leaders who need throughput — not slideware.',
    reasons: ['UK-led client rhythm — escalation path you can ping.', 'India depth — sensible economics without opacity.', 'Short feedback loops — week-one artefacts, not month-one promises.', 'Pilot-native — engagements start with proof, not lock-in theatre.'],
    visualCue: 'Check marks or teal dots beside each line.',
  },
  {
    id: 9,
    layout: 'pricingLite',
    title: 'Investment',
    headline: 'Pricing is a conversation — not a wall of PDF tables.',
    lines: ['Indicative bands: materially below typical UK contractor day rates when offshore execution fits.', 'Onshore coordination available where procurement requires it.', 'Final numbers after role level, tenure, and pilot scope — Rate Card anchors the discussion.'],
    foot: '',
    visualCue: 'Thin horizontal rules between lines; monochrome.',
  },
  {
    id: 10,
    layout: 'cta',
    title: 'Next step',
    headline: 'Book 15 minutes or start a pilot thread.',
    subline: 'We’ll reply same day where possible.',
    bullets: ['Email: info@tabalt.co.uk • Subject: Pilot / Salesforce / Data / BI', 'Prefer voice? Say “call” in the subject — we’ll send slots.'],
    foot: '',
    visualCue: 'Bold CTA block; navy button colour #003366; secondary outline.',
  },
];

/** Copy snippets for admins — outbound channels (bonus deliverables). */
const STAFF_AUG_OUTBOUND_COLLATERAL = {
  onePagerTitle: 'Tabalt — Salesforce & BI staff aug (UK × India)',
  onePagerBullets: [
    'Pilot-first staff aug: Salesforce, Data, Tableau, Power BI.',
    '~7-day start posture; UK coordination + India execution.',
    'Backed BCG-class delivery tracks (Salesforce + Tableau + Power BI from India).',
    'Ask: 15-min intro or pilot scope thread — info@tabalt.co.uk.',
  ],
  whatsappPitch: [
    'Quick heads-up — Tabalt staffs Salesforce + data/BI (Tableau/Power BI) with UK oversight & India pods.',
    '2-week pilot, pay-if-value framing, aiming for ~7 days to start.',
    'Happy to send a short deck / jump on a 15-min call — want me to share the link?',
  ].join('\n'),
  emailSubject: 'Tabalt · Salesforce / Data / BI staff aug · pilot-first (deck inside)',
  emailBody: [
    'Hi [Name],',
    '',
    'We help teams staff Salesforce developers and data/BI builders (Tableau, Power BI) fast — UK client rhythm, India delivery bench.',
    'Start posture is simple: ~7 days to mobilise where possible; 2‑week pilot; continue only when the work earns it.',
    "We've supported a leading global consulting firm (BCG) with Salesforce plus Tableau and Power BI developers from India.",
    '',
    'Deck (10 slides): [INSERT PUBLIC LINK]',
    'If helpful, grab 15 minutes here: reply with times that work.',
    '',
    'Best,',
    '[Your name]',
    'Tabalt',
  ].join('\n'),
};

module.exports = { DEFAULT_STAFF_AUG_OUTBOUND_DECK, STAFF_AUG_OUTBOUND_COLLATERAL };
