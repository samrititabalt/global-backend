/**
 * Default First-Call Deck for Market Research Agencies.
 * Theme: We understand you have partners; we ask for a small opportunity to test us, build trust, and we can come to your office.
 * Big 4–style: clear headers, professional tone, icons per slide.
 */
const DEFAULT_AGENCIES_DECK = [
  {
    id: 1,
    type: 'agenda',
    icon: '📋',
    title: 'Agenda',
    tagline: 'What We’ll Cover Today',
    agendaItems: [
      'Why we’re reaching out to agencies',
      'SamStudios in one minute',
      'How we can support your agency',
      'A small ask: test us as a new supplier',
      'Next step: we come to you',
      'Q&A'
    ],
    image: {
      url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop&q=80',
      alt: 'Partnership discussion',
      caption: 'Building trust, one conversation at a time'
    }
  },
  {
    id: 2,
    type: 'companyProfile',
    icon: '🏢',
    title: 'Who We Are',
    tagline: 'SamStudios — Research & Intelligence Partner',
    aboutTitle: 'About SamStudios',
    aboutDescription: [
      'We are a next-generation research and intelligence company. We combine a real-time platform with expert researchers to deliver fieldwork, insights, and reporting.',
      'We are not here to replace your existing partners. We know you have trusted suppliers. We are simply asking for a small opportunity to prove ourselves alongside them.'
    ],
    servicesTitle: 'What We Can Do for Your Agency',
    services: [
      'Fieldwork and data collection (qual + quant)',
      'Desk research and analyst support',
      'White-label or co-branded deliverables',
      'Capacity during peak or overflow',
      'Pilot projects with clear scope and KPIs'
    ],
    mission: 'To earn a place in your supplier ecosystem through quality and reliability.',
    vision: 'To be the partner you’re glad you gave a chance.'
  },
  {
    id: 3,
    type: 'portfolioGrid',
    icon: '📊',
    title: 'How We Can Support You',
    tagline: 'Flexible Options for Agencies',
    cards: [
      { icon: '🔬', title: 'Fieldwork', description: 'Surveys, panels, interviews — we run it; you own the client relationship.' },
      { icon: '📑', title: 'Desk Research', description: 'Quick turn desk research and analyst support when you’re stretched.' },
      { icon: '📦', title: 'White-Label', description: 'Deliverables that carry your branding; we stay in the background.' },
      { icon: '⚡', title: 'Overflow & Peak', description: 'Extra capacity when deadlines stack up or teams are at capacity.' },
      { icon: '🧪', title: 'Pilot Projects', description: 'Small, scoped tests so you can evaluate us with minimal risk.' },
      { icon: '🤝', title: 'Trust Building', description: 'We start small, deliver well, and grow the relationship at your pace.' }
    ]
  },
  {
    id: 4,
    type: 'askSamOverview',
    icon: '💡',
    title: 'Our Approach',
    tagline: 'Platform + People, Built for Speed and Quality',
    headline: 'How We Work',
    intro: 'We combine an intelligence platform with experienced researchers. That means we can take on well-scoped projects, deliver on time, and keep quality high — so you look good in front of your clients.',
    differentiators: [
      { title: 'Clear Scope', text: 'We agree deliverables and timelines upfront so there are no surprises.' },
      { title: 'Your Brand, Your Client', text: 'We support you; we don’t compete for your client relationship.' },
      { title: 'Pilot-First', text: 'Start with one small project. If it works, we scale; if not, no obligation.' },
      { title: 'We Come to You', text: 'Happy to meet at your office for a proper discussion at your convenience.' }
    ]
  },
  {
    id: 5,
    type: 'howWorks',
    icon: '🔄',
    title: 'How a First Project Could Look',
    tagline: 'Simple, Low-Risk Path to Testing Us',
    steps: [
      { number: '1', title: 'Conversation', text: 'We meet (we can come to your office) and align on one small pilot.' },
      { number: '2', title: 'Scope', text: 'Clear brief, deliverables, timeline, and success criteria.' },
      { number: '3', title: 'Delivery', text: 'We execute; you review and use what works for your client.' },
      { number: '4', title: 'Review', text: 'We get your feedback. If it’s a fit, we discuss next steps; if not, no hard feelings.' }
    ],
    workflow: ['Meet', 'Scope', 'Deliver', 'Review', 'Decide']
  },
  {
    id: 6,
    type: 'caseStudies',
    icon: '📁',
    title: 'Where We’ve Delivered',
    tagline: 'Examples of Partner and Client Work',
    cases: [
      {
        title: 'Agency overflow: multi-market survey',
        challenge: 'An agency needed extra fieldwork capacity for a multi-country study without adding fixed cost.',
        solution: 'We ran the fieldwork and delivered cleaned data and topline summary; the agency owned client communication.',
        outcome: 'On-time delivery; agency retained full client control and repeated for another wave.'
      },
      {
        title: 'White-label desk research',
        challenge: 'A consultancy needed fast desk research under their own branding.',
        solution: 'We produced the research pack; they branded and delivered to the end client.',
        outcome: 'Turnaround in days; client satisfaction led to a follow-on project.'
      },
      {
        title: 'Pilot then scale',
        challenge: 'A research buyer wanted to test a new supplier with minimal risk.',
        solution: 'We ran one small project with clear KPIs; they evaluated and then expanded scope.',
        outcome: 'Trust built through one pilot; we are now on their preferred supplier list.'
      }
    ]
  },
  {
    id: 7,
    type: 'serviceOptions',
    icon: '🛠',
    title: 'Service Options for Agencies',
    tagline: 'What We Can Offer as a Sub-Supplier',
    categories: [
      {
        title: 'Data & Fieldwork',
        items: ['Online surveys', 'Panel recruitment', 'IDIs and focus groups', 'Mystery shopping', 'Custom sampling']
      },
      {
        title: 'Analysis & Reporting',
        items: ['Toplines and crosstabs', 'Theme analysis (qual)', 'Desk research packs', 'Competitor snapshots', 'Executive summaries']
      },
      {
        title: 'Flexibility',
        items: ['White-label deliverables', 'Your templates and branding', 'Pilot or one-off projects', 'Ongoing capacity agreements']
      },
      {
        title: 'Engagement',
        items: ['Kick-off and status calls', 'Dedicated project contact', 'We come to your office', 'No pushy sales — you set the pace']
      }
    ]
  },
  {
    id: 8,
    type: 'whyChoose',
    icon: '✅',
    title: 'Why Give Us a Chance',
    tagline: 'We Know You Have Other Partners — We’re Asking for a Small Opportunity',
    headline: 'Our Ask',
    reasons: [
      { title: 'We’re not replacing anyone', text: 'We know you have trusted partners. We’re asking for a small test, not your whole roster.' },
      { title: 'Start small, build trust', text: 'One pilot project. Clear scope. If we deliver, we grow; if not, no obligation.' },
      { title: 'We come to you', text: 'We’re happy to meet at your office for a proper conversation at a time that suits you.' },
      { title: 'No pressure', text: 'No long contracts or minimums. We want to earn your trust through delivery.' },
      { title: 'Transparent and reliable', text: 'Clear communication, agreed timelines, and deliverables you can rely on.' }
    ]
  }
];

module.exports = { DEFAULT_AGENCIES_DECK };
