const User = require('../models/User');
const TokenTransaction = require('../models/TokenTransaction');

const deductToken = async (customerId, messageId = null) => {
  try {
    const customer = await User.findById(customerId);
    
    if (!customer || customer.tokenBalance <= 0) {
      return { success: false, message: 'Insufficient token balance' };
    }

    customer.tokenBalance -= 1;
    await customer.save();

    // Record transaction
    await TokenTransaction.create({
      customer: customerId,
      amount: -1,
      type: 'deduct',
      reason: 'Message sent',
      message: messageId
    });

    return { success: true, balance: customer.tokenBalance };
  } catch (error) {
    console.error('Error deducting token:', error);
    return { success: false, message: 'Error processing token deduction' };
  }
};

const addTokens = async (customerId, amount, reason, performedBy = null, transactionId = null) => {
  try {
    const customer = await User.findById(customerId);
    
    if (!customer) {
      return { success: false, message: 'Customer not found' };
    }

    customer.tokenBalance += amount;
    await customer.save();

    // Record transaction
    await TokenTransaction.create({
      customer: customerId,
      amount: amount,
      type: performedBy ? 'admin_adjustment' : 'add',
      reason: reason,
      transaction: transactionId,
      performedBy: performedBy
    });

    return { success: true, balance: customer.tokenBalance };
  } catch (error) {
    console.error('Error adding tokens:', error);
    return { success: false, message: 'Error processing token addition' };
  }
};

/**
 * Deduct a specified number of minutes from customer (used for request budget).
 * Allows negative balance; caller should notify admin when balance goes negative.
 */
const deductTokens = async (customerId, amount, reason = 'Request budget') => {
  try {
    const customer = await User.findById(customerId);
    if (!customer) return { success: false, message: 'Customer not found' };
    const mins = Math.round(Number(amount) || 0);
    if (mins <= 0) return { success: false, message: 'Amount must be positive' };

    customer.tokenBalance -= mins;
    await customer.save();

    await TokenTransaction.create({
      customer: customerId,
      amount: -mins,
      type: 'deduct',
      reason: reason || 'Request budget'
    });

    return { success: true, balance: customer.tokenBalance };
  } catch (error) {
    console.error('Error deducting tokens:', error);
    return { success: false, message: 'Error processing token deduction' };
  }
};

const checkTokenBalance = async (customerId) => {
  try {
    const customer = await User.findById(customerId);
    return customer ? customer.tokenBalance : 0;
  } catch (error) {
    console.error('Error checking token balance:', error);
    return 0;
  }
};

module.exports = { deductToken, addTokens, deductTokens, checkTokenBalance };

