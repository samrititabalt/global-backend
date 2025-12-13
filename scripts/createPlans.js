const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const { DEFAULT_PLANS } = require('../constants/defaultPlans');
require('dotenv').config();

const createPlans = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare');
    console.log('✓ Connected to MongoDB');

    const plans = DEFAULT_PLANS.map(
      ({ slug, marketingLabel, marketingSummary, marketingHighlight, marketingFeatures, isPopular, ...plan }) => plan
    );

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

