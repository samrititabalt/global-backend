/**
 * Migration script to assign customer IDs to existing customers
 * Run this script once to assign customer IDs to all existing customers
 * 
 * Usage: node scripts/assignCustomerIds.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const assignCustomerIds = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Connected to MongoDB');
    console.log('🔄 Starting customer ID assignment...\n');

    // Find all customers without customer IDs
    const customersWithoutId = await User.find({
      role: 'customer',
      $or: [
        { customerId: null },
        { customerId: { $exists: false } }
      ]
    });

    console.log(`Found ${customersWithoutId.length} customers without customer IDs\n`);

    let assigned = 0;
    let errors = 0;

    for (const customer of customersWithoutId) {
      try {
        // Generate unique customer ID
        let customerId;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 10;

        while (!isUnique && attempts < maxAttempts) {
          const timestamp = Date.now().toString().slice(-8);
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          customerId = `CUST${timestamp}${random}`;

          // Check if ID already exists
          const existing = await User.findOne({ customerId });
          if (!existing) {
            isUnique = true;
          }
          attempts++;
        }

        if (!isUnique) {
          console.error(`❌ Failed to generate unique ID for customer ${customer.email} after ${maxAttempts} attempts`);
          errors++;
          continue;
        }

        // Assign customer ID
        customer.customerId = customerId;
        await customer.save();

        assigned++;
        console.log(`✅ Assigned ${customerId} to ${customer.name} (${customer.email})`);
      } catch (error) {
        console.error(`❌ Error assigning ID to ${customer.email}:`, error.message);
        errors++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Assigned: ${assigned}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📝 Total processed: ${customersWithoutId.length}`);

    // Close connection
    await mongoose.connection.close();
    console.log('\n✅ Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

// Run the migration
assignCustomerIds();

