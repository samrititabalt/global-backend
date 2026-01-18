const express = require('express');
const PDFDocument = require('pdfkit');
const router = express.Router();

const { protect, authorize, authorizeProAccess } = require('../middleware/auth');
const { generateAIResponse } = require('../services/openaiService');
const {
  uploadToCloudinary: uploadRawToCloudinary,
  getSignedDownloadUrl
} = require('../services/cloudinary');
const { mail } = require('../utils/sendEmail');
const SamReport = require('../models/SamReport');
const SamReportAnalytics = require('../models/SamReportAnalytics');

const INDUSTRIES_FALLBACK = [
  'Aerospace & Defense', 'Agriculture', 'Alternative Energy', 'Apparel & Fashion',
  'Automotive', 'Banking', 'Biotechnology', 'Chemicals', 'Cloud Computing',
  'Construction', 'Consumer Electronics', 'Consumer Goods', 'Cybersecurity',
  'Data Centers', 'Education', 'Energy & Utilities', 'Entertainment & Media',
  'Environmental Services', 'FinTech', 'Food & Beverage', 'Forestry & Paper',
  'Gaming', 'Healthcare', 'Hospitality', 'Industrial Manufacturing',
  'Insurance', 'Logistics', 'Luxury Goods', 'Maritime', 'Metals & Mining',
  'Mobility', 'Oil & Gas', 'Payments', 'Pharmaceuticals', 'Professional Services',
  'Real Estate', 'Renewables', 'Retail', 'Robotics', 'Semiconductors',
  'Smart Cities', 'Software', 'Sports & Fitness', 'Telecommunications',
  'Travel', 'Transportation', 'Venture Capital', 'Waste Management',
  'Water & Sanitation', 'Wholesale & Distribution', 'E-commerce',
  'Digital Marketing', 'HR & Talent', 'Legal Services', 'Public Sector',
  'Supply Chain', 'Space Tech', 'Defense Tech', 'Agritech', 'MedTech'
];

const SECTOR_FALLBACK = {
  'Aerospace & Defense': ['Commercial Aviation', 'Defense Systems', 'Space Systems', 'Maintenance & Services'],
  Automotive: ['OEMs', 'EV Platforms', 'Auto Parts', 'Aftermarket Services'],
  Banking: ['Retail Banking', 'Corporate Banking', 'Wealth Management', 'Digital Banking'],
  Healthcare: ['Hospitals', 'Diagnostics', 'Digital Health', 'Medical Devices'],
  Retail: ['Grocery', 'Specialty Retail', 'Luxury Retail', 'Online Marketplaces'],
  'Energy & Utilities': ['Power Generation', 'Grid Infrastructure', 'Smart Meters', 'Energy Trading']
};

const ensurePaidAccess = (user) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'agent') return !!user.pro_access_enabled;
  if (user.role === 'customer') return user.planStatus === 'approved';
  return false;
};

const parseJsonFromResponse = (responseText) => {
  if (!responseText || typeof responseText !== 'string') return null;
  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    return null;
  }
};

const trackEvent = async (user, report, eventType, metadata = {}) => {
  try {
    await SamReportAnalytics.create({
      user: user?._id || null,
      report: report?._id || null,
      eventType,
      metadata
    });
  } catch (error) {
    console.error('Sam Reports analytics error:', error);
  }
};

const buildIndustryPrompt = ({ industry, sector, yearRange }) => `
Return a JSON object with the following keys:
overview, sectorInsights, keyTrends, marketDrivers, challenges, opportunities, forecastCommentary.

Context:
Industry: ${industry}
Sector: ${sector}
Year Range: ${yearRange}

Rules:
- Use concise executive language.
- keyTrends, marketDrivers, challenges, opportunities should be arrays of 3-5 bullet items.
`;

const buildCompanyPrompt = ({ companyName, industry, sector, region }) => `
Return a JSON object with the following keys:
overview, businessModel, keyFinancialIndicators, strategicPriorities, competitivePositioning, swot, futureOutlook.
The swot field must be an object with strengths, weaknesses, opportunities, threats arrays.

Context:
Company: ${companyName}
Industry: ${industry}
Sector: ${sector}
Region: ${region}

Rules:
- Keep any financial indicators qualitative unless stated.
- strategicPriorities should be an array of 3-5 bullet items.
`;

const buildCompanySuggestionsPrompt = ({ industry, sector, region }) => `
Return a JSON array of 5 objects with keys: name, summary, why.
Each summary should be 1-2 lines. Each why should be 1 line.

Context:
Industry: ${industry}
Sector: ${sector}
Region: ${region}
`;

const buildIndustryFallback = ({ industry, sector, yearRange }) => ({
  overview: `${industry} is experiencing a mix of consolidation and targeted innovation as operators rebalance portfolios.`,
  sectorInsights: `${sector} performance is driven by demand for efficiency, digital transformation, and resilient supply chains.`,
  keyTrends: ['Automation adoption', 'Platform consolidation', 'Data-driven procurement'],
  marketDrivers: ['Regulatory alignment', 'Operational efficiency', 'Capital reallocation'],
  challenges: ['Margin compression', 'Talent gaps', 'Fragmented regulation'],
  opportunities: ['Adjacency expansion', 'Partnership ecosystems', 'Regional specialization'],
  forecastCommentary: `${yearRange} outlook indicates steady growth with selective breakout segments.`
});

const buildCompanySuggestionsFallback = ({ industry }) => {
  const base = (industry || 'Insight').split(' ')[0] || 'Insight';
  return [
    { name: `${base} Horizon Labs`, summary: 'AI-enabled market intelligence platform.', why: 'Transforms decision speed across sectors.' },
    { name: `${base} Pulse Systems`, summary: 'Operational optimisation suite for enterprise teams.', why: 'Delivers measurable productivity gains.' },
    { name: `${base} Vertex Analytics`, summary: 'Sector benchmarking and competitive monitoring.', why: 'Raises visibility into market shifts.' },
    { name: `${base} Nova Markets`, summary: 'Next-gen distribution and demand sensing.', why: 'Improves revenue resilience.' },
    { name: `${base} Catalyst Partners`, summary: 'Strategic transformation advisory network.', why: 'Enables rapid scale and adoption.' }
  ];
};

const buildCompanyFallback = ({ companyName, industry, sector }) => ({
  overview: `${companyName} is positioned within ${industry} and focuses on ${sector} opportunities.`,
  businessModel: 'Recurring revenue model with advisory and data products.',
  keyFinancialIndicators: 'Early-stage metrics indicate strong pipeline conversion and stable retention.',
  strategicPriorities: ['Scale enterprise adoption', 'Expand partner channels', 'Enhance automation'],
  competitivePositioning: 'Differentiated through speed-to-insight and vertical expertise.',
  swot: {
    strengths: ['Specialized domain expertise', 'Agile delivery model'],
    weaknesses: ['Limited scale in new regions'],
    opportunities: ['Cross-sector bundles', 'International expansion'],
    threats: ['Large incumbents', 'Regulatory shifts']
  },
  futureOutlook: 'Positive outlook with growth tied to execution and market timing.'
});

const buildReportPdf = async (report) => {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, left: 50, right: 50, bottom: 50 } });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const title = report.reportType.includes('company') ? 'Company Profile Report' : 'Industry & Sector Report';
  doc.font('Helvetica-Bold').fontSize(20).text('Sam Reports', { align: 'left' });
  doc.font('Helvetica').fontSize(12).fillColor('#555').text('Sam Studios • Syndicated Insights', { align: 'left' });
  doc.moveDown(1);
  doc.fillColor('#111').fontSize(16).text(title);
  doc.moveDown(0.5);

  const metaLines = [
    report.industry && `Industry: ${report.industry}`,
    report.sector && `Sector: ${report.sector}`,
    report.yearRange && `Year Range: ${report.yearRange}`,
    report.companyName && `Company: ${report.companyName}`,
    report.region && `Region: ${report.region}`
  ].filter(Boolean);

  if (metaLines.length) {
    doc.font('Helvetica').fontSize(11).fillColor('#333');
    metaLines.forEach((line) => doc.text(line));
    doc.moveDown();
  }

  const content = report.content || {};
  const addSection = (label, value) => {
    if (!value) return;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1f2937').text(label);
    doc.moveDown(0.25);
    if (Array.isArray(value)) {
      doc.font('Helvetica').fontSize(11).fillColor('#374151');
      value.forEach((item) => doc.text(`• ${item}`, { indent: 12 }));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([key, list]) => {
        doc.font('Helvetica-Bold').fontSize(11).text(`${key}:`);
        if (Array.isArray(list)) {
          list.forEach((item) => doc.font('Helvetica').text(`• ${item}`, { indent: 12 }));
        }
      });
    } else {
      doc.font('Helvetica').fontSize(11).fillColor('#374151').text(value);
    }
    doc.moveDown();
  };

  addSection('Overview', content.overview);
  addSection('Sector Insights', content.sectorInsights);
  addSection('Key Trends', content.keyTrends);
  addSection('Market Drivers', content.marketDrivers);
  addSection('Challenges', content.challenges);
  addSection('Opportunities', content.opportunities);
  addSection('Forecast Commentary', content.forecastCommentary);
  addSection('Business Model', content.businessModel);
  addSection('Key Financial Indicators', content.keyFinancialIndicators);
  addSection('Strategic Priorities', content.strategicPriorities);
  addSection('Competitive Positioning', content.competitivePositioning);
  addSection('SWOT Analysis', content.swot);
  addSection('Future Outlook', content.futureOutlook);

  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(12).text('Charts & Tables');
  doc.font('Helvetica').fontSize(11).fillColor('#6b7280').text('Chart placeholder • Table placeholder');

  doc.end();
  await new Promise((resolve) => doc.on('end', resolve));
  return Buffer.concat(chunks);
};

router.get('/industries', protect, authorizeProAccess, async (req, res) => {
  try {
    const prompt = 'Generate a JSON array of at least 50 industries for market research.';
    const response = await generateAIResponse(prompt, [], 'sam reports');
    const parsed = parseJsonFromResponse(response);
    const industries = Array.isArray(parsed) ? parsed : INDUSTRIES_FALLBACK;
    res.json({ success: true, industries });
  } catch (error) {
    res.json({ success: true, industries: INDUSTRIES_FALLBACK });
  }
});

router.post('/sectors', protect, authorizeProAccess, async (req, res) => {
  try {
    const { industry } = req.body;
    if (!industry) {
      return res.status(400).json({ message: 'Industry is required' });
    }
    const prompt = `Generate a JSON array of sectors relevant to this industry: ${industry}.`;
    const response = await generateAIResponse(prompt, [], 'sam reports');
    const parsed = parseJsonFromResponse(response);
    const sectors = Array.isArray(parsed) ? parsed : (SECTOR_FALLBACK[industry] || ['Core Segment', 'Adjacent Segment']);
    res.json({ success: true, sectors });
  } catch (error) {
    res.json({ success: true, sectors: SECTOR_FALLBACK[req.body.industry] || ['Core Segment', 'Adjacent Segment'] });
  }
});

router.post('/industry-report', protect, authorizeProAccess, async (req, res) => {
  try {
    const { industry, sector, yearRange } = req.body;
    if (!industry || !sector || !yearRange) {
      return res.status(400).json({ message: 'Industry, sector, and year range are required' });
    }

    const prompt = buildIndustryPrompt({ industry, sector, yearRange });
    const response = await generateAIResponse(prompt, [], 'sam reports');
    const parsed = parseJsonFromResponse(response) || buildIndustryFallback({ industry, sector, yearRange });

    const report = await SamReport.create({
      user: req.user._id,
      reportType: 'industry',
      industry,
      sector,
      yearRange,
      content: parsed,
      isSample: false
    });

    await trackEvent(req.user, report, 'report_generated', { reportType: 'industry', industry, sector });

    if (req.user?.email) {
      mail(
        req.user.email,
        `Sam Reports generated: ${industry} • ${sector}`,
        `<p>Your Sam Reports industry report is ready.</p><p><strong>${industry}</strong> — ${sector}</p>`
      ).catch(() => {});
    }

    res.json({ success: true, report });
  } catch (error) {
    console.error('Sam Reports industry error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/company-report', protect, authorizeProAccess, async (req, res) => {
  try {
    const { companyName, industry, sector, region } = req.body;
    if (!companyName || !industry || !sector || !region) {
      return res.status(400).json({ message: 'Company name, industry, sector, and region are required' });
    }

    const prompt = buildCompanyPrompt({ companyName, industry, sector, region });
    const response = await generateAIResponse(prompt, [], 'sam reports');
    const parsed = parseJsonFromResponse(response) || buildCompanyFallback({ companyName, industry, sector });

    const report = await SamReport.create({
      user: req.user._id,
      reportType: 'company',
      companyName,
      industry,
      sector,
      region,
      content: parsed,
      isSample: false
    });

    await trackEvent(req.user, report, 'report_generated', { reportType: 'company', industry, sector });

    if (req.user?.email) {
      mail(
        req.user.email,
        `Sam Reports generated: ${companyName}`,
        `<p>Your Sam Reports company profile is ready.</p><p><strong>${companyName}</strong> — ${industry}</p>`
      ).catch(() => {});
    }

    res.json({ success: true, report });
  } catch (error) {
    console.error('Sam Reports company error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/company-suggestions', protect, authorizeProAccess, async (req, res) => {
  try {
    const { industry, sector, region } = req.body;
    if (!industry || !sector || !region) {
      return res.status(400).json({ message: 'Industry, sector, and region are required' });
    }

    const prompt = buildCompanySuggestionsPrompt({ industry, sector, region });
    const response = await generateAIResponse(prompt, [], 'sam reports');
    const parsed = parseJsonFromResponse(response);
    const suggestions = Array.isArray(parsed) ? parsed : buildCompanySuggestionsFallback({ industry });

    res.json({ success: true, suggestions });
  } catch (error) {
    res.json({ success: true, suggestions: buildCompanySuggestionsFallback({ industry: req.body.industry }) });
  }
});

router.post('/samples/generate', protect, authorizeProAccess, async (req, res) => {
  try {
    if (!ensurePaidAccess(req.user)) {
      return res.status(403).json({ message: 'Sample reports are available for paid customers only.' });
    }

    const sampleIndustry = 'Healthcare';
    const sampleSector = 'Digital Health';
    const sampleCompany = 'Nova Health Analytics';

    const industryContent = buildIndustryFallback({
      industry: sampleIndustry,
      sector: sampleSector,
      yearRange: '2025–2030 (Outlook)'
    });

    const companyContent = buildCompanyFallback({
      companyName: sampleCompany,
      industry: sampleIndustry,
      sector: sampleSector
    });

    const sampleReports = await SamReport.create([
      {
        user: req.user._id,
        reportType: 'sample_industry',
        industry: sampleIndustry,
        sector: sampleSector,
        yearRange: '2025–2030 (Outlook)',
        content: industryContent,
        isSample: true
      },
      {
        user: req.user._id,
        reportType: 'sample_company',
        companyName: sampleCompany,
        industry: sampleIndustry,
        sector: sampleSector,
        region: 'Global',
        content: companyContent,
        isSample: true
      }
    ]);

    await trackEvent(req.user, null, 'sample_generated', { count: sampleReports.length });
    res.json({ success: true, samples: sampleReports });
  } catch (error) {
    console.error('Sam Reports samples error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/samples/:id/view', protect, authorizeProAccess, async (req, res) => {
  try {
    const report = await SamReport.findById(req.params.id);
    if (!report || !report.isSample) {
      return res.status(404).json({ message: 'Sample report not found' });
    }

    await trackEvent(req.user, report, 'sample_viewed', { reportType: report.reportType });

    if (req.user?.email) {
      mail(
        req.user.email,
        'Sam Reports sample viewed',
        `<p>A sample report was viewed in Sam Reports.</p><p>${report.industry || report.companyName}</p>`
      ).catch(() => {});
    }

    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/report/:id/pdf', protect, authorizeProAccess, async (req, res) => {
  try {
    const report = await SamReport.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    const pdfBuffer = await buildReportPdf(report);
    const uploadResult = await uploadRawToCloudinary(pdfBuffer, {
      folder: 'sam-reports/pdfs',
      resource_type: 'image',
      format: 'pdf',
      content_type: 'application/pdf',
      type: 'upload'
    });

    report.pdfUrl = uploadResult?.secure_url || null;
    report.pdfPublicId = uploadResult?.public_id || null;
    await report.save();

    await trackEvent(req.user, report, 'pdf_generated', { reportType: report.reportType });

    res.json({ success: true, report });
  } catch (error) {
    console.error('Sam Reports PDF error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/report/:id/download', protect, authorizeProAccess, async (req, res) => {
  try {
    const report = await SamReport.findById(req.params.id);
    if (!report || !report.pdfPublicId) {
      return res.status(404).json({ message: 'PDF not found' });
    }

    const signedUrl = getSignedDownloadUrl(report.pdfPublicId, 'pdf', {
      resource_type: 'image',
      type: 'upload'
    });

    await trackEvent(req.user, report, 'pdf_downloaded', { reportType: report.reportType });

    if (req.user?.email) {
      mail(
        req.user.email,
        'Sam Reports PDF downloaded',
        `<p>Your Sam Reports PDF download is ready:</p><p><a href="${signedUrl}">Download PDF</a></p>`
      ).catch(() => {});
    }

    res.json({ success: true, url: signedUrl });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/analytics', protect, authorizeProAccess, async (req, res) => {
  try {
    const { eventType, metadata = {}, reportId } = req.body;
    if (!eventType) {
      return res.status(400).json({ message: 'eventType is required' });
    }
    await trackEvent(req.user, reportId ? { _id: reportId } : null, eventType, metadata);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/analytics/summary', protect, authorize('admin'), async (req, res) => {
  try {
    const totals = await SamReportAnalytics.aggregate([
      { $group: { _id: '$eventType', count: { $sum: 1 } } }
    ]);

    const topIndustries = await SamReport.aggregate([
      { $match: { industry: { $ne: '' } } },
      { $group: { _id: '$industry', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const topSectors = await SamReport.aggregate([
      { $match: { sector: { $ne: '' } } },
      { $group: { _id: '$sector', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      totals,
      topIndustries,
      topSectors
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
