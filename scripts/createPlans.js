const mongoose = require('mongoose');
const Plan = require('../models/Plan');
require('dotenv').config();

const createPlans = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare');
    console.log('✓ Connected to MongoDB');

    const plans = [
      {
        name: 'Full Time',
        description: '160hrs/month (Bonus: Weekend Support)',
        price: 3000.00,
        tokens: 10000,
        hoursPerMonth: 160,
        bonusFeatures: ['Weekend Support']
      },
      {
        name: 'Basic Trial Pack',
        description: '5hrs/month',
        price: 49.99,
        tokens: 500,
        hoursPerMonth: 5,
        bonusFeatures: []
      },
      {
        name: 'Starter',
        description: '20hrs/month',
        price: 99.99,
        tokens: 2000,
        hoursPerMonth: 20,
        bonusFeatures: []
      },
      {
        name: 'Load Cash Minimum',
        description: 'Minimum (2hrs)',
        price: 50.00,
        tokens: 200,
        hoursPerMonth: 2,
        bonusFeatures: []
      }
    ];

    for (const planData of plans) {
      const existingPlan = await Plan.findOne({ name: planData.name });
      if (existingPlan) {
        console.log(`⚠️  Plan "${planData.name}" already exists, skipping...`);
        continue;
      }

      const plan = await Plan.create(planData);
      console.log(`✓ Created plan: ${plan.name} - $${plan.price} (${plan.tokens} tokens)`);
    }

    console.log('\n✓ All plans created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error creating plans:', error.message);
    process.exit(1);
  }
};

createPlans();

