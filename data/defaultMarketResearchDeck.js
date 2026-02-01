const DEFAULT_MARKET_RESEARCH_DECK = [
  {
    id: 1,
    type: 'agenda',
    title: 'Agenda',
    tagline: "What We'll Cover Today",
    agendaItems: [
      'SamStudios Market Research Profile',
      'Platform + Human Researchers',
      'Ask Sam MR Overview',
      'How MR Delivery Works',
      'Market Research Case Studies',
      'MR Service Options',
      'Why Choose SamStudios'
    ],
    image: {
      url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop&q=80',
      alt: 'Market research planning',
      caption: 'Decision-ready research with speed and clarity'
    }
  },
  {
    id: 2,
    type: 'companyProfile',
    title: 'Company Profile',
    tagline: 'SamStudios — Next-Generation Market Research',
    aboutTitle: 'About SamStudios',
    aboutDescription: [
      'SamStudios is a next-generation market research company built on reinforcement learning.',
      'We combine a real-time intelligence platform with expert researchers to deliver faster, smarter insight cycles.'
    ],
    servicesTitle: 'What We Deliver',
    services: [
      'End-to-end data collection (qual + quant)',
      'Category intelligence and competitor tracking',
      'Quarterly trend reporting',
      'Ad-hoc research and rapid insight briefs',
      'Consumer and shopper insights'
    ],
    mission: 'To take market research off your plate without forcing you to build an MR team.',
    vision: 'To be the most trusted research partner for modern startups and scaling teams.'
  },
  {
    id: 3,
    type: 'portfolioGrid',
    title: 'Portfolio of Services',
    tagline: 'End-to-End Market Research Coverage',
    cards: [
      { icon: '📊', title: 'Data Collection', description: 'Qualitative + quantitative surveys, panels, and interviews' },
      { icon: '🧠', title: 'Category Insights', description: 'Market structure, share shifts, and pricing dynamics' },
      { icon: '🧭', title: 'Competitor Intelligence', description: 'Tracking launches, messaging, and positioning' },
      { icon: '🛒', title: 'Shopper Insights', description: 'Path-to-purchase behavior and retail signals' },
      { icon: '📈', title: 'Trend Tracking', description: 'Quarterly trend reports and emerging signals' },
      { icon: '⚡', title: 'Ad-Hoc Research', description: 'Rapid insight briefs on demand' }
    ]
  },
  {
    id: 4,
    type: 'askSamOverview',
    title: 'Ask Sam Overview',
    tagline: 'Platform + Human Researchers, Always On',
    headline: 'What is Ask Sam for Market Research?',
    intro: 'Ask Sam is your real-time market research assistant — combining platform intelligence with expert analysts and fieldwork specialists.',
    differentiators: [
      { title: 'Reinforcement Learning Core', text: 'Continuous learning loops improve insight quality over time.' },
      { title: 'Human + Platform', text: 'Analysts validate, interpret, and deliver decision-ready findings.' },
      { title: 'Always-On Intelligence', text: 'Quarterly trends, competitor moves, and category shifts in one feed.' },
      { title: 'Speed without Sacrifice', text: 'Rapid fieldwork and reporting without losing rigor.' }
    ]
  },
  {
    id: 5,
    type: 'howWorks',
    title: 'How MR Delivery Works',
    tagline: 'Simple, Streamlined, Effective',
    steps: [
      { number: '1', title: 'Brief', text: 'Share your category, market, and decision goals.' },
      { number: '2', title: 'Design', text: 'We scope fieldwork, sample, and methodology.' },
      { number: '3', title: 'Collect', text: 'Researchers run qual + quant fieldwork.' },
      { number: '4', title: 'Deliver', text: 'Receive insight packs, dashboards, and recommendations.' }
    ],
    workflow: ['Request', 'Design', 'Fieldwork', 'Analyze', 'Report', 'Iterate']
  },
  {
    id: 6,
    type: 'caseStudies',
    title: 'Case Studies',
    tagline: 'Real Results from Real Clients',
    cases: [
      {
        title: 'Case Study 1: Multi-Country Consumer Study',
        challenge: 'A DTC brand needed rapid consumer insights across three regions.',
        solution: 'Ask Sam delivered qual + quant fieldwork with local researchers.',
        outcome: 'Reduced time-to-insight by 40% and refined product positioning.'
      },
      {
        title: 'Case Study 2: Competitor Intelligence',
        challenge: 'A fintech team needed monthly competitor tracking.',
        solution: 'MR 360 monitored messaging, pricing, and launch signals.',
        outcome: 'Enabled quarterly strategy updates backed by evidence.'
      },
      {
        title: 'Case Study 3: Category Trends',
        challenge: 'A retail brand needed quarterly category insights.',
        solution: 'SamStudios delivered trend decks and shopper insights.',
        outcome: 'Improved forecast accuracy by 18%.'
      }
    ]
  },
  {
    id: 7,
    type: 'serviceOptions',
    title: 'Service Options',
    tagline: 'Flexible MR Support, Any Scale',
    categories: [
      {
        title: 'Data Collection',
        items: ['Qualitative interviews', 'Quantitative surveys', 'Online panels', 'Phone interviews', 'Mystery shopping']
      },
      {
        title: 'Reporting & Insights',
        items: ['Category reports', 'Market sizing', 'Quarterly trend decks', 'SWOT analysis', 'Executive summaries']
      },
      {
        title: 'Ad-Hoc Research',
        items: ['Rapid briefs', 'Desk research', 'Analyst support', 'One-off deep dives']
      },
      {
        title: 'Competitive Intelligence',
        items: ['Competitor tracking', 'Pricing audits', 'Positioning analysis', 'Launch monitoring']
      }
    ]
  },
  {
    id: 8,
    type: 'whyChoose',
    title: 'Why Choose SamStudios',
    tagline: 'The Market Research Advantage',
    headline: 'Why Market Research Teams Choose Us',
    reasons: [
      { title: 'Reinforcement Learning Engine', text: 'Improves insight quality with every project.' },
      { title: 'Real-Time Intelligence', text: 'Quarterly trends and competitor tracking always on.' },
      { title: 'Human-Led Insights', text: 'Researchers validate and interpret results.' },
      { title: 'Speed + Rigor', text: 'Fast turnaround without sacrificing research quality.' },
      { title: 'Scalable Coverage', text: 'From ad-hoc briefs to end-to-end programs.' }
    ]
  }
];

module.exports = { DEFAULT_MARKET_RESEARCH_DECK };
const DEFAULT_MARKET_RESEARCH_DECK = [
  {
    id: 1,
    type: 'agenda',
    title: 'Agenda',
    tagline: "What We'll Cover Today",
    agendaItems: [
      'SamStudios Market Research Profile',
      'Platform + Human Researchers',
      'Ask Sam MR Overview',
      'How MR Delivery Works',
      'Market Research Case Studies',
      'MR Service Options',
      'Why Choose SamStudios'
    ],
    image: {
      url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop&q=80',
      alt: 'Market research planning',
      caption: 'Decision-ready research with speed and clarity'
    }
  },
  {
    id: 2,
    type: 'companyProfile',
    title: 'Company Profile',
    tagline: 'SamStudios — Next-Generation Market Research',
    aboutTitle: 'About SamStudios',
    aboutDescription: [
      'SamStudios is a next-generation market research company built on reinforcement learning.',
      'We combine a real-time intelligence platform with expert researchers to deliver faster, smarter insight cycles.'
    ],
    servicesTitle: 'What We Deliver',
    services: [
      'End-to-end data collection (qual + quant)',
      'Category intelligence and competitor tracking',
      'Quarterly trend reporting',
      'Ad-hoc research and rapid insight briefs',
      'Consumer and shopper insights'
    ],
    mission: 'To take market research off your plate without forcing you to build an MR team.',
    vision: 'To be the most trusted research partner for modern startups and scaling teams.'
  },
  {
    id: 3,
    type: 'portfolioGrid',
    title: 'Portfolio of Services',
    tagline: 'End-to-End Market Research Coverage',
    cards: [
      { icon: '📊', title: 'Data Collection', description: 'Qualitative + quantitative surveys, panels, and interviews' },
      { icon: '🧠', title: 'Category Insights', description: 'Market structure, share shifts, and pricing dynamics' },
      { icon: '🧭', title: 'Competitor Intelligence', description: 'Tracking launches, messaging, and positioning' },
      { icon: '🛒', title: 'Shopper Insights', description: 'Path-to-purchase behavior and retail signals' },
      { icon: '📈', title: 'Trend Tracking', description: 'Quarterly trend reports and emerging signals' },
      { icon: '⚡', title: 'Ad-Hoc Research', description: 'Rapid insight briefs on demand' }
    ]
  },
  {
    id: 4,
    type: 'askSamOverview',
    title: 'Ask Sam Overview',
    tagline: 'Platform + Human Researchers, Always On',
    headline: 'What is Ask Sam for Market Research?',
    intro: 'Ask Sam is your real-time market research assistant — combining platform intelligence with expert analysts and fieldwork specialists.',
    differentiators: [
      { title: 'Reinforcement Learning Core', text: 'Continuous learning loops improve insight quality over time.' },
      { title: 'Human + Platform', text: 'Analysts validate, interpret, and deliver decision-ready findings.' },
      { title: 'Always-On Intelligence', text: 'Quarterly trends, competitor moves, and category shifts in one feed.' },
      { title: 'Speed without Sacrifice', text: 'Rapid fieldwork and reporting without losing rigor.' }
    ]
  },
  {
    id: 5,
    type: 'howWorks',
    title: 'How MR Delivery Works',
    tagline: 'Simple, Streamlined, Effective',
    steps: [
      { number: '1', title: 'Brief', text: 'Share your category, market, and decision goals.' },
      { number: '2', title: 'Design', text: 'We scope fieldwork, sample, and methodology.' },
      { number: '3', title: 'Collect', text: 'Researchers run qual + quant fieldwork.' },
      { number: '4', title: 'Deliver', text: 'Receive insight packs, dashboards, and recommendations.' }
    ],
    workflow: ['Request', 'Design', 'Fieldwork', 'Analyze', 'Report', 'Iterate']
  },
  {
    id: 6,
    type: 'caseStudies',
    title: 'Case Studies',
    tagline: 'Real Results from Real Clients',
    cases: [
      {
        title: 'Case Study 1: Multi-Country Consumer Study',
        challenge: 'A DTC brand needed rapid consumer insights across three regions.',
        solution: 'Ask Sam delivered qual + quant fieldwork with local researchers.',
        outcome: 'Reduced time-to-insight by 40% and refined product positioning.'
      },
      {
        title: 'Case Study 2: Competitor Intelligence',
        challenge: 'A fintech team needed monthly competitor tracking.',
        solution: 'MR 360 monitored messaging, pricing, and launch signals.',
        outcome: 'Enabled quarterly strategy updates backed by evidence.'
      },
      {
        title: 'Case Study 3: Category Trends',
        challenge: 'A retail brand needed quarterly category insights.',
        solution: 'SamStudios delivered trend decks and shopper insights.',
        outcome: 'Improved forecast accuracy by 18%.'
      }
    ]
  },
  {
    id: 7,
    type: 'serviceOptions',
    title: 'Service Options',
    tagline: 'Flexible MR Support, Any Scale',
    categories: [
      {
        title: 'Data Collection',
        items: ['Qualitative interviews', 'Quantitative surveys', 'Online panels', 'Phone interviews', 'Mystery shopping']
      },
      {
        title: 'Reporting & Insights',
        items: ['Category reports', 'Market sizing', 'Quarterly trend decks', 'SWOT analysis', 'Executive summaries']
      },
      {
        title: 'Ad-Hoc Research',
        items: ['Rapid briefs', 'Desk research', 'Analyst support', 'One-off deep dives']
      },
      {
        title: 'Competitive Intelligence',
        items: ['Competitor tracking', 'Pricing audits', 'Positioning analysis', 'Launch monitoring']
      }
    ]
  },
  {
    id: 8,
    type: 'whyChoose',
    title: 'Why Choose SamStudios',
    tagline: 'The Market Research Advantage',
    headline: 'Why Market Research Teams Choose Us',
    reasons: [
      { title: 'Reinforcement Learning Engine', text: 'Improves insight quality with every project.' },
      { title: 'Real-Time Intelligence', text: 'Quarterly trends and competitor tracking always on.' },
      { title: 'Human-Led Insights', text: 'Researchers validate and interpret results.' },
      { title: 'Speed + Rigor', text: 'Fast turnaround without sacrificing research quality.' },
      { title: 'Scalable Coverage', text: 'From ad-hoc briefs to end-to-end programs.' }
    ]
  }
];

module.exports = { DEFAULT_MARKET_RESEARCH_DECK };
