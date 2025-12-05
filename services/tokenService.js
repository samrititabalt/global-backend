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

const checkTokenBalance = async (customerId) => {
  try {
    const customer = await User.findById(customerId);
    return customer ? customer.tokenBalance : 0;
  } catch (error) {
    console.error('Error checking token balance:', error);
    return 0;
  }
};

module.exports = { deductToken, addTokens, checkTokenBalance };

