const mongoose = require('mongoose');
const User = require('../models/User');
const ResumeBuilderUsage = require('../models/ResumeBuilderUsage');

require('dotenv').config();

const updateResumeBuilderLimit = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare');
    console.log('✓ Connected to MongoDB');

    // Find all customers
    const customers = await User.find({ role: 'customer' });
    console.log(`\nFound ${customers.length} customers to update\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const customer of customers) {
      try {
        // Count how many times this customer has used the Resume Builder
        const usageCount = await ResumeBuilderUsage.countDocuments({ customer: customer._id });
        
        // Calculate remaining attempts: 100 - usageCount
        const newRemaining = 100 - usageCount;
        
        // Only update if the current value is different (to avoid unnecessary writes)
        // Also update if current value is null/undefined or less than what it should be
        const currentRemaining = customer.resumeBuilderUsageRemaining || 0;
        const shouldUpdate = currentRemaining !== newRemaining;
        
        if (shouldUpdate) {
          customer.resumeBuilderUsageRemaining = newRemaining;
          await customer.save();
          
          console.log(`✓ Updated ${customer.email}: ${usageCount} uses → ${newRemaining} remaining (was ${currentRemaining})`);
          updatedCount++;
        } else {
          console.log(`⊘ Skipped ${customer.email}: Already correct (${newRemaining} remaining)`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`✗ Error updating customer ${customer.email}:`, error.message);
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✓ Migration completed!`);
    console.log(`  Updated: ${updatedCount} customers`);
    console.log(`  Skipped: ${skippedCount} customers`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error running migration:', error.message);
    process.exit(1);
  }
};

updateResumeBuilderLimit();
