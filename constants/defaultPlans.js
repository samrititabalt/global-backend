const DEFAULT_PLANS = [
  {
    slug: 'trial',
    name: 'Basic Trial Pack',
    description: '300 minutes/month',
    price: 49.99,
    tokens: 300, // 300 minutes
    minutesPerMonth: 300,
    hoursPerMonth: 5, // Keep for backward compatibility
    bonusFeatures: [],
    marketingLabel: 'BASIC TRIAL PACK',
    marketingSummary: 'Perfect for trying out our services with minimal commitment.',
    marketingHighlight: 'Great for quick pilots and proof of concepts.',
    marketingFeatures: [
      'Limited minutes ideal for testing',
      'Includes standard support',
      'Cancel anytime',
    ],
    isPopular: false,
  },
  {
    slug: 'starter',
    name: 'Starter',
    description: '1200 minutes/month',
    price: 99.99,
    tokens: 1200, // 1200 minutes
    minutesPerMonth: 1200,
    hoursPerMonth: 20, // Keep for backward compatibility
    bonusFeatures: [],
    marketingLabel: 'STARTER PACK',
    marketingSummary: 'Best for teams that are ready to scale with confidence.',
    marketingHighlight: 'Reliable capacity for growing operations.',
    marketingFeatures: [
      'Dedicated account specialist',
      'Faster response times',
      'Weekly reporting',
    ],
    isPopular: false,
  },
  {
    slug: 'fulltime',
    name: 'Full Time',
    description: '9600 minutes/month (Bonus: Weekend Support)',
    price: 3000,
    tokens: 9600, // 9600 minutes
    minutesPerMonth: 9600,
    hoursPerMonth: 160, // Keep for backward compatibility
    bonusFeatures: ['Weekend Support'],
    marketingLabel: 'FULL TIME',
    marketingSummary: 'Premium capacity with weekend coverage and premium SLAs.',
    marketingHighlight: 'Complete coverage for mission-critical workloads.',
    marketingFeatures: [
      'Weekend support included',
      'Premium success manager',
      'Custom workflows and QA',
    ],
    isPopular: true,
  },
  {
    slug: 'loadcash',
    name: 'Load Cash Minimum',
    description: 'Minimum (120 minutes)',
    price: 50,
    tokens: 120, // 120 minutes
    minutesPerMonth: 120,
    hoursPerMonth: 2, // Keep for backward compatibility
    bonusFeatures: [],
    marketingLabel: 'LOAD CASH MINIMUM',
    marketingSummary: 'Flexible minimum load with on-demand access.',
    marketingHighlight: 'Pay-as-you-go flexibility.',
    marketingFeatures: [
      'Use balance anytime',
      'Perfect for ad-hoc tasks',
      'No expiration for unused minutes',
    ],
    isPopular: false,
  },
];

module.exports = { DEFAULT_PLANS };
