const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const paypal = require('paypal-rest-sdk');
const Transaction = require('../models/Transaction');
const Plan = require('../models/Plan');
const User = require('../models/User');

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
        return_url: `${process.env.FRONTEND_URL}/payment/success`,
        cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`
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
        // Update transaction
        const transaction = await Transaction.findOneAndUpdate(
          { paymentId: paymentId },
          { 
            status: 'pending', // Still pending until admin approval
            paymentId: payment.id
          },
          { new: true }
        );

        if (!transaction) {
          return res.status(404).json({ message: 'Transaction not found' });
        }

        res.json({
          success: true,
          message: 'Payment successful! Our team will reach you shortly.',
          transaction
        });
      }
    });
  } catch (error) {
    console.error('Payment execution error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

