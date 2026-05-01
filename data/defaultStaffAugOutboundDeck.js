/**
 * Tabalt — Outbound Staff Augmentation sales deck.
 * Conversion-first: pilot, one developer, pay-if-value. Staff augmentation ONLY.
 */

const DEFAULT_STAFF_AUG_OUTBOUND_DECK = [
  {
    id: 1,
    layout: 'cover',
    eyebrow: 'Tabalt • UK × India • Staff augmentation',
    headline: 'Hire Salesforce & Data Talent in 7 Days — Risk-Free',
    subline:
      'Start with 1 developer. 2-week pilot. Pay only if it works.\nUK-led coordination • India bench — mobilise quickly, decide on evidence.',
    visualCue: 'Full-bleed abstract: gradient mesh navy → cyan; Tabalt logo top-left.',
  },
  {
    id: 2,
    layout: 'stack',
    title: 'The problem',
    headline: 'Talent gaps burn time before they burn tickets.',
    bullets: [
      'Urgent gaps — backlog pressure doesn’t wait for headcount drama.',
      'Slow cycles — reqs, approvals, recruiters, no-shows.',
      'Sticky economics — contractor rates creep; offshore reputations scare stakeholders.',
    ],
    foot: '',
    visualCue: 'Three tight bullets — one icon column optional.',
  },
  {
    id: 3,
    layout: 'spotlight',
    title: 'Reframe',
    headline: 'De-risk hiring with proof in two weeks.',
    callout:
      'Start with 1 developer. 2-week pilot. Pay only if it works — see delivery in your rituals before you scale.',
    visualCue: 'Large callout panel; single takeaway.',
  },
  {
    id: 4,
    layout: 'pillars',
    title: 'How we engage',
    headline: 'Start with 1 developer. 2-week pilot. Pay only if it works.',
    pillars: [
      { title: 'One developer', text: 'Scope that fits a sprint — backlog, dashboards, integrations that ship evidence.' },
      { title: 'Two-week pilot', text: 'Time-boxed, outcome-visible; no months of “warming up.”' },
      {
        title: 'Pay only if it works',
        text: 'Commercials aligned so you extend on merit — not sunk-cost pressure.',
      },
    ],
    visualCue: 'Three columns echoing headline; tight subcopy.',
  },
  {
    id: 5,
    layout: 'proof',
    title: 'Trust anchor',
    headline: 'We’ve sustained delivery on demanding programmes.',
    body:
      'We have supported a leading global consulting firm (BCG) by deploying Salesforce, Tableau, and Power BI developers from India.\nEnterprise cadence — clear ownership, artefacts you can inspect, escalation that responds.',
    foot: 'Scope varies by engagement; happy to contextualise analogous delivery on a short call.',
    visualCue: 'Single restrained proof tile; no unauthorised logos.',
  },
  {
    id: 6,
    layout: 'stack',
    title: 'Why teams try Tabalt',
    headline: 'The motion is simple — start small, validate fast.',
    bullets: [
      'Urgent hiring needs — activate capacity while internal processes catch up.',
      'Avoid hiring delays — one embedded resource beats an empty seat.',
      'Test before commitment — pilot window before longer agreements.',
      'Cost efficiency — better economics vs typical UK contractors when offshore execution fits.',
    ],
    foot: '',
    visualCue: 'Four bullets maximum; decisive tone.',
  },
  {
    id: 7,
    layout: 'grid4',
    title: 'Roles',
    headline: 'What we augment — four lanes only.',
    cards: [
      { title: 'Salesforce Developers', text: 'Builds, integrations, backlog execution.' },
      { title: 'Data Engineers', text: 'Pipelines, modelling, dependable datasets.' },
      { title: 'Tableau Developers', text: 'Governed dashboards your leadership trusts.' },
      { title: 'Power BI Developers', text: 'Semantic models, enterprise BI patterns.' },
    ],
    foot: '',
    visualCue: '2×2 card grid.',
  },
  {
    id: 8,
    layout: 'steps3',
    title: 'How it works',
    headline: 'From intro to artefact.',
    steps: [
      {
        n: '1',
        title: 'Align',
        text: '15 minutes: role, rituals, tooling, pilot outcomes — scoped for one developer.',
      },
      { n: '2', title: 'Embed', text: 'Resource joins tickets, demos, stand-ups — you judge output directly.' },
      { n: '3', title: 'Decide', text: 'Scale, swap, or stop — clarity after the pilot, not ambiguity.' },
    ],
    visualCue: 'Horizontal stepper.',
  },
  {
    id: 9,
    layout: 'check',
    title: 'Why Tabalt',
    headline: 'Execution model built for sceptical buyers.',
    reasons: [
      'UK escalation path — you’re not babysitting Slack across timezones alone.',
      'India depth — scale without unicorn-day-rate maths.',
      'Early artefacts — momentum in days, not slideware quarters.',
      'Pilot-native commercials — incentives tied to proving fit.',
    ],
    visualCue: 'Check bullets; distinct from slide 6 triggers.',
  },
  {
    id: 10,
    layout: 'pricingLite',
    title: 'Investment',
    headline: 'Ranges stay light — commercials match the workflow.',
    lines: [
      'Offshore India delivery sits materially below comparable UK contractor day rates for similar roles.',
      'UK-heavy coordination sits between the two — we scope for what procurement needs.',
      'Final pricing shared after understanding requirement — no brochure rate-card theatre.',
    ],
    foot: '',
    visualCue: 'Three lines only; muted rules.',
  },
  {
    id: 11,
    layout: 'cta',
    title: 'Next step',
    headline: 'Lock a pilot thread this week.',
    subline:
      'Limited pilot starts per month so handovers stay crisp. Low risk — one developer first; extend only if the fortnight earns it.',
    bullets: [
      'Reply with scope + “Pilot” — we allocate a mobilisation slot for you.',
      'Email info@tabalt.co.uk • Subject: Pilot • Salesforce / Data / Tableau / Power BI',
      'Prefer a call? Reply with two windows — we’ll confirm within one business day where possible.',
    ],
    foot: '',
    visualCue: 'Strong CTA; navy anchor block on email.',
  },
];

/** Copy snippets for admins — outbound channels (bonus deliverables). */
const STAFF_AUG_OUTBOUND_COLLATERAL = {
  onePagerTitle: 'Tabalt — Salesforce & BI staff aug (UK × India)',
  onePagerBullets: [
    'Start with 1 developer. 2-week pilot. Pay only if it works.',
    'Most clients start with 1 developer and expand after pilot.',
    'Salesforce, Data, Tableau, Power BI — UK coordination + India delivery.',
    'Trust: supported BCG-track delivery (Salesforce, Tableau, Power BI from India).',
    'Next: info@tabalt.co.uk — subject line “Pilot”.',
  ],
  whatsappPitch: [
    'Quick one — Tabalt runs staff aug with a blunt offer:',
    '',
    '*Start with 1 developer • 2-week pilot • Pay only if it works*',
    '(Most folks start at one seat and expand after the pilot proves out.)',
    '',
    'BCG-class track record on Salesforce + Tableau + Power BI from India.',
    'Want the 11-slide link or a 15-min slot?',
  ].join('\n'),
  emailSubject: 'Tabalt · Pilot: 1 dev · 2 weeks · pay if it works (+ deck)',
  emailBody: [
    'Hi [Name],',
    '',
    'We staff Salesforce developers and data / BI builders (Tableau, Power BI) fast — UK client rhythm, India execution.',
    '',
    'The posture is blunt on purpose:',
    '• Start with 1 developer',
    '• 2-week pilot',
    '• Pay only if it works',
    '(Most teams expand after that pilot clears the bar.)',
    '',
    'Trust anchor: we have supported BCG-track delivery deploying Salesforce plus Tableau and Power BI developers from India.',
    '',
    '11-slide outbound deck: [INSERT PUBLIC LINK]',
    'Pricing discussion stays light until we understand your requirement.',
    '',
    'Reply “Pilot” with role + tool stack — or send two windows for a 15‑min call.',
    '',
    '[Your name]',
    'Tabalt',
  ].join('\n'),
};

module.exports = { DEFAULT_STAFF_AUG_OUTBOUND_DECK, STAFF_AUG_OUTBOUND_COLLATERAL };
