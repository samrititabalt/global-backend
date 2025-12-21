const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const paypal = require('paypal-rest-sdk');
const Transaction = require('../models/Transaction');
const Plan = require('../models/Plan');
const User = require('../models/User');
const { addTokens } = require('../services/tokenService');

// Configure PayPal
paypal.configure({
  mode: process.env.PAYPAL_MODE || 'sandbox',
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// @route   POST /api/payment/create
// @desc    Create PayPal payment
// @access  Private (Customer)
router.post('/create', protect, authorize('customer'), async (req, res) => {
  try {
    const { planId } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const create_payment_json = {
      intent: 'sale',
      payer: {
        payment_method: 'paypal'
      },
      redirect_urls: {
        return_url: `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/payment/success`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/payment/cancel?paymentId=${planId}`
      },
      transactions: [{
        item_list: {
          items: [{
            name: plan.name,
            sku: plan._id.toString(),
            price: plan.price.toString(),
            currency: 'USD',
            quantity: 1
          }]
        },
        amount: {
          currency: 'USD',
          total: plan.price.toString()
        },
        description: plan.description || `Purchase ${plan.name} plan`
      }]
    };

    paypal.payment.create(create_payment_json, async (error, payment) => {
      if (error) {
        console.error('PayPal error:', error);
        return res.status(500).json({ message: 'Payment creation failed', error: error.response });
      } else {
        // Create transaction record
        const transaction = await Transaction.create({
          customer: req.user._id,
          plan: planId,
          amount: plan.price,
          tokens: plan.tokens,
          paymentId: payment.id,
          status: 'pending'
        });

        // Update customer plan status
        await User.findByIdAndUpdate(req.user._id, {
          planStatus: 'pending',
          currentPlan: planId
        });

        // Find approval URL
        const approvalUrl = payment.links.find(link => link.rel === 'approval_url');

        res.json({
          success: true,
          paymentId: payment.id,
          approvalUrl: approvalUrl.href,
          transactionId: transaction._id
        });
      }
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/payment/execute
// @desc    Execute PayPal payment
// @access  Private (Customer)
router.post('/execute', protect, authorize('customer'), async (req, res) => {
  try {
    const { paymentId, payerId } = req.body;

    const execute_payment_json = {
      payer_id: payerId
    };

    paypal.payment.execute(paymentId, execute_payment_json, async (error, payment) => {
      if (error) {
        console.error('PayPal execution error:', error);
        return res.status(500).json({ 
          message: 'Payment execution failed', 
          error: error.response 
        });
      } else {
        // Find transaction with plan populated
        const transaction = await Transaction.findOne({ paymentId: paymentId })
          .populate('plan')
          .populate('customer');

        if (!transaction) {
          return res.status(404).json({ message: 'Transaction not found' });
        }

        // Check if transaction is already approved to prevent duplicate token addition
        if (transaction.status === 'approved') {
          return res.json({
            success: true,
            message: 'Payment already processed successfully!',
            transaction
          });
        }

        // Automatically approve transaction and add tokens
        transaction.status = 'approved';
        transaction.paymentId = payment.id;
        transaction.approvedAt = new Date();
        await transaction.save();

        // Add tokens to customer automatically
        const tokenResult = await addTokens(
          transaction.customer._id,
          transaction.tokens,
          `Plan purchase: ${transaction.plan.name}`,
          null, // No admin approval needed
          transaction._id
        );

        if (!tokenResult.success) {
          console.error('Error adding tokens:', tokenResult.message);
          // Still mark transaction as approved, but log the error
        }

        // Update customer plan status to approved
        await User.findByIdAndUpdate(transaction.customer._id, {
          planStatus: 'approved',
          currentPlan: transaction.plan._id
        });

        res.json({
          success: true,
          message: 'Payment successful! Your plan has been activated and tokens have been added to your account.',
          transaction,
          tokenBalance: tokenResult.balance
        });
      }
    });
  } catch (error) {
    console.error('Payment execution error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/payment/cancel
// @desc    Handle payment cancellation
// @access  Public (called by PayPal redirect)
router.get('/cancel', async (req, res) => {
  try {
    const { paymentId, planId } = req.query;

    if (paymentId) {
      // Find and update transaction status
      const transaction = await Transaction.findOne({ paymentId });
      if (transaction) {
        transaction.status = 'cancelled';
        await transaction.save();

        // Reset customer plan status if needed
        await User.findByIdAndUpdate(transaction.customer, {
          planStatus: 'none',
          currentPlan: null
        });
      }
    }

    // Redirect to frontend cancellation page with info
    const cancelUrl = `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/payment/cancel${planId ? `?planId=${planId}` : ''}`;
    res.redirect(cancelUrl);
  } catch (error) {
    console.error('Payment cancellation error:', error);
    // Still redirect to frontend even if backend error
    const cancelUrl = `${process.env.FRONTEND_URL || 'https://mainproduct.vercel.app'}/customer/payment/cancel`;
    res.redirect(cancelUrl);
  }
});

module.exports = router;

