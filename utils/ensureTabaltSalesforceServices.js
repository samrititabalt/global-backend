const SiteSetting = require('../models/SiteSetting');
const Service = require('../models/Service');
const User = require('../models/User');
const { TABALT_SALESFORCE_CATALOG } = require('../data/tabaltSalesforceServiceCatalog');

/** Bump when migration eligibility rules change so production re-runs once. */
const TARGET_VERSION = 'tabalt-salesforce-personas-2026-12';

/**
 * One-time style migration: replaces legacy HR or pre-SF Tabalt catalogs with Salesforce personas.
 * Idempotent via SiteSetting tabalt_service_catalog_version.
 * - Deactivates replaced services (keeps rows for historical refs).
 * - Inserts new active Service rows from TABALT_SALESFORCE_CATALOG.
 * - Clears agent/customer serviceCategory pointers so admins reassign intentionally.
 */
async function ensureTabaltSalesforceServices() {
  const current = await SiteSetting.get('tabalt_service_catalog_version', '');
  if (current === TARGET_VERSION) {
    return;
  }

  /** Early Tabalt verticals (HR, accounting/concierge, etc.) — not the SF freelancer catalog. */
  const LEGACY_NAME_OR = [
    { name: /HR Setup/i },
    { name: /Hiring \& Recruitment/i },
    { name: /Virtual HR/i },
    { name: /Payroll, Salary/i },
    { name: /Accounting\s*&\s*Payroll/i },
    { name: /Call Centre|Call Center/i },
    { name: /Concierge/i },
    { name: /Employee Support/i },
    { name: /General Support/i },
    { name: /^Healthcare\b/i },
    { name: /\bIT Services\b/i },
  ];

  const legacyCatalogHit = await Service.findOne({
    isActive: true,
    $or: LEGACY_NAME_OR,
  });

  const alreadySf = await Service.findOne({
    isActive: true,
    $or: [
      { name: /Financial Services Cloud/i },
      { name: /OmniStudio, FlexCards/i },
      { name: /Apex, LWC, APIs/i },
      { name: /Telecom \& Communications Cloud/i },
      { name: /Education Cloud —/i },
      { name: /^Health Cloud —/i },
      { name: /Sales Cloud \& Revenue/i },
      { name: /Service Cloud \& Field Service/i },
      { name: /Marketing Cloud, Account Engagement/i },
      { name: /Experience Cloud —/i },
      { name: /Data Cloud, CRM Analytics/i },
      { name: /Security, identity, DevOps/i },
    ],
  });

  const activeCount = await Service.countDocuments({ isActive: true });

  if (alreadySf && !legacyCatalogHit) {
    await SiteSetting.set('tabalt_service_catalog_version', TARGET_VERSION);
    return;
  }

  if (alreadySf && legacyCatalogHit) {
    await Service.updateMany(
      { isActive: true, $or: LEGACY_NAME_OR },
      { $set: { isActive: false } }
    );
    await SiteSetting.set('tabalt_service_catalog_version', TARGET_VERSION);
    console.log('✓ Deactivated legacy Tabalt verticals (Salesforce catalog already present)');
    return;
  }

  if (!legacyCatalogHit && activeCount > 0) {
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
