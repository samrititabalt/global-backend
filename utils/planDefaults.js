const Plan = require('../models/Plan');
const { DEFAULT_PLANS } = require('../constants/defaultPlans');

const normalizePlanSlug = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

const getMetaForPlan = (planDoc) => {
  if (!planDoc) return null;
  const name = planDoc.name || '';
  const slug = normalizePlanSlug(name);
  return (
    DEFAULT_PLANS.find(
      (plan) =>
        plan.slug === planDoc.slug ||
        plan.slug === slug ||
        plan.name.toLowerCase() === name.toLowerCase()
    ) || null
  );
};

const ensureDefaultPlans = async () => {
  try {
    const existingPlans = await Plan.find({});
    const existingMap = new Map(
      existingPlans.map((plan) => [plan.name.toLowerCase(), plan])
    );

    for (const defaultPlan of DEFAULT_PLANS) {
      if (!existingMap.has(defaultPlan.name.toLowerCase())) {
        const { slug, marketingLabel, marketingSummary, marketingHighlight, marketingFeatures, isPopular, ...planData } =
          defaultPlan;
        await Plan.create(planData);
        console.log(`✓ Seeded plan "${defaultPlan.name}"`);
      }
    }
  } catch (error) {
    console.error('Failed to ensure default plans:', error.message);
  }
};

const formatPlanForResponse = (planDoc) => {
  if (!planDoc) return null;
  const raw = planDoc.toObject ? planDoc.toObject() : planDoc;
  const normalizedSlug = normalizePlanSlug(raw.name || raw._id?.toString() || '');
  const meta = getMetaForPlan(raw);

  return {
    ...raw,
    _id: raw._id?.toString ? raw._id.toString() : raw._id,
    slug: meta?.slug || normalizedSlug,
    marketingLabel: meta?.marketingLabel || (raw.name || '').toUpperCase(),
    marketingSummary: meta?.marketingSummary || raw.description || '',
    marketingHighlight: meta?.marketingHighlight || '',
    marketingFeatures: meta?.marketingFeatures || raw.bonusFeatures || [],
    isPopular: typeof meta?.isPopular === 'boolean' ? meta.isPopular : false,
  };
};

module.exports = {
  ensureDefaultPlans,
  formatPlanForResponse,
  normalizePlanSlug,
};
