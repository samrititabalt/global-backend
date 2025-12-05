const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare');
    console.log('✓ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@globalcare.com' });
    if (existingAdmin) {
      console.log('✗ Admin already exists with email: admin@globalcare.com');
      process.exit(0);
    }

    // Hash password
    const password = 'admin123'; // Default password - CHANGE THIS IN PRODUCTION
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@globalcare.com',
      phone: '1234567890',
      country: 'USA',
      password: hashedPassword,
      role: 'admin'
    });

    console.log('\n✓ Admin created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Email: admin@globalcare.com');
    console.log('Password: admin123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n⚠️  IMPORTANT: Change the password after first login!');
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error creating admin:', error.message);
    process.exit(1);
  }
};

createAdmin();

