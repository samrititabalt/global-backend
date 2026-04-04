const { DEFAULT_AGENCIES_DECK } = require('../data/defaultAgenciesDeck');

const DEFAULT_EXEC_1 = {
  type: 'executivePage1',
  icon: '📌',
  title: 'Tabalt Ltd — Who We Are',
  tagline: 'Adaptive talent for cloud, data, engineering & AI',
  whoWeAre:
    'Tabalt Ltd provides adaptive talent solutions for cloud, data, engineering, and AI — combining UK onshore and India offshore delivery.',
  credibilityBlock:
    'Trusted by firms operating at the same quality bar as BCG, Bain & Company, and McKinsey & Company.',
  consultingFirms: ['BCG', 'Bain & Company', 'McKinsey & Company'],
  differentiators: [
    { title: 'Adaptive talent', text: 'Human expertise that evolves as technology changes.' },
    { title: 'Value-based pricing', text: 'Align fees to outcomes where agreed.' }
  ],
  extraDifferentiators: [{ title: 'Coordinator included', text: 'Dedicated project coordination at no extra cost.' }],
  servicesColumn1Title: 'Staff augmentation (Tabalt payroll)',
  servicesColumn1Bullets: ['UK + India delivery', 'Pre-trained talent', 'Fast replacement'],
  servicesColumn2Title: 'Recruitment (direct hire)',
  servicesColumn2Bullets: ['One-time fee options', 'Flexible commercial terms']
};

const DEFAULT_EXEC_2 = {
  type: 'executivePage2',
  icon: '🎯',
  title: 'Engagement overview',
  tagline: 'Tailored to your context',
  clientName: 'Client',
  clientUrl: 'https://',
  rolesNarrative: 'We align talent to your roles and delivery model.',
  jdHighlights: [],
  talentMapping: 'Mapping seniority, skills, and location to your needs.',
  skillsAlignment: 'Skills matched to your stack and ways of working.',
  engagementModel: 'Clear commercials, milestones, and governance.',
  nextSteps: ['Confirm scope', 'Align on start date', 'Kick off with coordinator']
};

const TYPE_ALIASES = {
  companyprofile: 'companyProfile',
  portfoliogrid: 'portfolioGrid',
  asksamoverview: 'askSamOverview',
  howworks: 'howWorks',
  casestudies: 'caseStudies',
  serviceoptions: 'serviceOptions',
  whychoose: 'whyChoose',
  executivepage1: 'executivePage1',
  executivepage2: 'executivePage2',
  agenda: 'agenda'
};

function normalizeSlideType(type) {
  if (!type || typeof type !== 'string') return 'agenda';
  const k = type.replace(/\s+/g, '').toLowerCase();
  return TYPE_ALIASES[k] || type;
}

function templateForType(normalizedType) {
  return DEFAULT_AGENCIES_DECK.find((s) => s.type === normalizedType) || null;
}

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && !v.trim()) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function ensureStringArray(v, fallback) {
  if (Array.isArray(v) && v.length) {
    return v.map((x) => (typeof x === 'string' ? x : String(x || ''))).filter(Boolean);
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

function mergeCards(aiCards, templateCards) {
  const t = templateCards || [];
  if (!Array.isArray(aiCards) || !aiCards.length) return t;
  return aiCards.map((c, i) => ({
    icon: c?.icon ?? t[i]?.icon ?? '📌',
    title: !isEmpty(c?.title) ? c.title : t[i]?.title || `Item ${i + 1}`,
    description: !isEmpty(c?.description) ? c.description : t[i]?.description || ''
  }));
}

function mergeDifferentiators(ai, template) {
  const t = template || [];
  if (!Array.isArray(ai) || !ai.length) return t;
  return ai.map((d, i) => ({
    title: !isEmpty(d?.title) ? d.title : t[i]?.title || 'Point',
    text: !isEmpty(d?.text) ? d.text : t[i]?.text || ''
  }));
}

/**
 * Ensures every slide has the shape the React renderer expects (fixes blank AI output).
 */
function normalizeAgenciesSlides(slides) {
  if (!Array.isArray(slides) || !slides.length) return slides;

  return slides.map((slide, index) => {
    if (!slide || typeof slide !== 'object') {
      return DEFAULT_AGENCIES_DECK[index] || DEFAULT_AGENCIES_DECK[0];
    }

    const type = normalizeSlideType(slide.type);
    const base = { ...slide, type };

    if (type === 'executivePage1') {
      const t = { ...DEFAULT_EXEC_1, ...base, type: 'executivePage1', id: slide.id ?? 1 };
      t.whoWeAre = !isEmpty(base.whoWeAre) ? base.whoWeAre : DEFAULT_EXEC_1.whoWeAre;
      t.credibilityBlock = !isEmpty(base.credibilityBlock) ? base.credibilityBlock : DEFAULT_EXEC_1.credibilityBlock;
      t.consultingFirms = ensureStringArray(base.consultingFirms, DEFAULT_EXEC_1.consultingFirms);
      t.differentiators = mergeDifferentiators(base.differentiators, DEFAULT_EXEC_1.differentiators);
      t.extraDifferentiators = mergeDifferentiators(base.extraDifferentiators, DEFAULT_EXEC_1.extraDifferentiators);
      t.servicesColumn1Bullets = ensureStringArray(base.servicesColumn1Bullets, DEFAULT_EXEC_1.servicesColumn1Bullets);
      t.servicesColumn2Bullets = ensureStringArray(base.servicesColumn2Bullets, DEFAULT_EXEC_1.servicesColumn2Bullets);
      t.servicesColumn1Title = !isEmpty(base.servicesColumn1Title) ? base.servicesColumn1Title : DEFAULT_EXEC_1.servicesColumn1Title;
      t.servicesColumn2Title = !isEmpty(base.servicesColumn2Title) ? base.servicesColumn2Title : DEFAULT_EXEC_1.servicesColumn2Title;
      return t;
    }

    if (type === 'executivePage2') {
      const t = { ...DEFAULT_EXEC_2, ...base, type: 'executivePage2', id: slide.id ?? 2 };
      t.rolesNarrative = !isEmpty(base.rolesNarrative) ? base.rolesNarrative : DEFAULT_EXEC_2.rolesNarrative;
      t.talentMapping = !isEmpty(base.talentMapping) ? base.talentMapping : DEFAULT_EXEC_2.talentMapping;
      t.skillsAlignment = !isEmpty(base.skillsAlignment) ? base.skillsAlignment : DEFAULT_EXEC_2.skillsAlignment;
      t.engagementModel = !isEmpty(base.engagementModel) ? base.engagementModel : DEFAULT_EXEC_2.engagementModel;
      t.nextSteps = ensureStringArray(base.nextSteps, DEFAULT_EXEC_2.nextSteps);
      t.jdHighlights = Array.isArray(base.jdHighlights) ? base.jdHighlights.filter(Boolean) : [];
      return t;
    }

    const tmpl = templateForType(type);
    if (!tmpl) {
      return { ...base, type: type || 'agenda' };
    }

    const out = { ...tmpl, ...base, id: slide.id ?? tmpl.id, type: tmpl.type };

    switch (type) {
      case 'agenda':
        out.agendaItems = ensureStringArray(base.agendaItems, tmpl.agendaItems);
        out.image = {
          url: base.image?.url || tmpl.image?.url,
          alt: base.image?.alt || tmpl.image?.alt,
          caption: base.image?.caption || tmpl.image?.caption
        };
        break;
      case 'companyProfile':
        out.aboutTitle = !isEmpty(base.aboutTitle) ? base.aboutTitle : tmpl.aboutTitle;
        out.aboutDescription = ensureStringArray(base.aboutDescription, tmpl.aboutDescription);
        out.servicesTitle = !isEmpty(base.servicesTitle) ? base.servicesTitle : tmpl.servicesTitle;
        out.services = ensureStringArray(base.services, tmpl.services);
        out.mission = !isEmpty(base.mission) ? base.mission : tmpl.mission;
        out.vision = !isEmpty(base.vision) ? base.vision : tmpl.vision;
        break;
      case 'portfolioGrid':
        out.cards = mergeCards(base.cards, tmpl.cards);
        break;
      case 'askSamOverview':
        out.headline = !isEmpty(base.headline) ? base.headline : tmpl.headline;
        out.intro = !isEmpty(base.intro) ? base.intro : tmpl.intro;
        out.differentiators = mergeDifferentiators(base.differentiators, tmpl.differentiators);
        break;
      case 'howWorks':
        out.steps =
          Array.isArray(base.steps) && base.steps.length
            ? base.steps.map((s, i) => ({
                number: s?.number ?? tmpl.steps[i]?.number ?? String(i + 1),
                title: !isEmpty(s?.title) ? s.title : tmpl.steps[i]?.title,
                text: !isEmpty(s?.text) ? s.text : tmpl.steps[i]?.text
              }))
            : tmpl.steps;
        out.workflow = ensureStringArray(base.workflow, tmpl.workflow);
        break;
      case 'caseStudies':
        out.cases =
          Array.isArray(base.cases) && base.cases.length
            ? base.cases.map((c, i) => ({
                title: !isEmpty(c?.title) ? c.title : tmpl.cases[i]?.title,
                challenge: !isEmpty(c?.challenge) ? c.challenge : tmpl.cases[i]?.challenge,
                solution: !isEmpty(c?.solution) ? c.solution : tmpl.cases[i]?.solution,
                outcome: !isEmpty(c?.outcome) ? c.outcome : tmpl.cases[i]?.outcome
              }))
            : tmpl.cases;
        break;
      case 'serviceOptions':
        out.categories =
          Array.isArray(base.categories) && base.categories.length
            ? base.categories.map((cat, i) => ({
                title: !isEmpty(cat?.title) ? cat.title : tmpl.categories[i]?.title,
                items: ensureStringArray(cat?.items, tmpl.categories[i]?.items || [])
              }))
            : tmpl.categories;
        break;
      case 'whyChoose':
        out.headline = !isEmpty(base.headline) ? base.headline : tmpl.headline;
        out.reasons =
          Array.isArray(base.reasons) && base.reasons.length
            ? base.reasons.map((r, i) => ({
                title: !isEmpty(r?.title) ? r.title : tmpl.reasons[i]?.title,
                text: !isEmpty(r?.text) ? r.text : tmpl.reasons[i]?.text
              }))
            : tmpl.reasons;
        break;
      default:
        break;
    }

    return out;
  });
}

module.exports = { normalizeAgenciesSlides, normalizeSlideType };
