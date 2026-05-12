const SiteSetting = require('../models/SiteSetting');
const Service = require('../models/Service');
const User = require('../models/User');
const { TABALT_SALESFORCE_CATALOG } = require('../data/tabaltSalesforceServiceCatalog');

const TARGET_VERSION = 'tabalt-salesforce-personas-2026-05';

/**
 * One-time style migration: replaces legacy HR catalog with Tabalt Salesforce personas.
 * Idempotent via SiteSetting tabalt_service_catalog_version.
 * - Deactivates legacy HR services (keeps documents for historical chat refs).
 * - Inserts new active Service rows from TABALT_SALESFORCE_CATALOG.
 * - Clears agent/customer serviceCategory pointers so admins reassign intentionally.
 */
async function ensureTabaltSalesforceServices() {
  const current = await SiteSetting.get('tabalt_service_catalog_version', '');
  if (current === TARGET_VERSION) {
    return;
  }

  const legacyHr = await Service.findOne({
    isActive: true,
    $or: [
      { name: /HR Setup/i },
      { name: /Hiring \& Recruitment/i },
      { name: /Virtual HR/i },
      { name: /Payroll, Salary/i },
    ],
  });

  const alreadySf = await Service.findOne({
    isActive: true,
    $or: [
      { name: /Financial Services Cloud/i },
      { name: /OmniStudio, FlexCards/i },
      { name: /Apex, LWC, APIs/i },
    ],
  });

  if (alreadySf) {
    await SiteSetting.set('tabalt_service_catalog_version', TARGET_VERSION);
    return;
  }

  const activeCount = await Service.countDocuments({ isActive: true });
  if (!legacyHr && activeCount > 0) {
    return;
  }

  await Service.updateMany({}, { $set: { isActive: false } });

  const docs = TABALT_SALESFORCE_CATALOG.map((row) => ({
    name: row.name,
    industryCloud: row.industryCloud,
    description: row.description || '',
    subServices: (row.subServices || []).map((text) => ({
      name: text,
      description: '',
    })),
    isActive: true,
  }));

  await Service.insertMany(docs);

  await User.updateMany(
    { role: { $in: ['agent', 'customer'] } },
    { $set: { serviceCategories: [] }, $unset: { serviceCategory: 1 } }
  );

  await SiteSetting.set('tabalt_service_catalog_version', TARGET_VERSION);
  console.log(`✓ Tabalt Salesforce service catalog installed (${docs.length} services)`);
}

module.exports = { ensureTabaltSalesforceServices, TARGET_VERSION };
