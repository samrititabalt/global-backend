/**
 * Cleanup Script: Remove customerId from all agents and admins
 * This fixes the issue where agents might have customerId values causing duplicate key errors
 * 
 * Run with: node backend/scripts/cleanupAgentCustomerIds.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const cleanupAgentCustomerIds = async () => {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find all agents and admins with customerId
    const usersWithCustomerId = await User.find({
      role: { $in: ['agent', 'admin'] },
      customerId: { $exists: true, $ne: null }
    }).select('_id name email role customerId');

    console.log(`\n📊 Found ${usersWithCustomerId.length} agents/admins with customerId:`);
    usersWithCustomerId.forEach(user => {
      console.log(`  - ${user.name} (${user.email}) - Role: ${user.role} - customerId: ${user.customerId}`);
    });

    if (usersWithCustomerId.length === 0) {
      console.log('\n✅ No agents or admins have customerId. Database is clean!');
      await mongoose.disconnect();
      return;
    }

    // Remove customerId from all agents and admins
    const result = await User.updateMany(
      {
        role: { $in: ['agent', 'admin'] },
        customerId: { $exists: true }
      },
      {
        $unset: { customerId: '' }
      }
    );

    console.log(`\n✅ Successfully removed customerId from ${result.modifiedCount} users`);
    console.log(`   Matched: ${result.matchedCount} users`);
    
    // Verify cleanup
    const remaining = await User.find({
      role: { $in: ['agent', 'admin'] },
      customerId: { $exists: true, $ne: null }
    }).countDocuments();

    if (remaining === 0) {
      console.log('\n✅ Verification: All agents and admins are now clean (no customerId)');
    } else {
      console.log(`\n⚠️ Warning: ${remaining} users still have customerId. Please check manually.`);
    }

    await mongoose.disconnect();
    console.log('\n✅ Cleanup complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Run the cleanup
cleanupAgentCustomerIds();

