const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Activity = require('../models/Activity');
const { generateAIResponse } = require('../services/openaiService');
const mail = require('../utils/sendEmail');

// Track email failures for admin alerts
const emailFailureCounts = new Map();
const ADMIN_EMAIL = 'spbajaj25@gmail.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mainproduct.vercel.app';

// Helper: Send email with retry logic
const sendEmailWithRetry = async (to, subject, html, maxRetries = 3) => {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await mail(to, subject, html);
      if (result.success) {
        // Reset failure count on success
        emailFailureCounts.delete(to);
        return { success: true, attempt };
      }
      lastError = new Error(result.error || 'Email send failed');
    } catch (error) {
      lastError = error;
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Track failure
  const currentCount = emailFailureCounts.get(to) || 0;
  emailFailureCounts.set(to, currentCount + 1);

  return { success: false, error: lastError?.message || 'Email send failed after retries', attempt: maxRetries };
};

// Helper: Generate GPT summary from transcript
const generateChatSummary = async (transcript) => {
  try {
    if (!transcript || !transcript.trim()) {
      return 'No chat transcript available.';
    }

    const summaryPrompt = `Summarize this customer service chat conversation in 1-2 sentences. Focus on the main inquiry or issue. Keep it concise and professional.

Chat Transcript:
${transcript}

Summary:`;

    const summary = await generateAIResponse(summaryPrompt, [], 'default');
    return summary.trim() || 'Customer inquiry via chatbot.';
  } catch (error) {
    console.error('Error generating chat summary:', error);
    return 'Chat conversation summary unavailable.';
  }
};

// Helper: Normalize phone number (basic E.164 attempt)
const normalizePhone = (phone) => {
  if (!phone) return null;
  let normalized = phone.trim().replace(/[\s-()]/g, '');
  
  // If starts with country code, keep it
  if (normalized.startsWith('+')) {
    return normalized;
  }
  
  // If UK number (starts with 0), replace with +44
  if (normalized.startsWith('0')) {
    normalized = '+44' + normalized.substring(1);
  } else if (!normalized.startsWith('+')) {
    // Assume UK if no country code
    normalized = '+44' + normalized;
  }
  
  return normalized;
};

// Helper: Send admin error email
const sendAdminErrorEmail = async (errorDetails, stackTrace) => {
  const subject = 'CRM Lead Capture Error - Tabalt Support';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
        .content { background: white; padding: 20px; border: 1px solid #ddd; }
        .error-box { background: #f8d7da; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #dc3545; }
        .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>CRM Lead Capture Error</h2>
        </div>
        <div class="content">
          <p>A lead capture operation failed in the chatbot integration.</p>
          <div class="error-box">
            <p><strong>Error Details:</strong></p>
            <p>${errorDetails}</p>
            ${stackTrace ? `<pre style="font-size: 11px; overflow-x: auto;">${stackTrace}</pre>` : ''}
          </div>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        </div>
        <div class="footer">
          <p>This is an automated error notification from the Tabalt Support system.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await mail(ADMIN_EMAIL, subject, html);
  } catch (err) {
    console.error('Failed to send admin error email:', err);
  }
};

// @route   POST /api/chatbot/send-chat-transcript
// @desc    Send chat transcript email on chat close
// @access  Public
router.post('/send-chat-transcript', async (req, res) => {
  try {
    const {
      transcript,
      pageUrl,
      timestamp,
      email,
      phone,
      name,
      company,
      consent
    } = req.body;

    if (!transcript) {
      return res.status(400).json({
        success: false,
        message: 'Transcript is required'
      });
    }

    const chatTimestamp = timestamp ? new Date(timestamp) : new Date();
    const formattedTimestamp = chatTimestamp.toISOString();
    const subject = `New Tabalt Support Chat — ${chatTimestamp.toLocaleString()}`;

    // Build contact info section
    let contactSection = '';
    const hasContactInfo = email || phone || name || company;
    
    if (hasContactInfo) {
      contactSection = `
        <div style="background: #e8f4f8; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #2196F3;">
          <h3 style="margin-top: 0;">Contact Information</h3>
          <div style="line-height: 1.8;">
            ${name ? `<p><strong>Name:</strong> ${name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
            ${email ? `<p><strong>Email:</strong> ${email.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
            ${phone ? `<p><strong>Phone:</strong> ${phone.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
            ${company ? `<p><strong>Company:</strong> ${company.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
            ${consent !== undefined ? `<p><strong>Consent Provided:</strong> ${consent ? 'Yes' : 'No'}</p>` : ''}
          </div>
        </div>
      `;
    } else {
      contactSection = `
        <div style="background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107;">
          <p><strong>Note:</strong> No contact information provided by visitor.</p>
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 5px 5px 0 0; }
          .content { background: white; padding: 25px; border: 1px solid #ddd; }
          .info-box { background: #f5f7fa; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #667eea; }
          .info-row { margin: 10px 0; }
          .info-label { font-weight: 600; color: #333; display: inline-block; min-width: 120px; }
          .info-value { color: #666; }
          .transcript-box { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #667eea; }
          .transcript-content { white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; color: #333; }
          .footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">New Tabalt Support Chat</h2>
          </div>
          <div class="content">
            <p>A visitor has closed the chat window on the homepage.</p>
            
            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Timestamp:</span>
                <span class="info-value">${chatTimestamp.toLocaleString()} (${formattedTimestamp})</span>
              </div>
              <div class="info-row">
                <span class="info-label">Page URL:</span>
                <span class="info-value">${pageUrl || 'Not available'}</span>
              </div>
            </div>

            ${contactSection}

            <div class="transcript-box">
              <h3 style="margin-top: 0;">Full Chat Transcript</h3>
              <div class="transcript-content">${transcript.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated email from the Tabalt Support chatbot system.</p>
            <p>Chat closed at: ${formattedTimestamp}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email with retry
    const emailResult = await sendEmailWithRetry(ADMIN_EMAIL, subject, htmlContent);

    // Log activity
    await Activity.create({
      type: 'chatbot_interaction',
      description: `Chat transcript sent: Visitor closed chat${email ? ` (${email})` : ''}`,
      metadata: {
        pageUrl,
        timestamp: formattedTimestamp,
        hasContactInfo,
        emailSent: emailResult.success
      }
    }).catch(err => console.error('Error creating activity:', err));

    // Check for repeated failures and send admin alert
    const failureCount = emailFailureCounts.get(ADMIN_EMAIL) || 0;
    if (failureCount >= 3) {
      await sendAdminErrorEmail(
        `Email sending has failed ${failureCount} times in the last 24 hours for chat transcripts.`,
        null
      );
      emailFailureCounts.set(ADMIN_EMAIL, 0); // Reset after alert
    }

    if (emailResult.success) {
      res.json({
        success: true,
        message: 'Chat transcript sent successfully',
        attempt: emailResult.attempt
      });
    } else {
      // Log error but don't fail the request
      console.error('Failed to send chat transcript email after retries:', emailResult.error);
      res.status(500).json({
        success: false,
        message: 'Failed to send email after retries',
        error: emailResult.error
      });
    }

  } catch (error) {
    console.error('Send chat transcript error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process chat transcript',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/chatbot/lead
// @desc    Create or update chatbot lead with full transcript and send email
// @access  Public
router.post('/lead', async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const {
      email,
      phone,
      name,
      company,
      transcript,
      summary: providedSummary,
      pageUrl,
      utm,
      consent,
      clientRequestId,
      timestamp
    } = req.body;

    // Validate required fields
    if (!email) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate consent
    if (consent !== true && consent !== false) {
      await dbSession.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Consent must be provided (true/false)'
      });
    }

    // Check for idempotency (if clientRequestId provided)
    if (clientRequestId) {
      const existingRequest = await Activity.findOne({
        'metadata.clientRequestId': clientRequestId,
        'metadata.leadCreated': true
      }).session(dbSession);

      if (existingRequest) {
        await dbSession.abortTransaction();
        return res.json({
          success: true,
          message: 'Lead already processed',
          duplicate: true
        });
      }
    }

    // Normalize phone number
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    // Generate summary if not provided
    let finalSummary = providedSummary;
    if (!finalSummary && transcript) {
      finalSummary = await generateChatSummary(transcript);
    }
    if (!finalSummary) {
      finalSummary = 'Customer inquiry via chatbot.';
    }

    // Deduplication: Find existing lead by email or phone
    let existingLead = await Lead.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        ...(normalizedPhone ? [{ phoneNumber: normalizedPhone }] : [])
      ]
    }).session(dbSession);

    const dateCaptured = timestamp ? new Date(timestamp) : new Date();

    if (existingLead) {
      // Update existing lead
      existingLead.visitorName = name || existingLead.visitorName;
      existingLead.phoneNumber = normalizedPhone || existingLead.phoneNumber;
      existingLead.companyName = company || existingLead.companyName;
      existingLead.status = 'Lead'; // Reset to Lead if was Lost
      existingLead.dateCaptured = dateCaptured; // Update to latest
      existingLead.summary = finalSummary;
      existingLead.pageUrl = pageUrl || existingLead.pageUrl;
      existingLead.consent = consent;

      // Append new conversation
      if (transcript) {
        existingLead.conversations = existingLead.conversations || [];
        existingLead.conversations.push({
          timestamp: dateCaptured,
          transcript: transcript,
          summary: finalSummary
        });
        existingLead.transcript = transcript; // Keep latest transcript
      }

      // Update UTM if provided
      if (utm) {
        existingLead.utm = {
          source: utm.source || existingLead.utm?.source || null,
          campaign: utm.campaign || existingLead.utm?.campaign || null,
          medium: utm.medium || existingLead.utm?.medium || null,
          term: utm.term || existingLead.utm?.term || null,
          content: utm.content || existingLead.utm?.content || null
        };
      }

      await existingLead.save({ session: dbSession });
      var leadId = existingLead._id;
      var isUpdate = true;
    } else {
      // Create new lead
      const newLead = await Lead.create([{
        visitorName: name || null,
        email: email.toLowerCase().trim(),
        phoneNumber: normalizedPhone,
        companyName: company || null,
        source: 'Chatbot',
        status: 'Lead',
        dateCaptured: dateCaptured,
        transcript: transcript || null,
        summary: finalSummary,
        conversations: transcript ? [{
          timestamp: dateCaptured,
          transcript: transcript,
          summary: finalSummary
        }] : [],
        consent: consent,
        pageUrl: pageUrl || null,
        utm: utm ? {
          source: utm.source || null,
          campaign: utm.campaign || null,
          medium: utm.medium || null,
          term: utm.term || null,
          content: utm.content || null
        } : {},
        assignedAgent: null
      }], { session: dbSession });

      leadId = newLead[0]._id;
      isUpdate = false;
    }

    // Prepare email content
    const leadName = name || email;
    const emailSubject = `New Chatbot Lead from Tabalt Support — ${leadName}`;
    
    // Build chat transcript HTML
    let transcriptHtml = '';
    if (transcript) {
      transcriptHtml = `
        <div style="background: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #667eea;">
          <h3 style="margin-top: 0;">Full Chat Transcript</h3>
          <pre style="white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5;">${transcript.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
      `;
    }

    const adminDashboardUrl = `${FRONTEND_URL}/admin/dashboard`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 700px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 5px 5px 0 0; }
          .content { background: white; padding: 25px; border: 1px solid #ddd; }
          .info-box { background: #f5f7fa; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #667eea; }
          .info-row { margin: 10px 0; }
          .info-label { font-weight: 600; color: #333; display: inline-block; min-width: 140px; }
          .info-value { color: #666; }
          .summary-box { background: #e8f4f8; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #2196F3; }
          .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 15px; }
          .footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 5px 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">New Chatbot Lead from Tabalt Support</h2>
          </div>
          <div class="content">
            <p>A visitor has provided their contact information through the chatbot.</p>
            
            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Visitor Name:</span>
                <span class="info-value">${name || 'Not provided'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email:</span>
                <span class="info-value">${email}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Phone:</span>
                <span class="info-value">${phone || 'Not provided'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Company:</span>
                <span class="info-value">${company || 'Not provided'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Date Captured:</span>
                <span class="info-value">${dateCaptured.toLocaleString()}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Source:</span>
                <span class="info-value">Chatbot</span>
              </div>
              ${pageUrl ? `<div class="info-row"><span class="info-label">Page URL:</span><span class="info-value">${pageUrl}</span></div>` : ''}
              ${consent ? `<div class="info-row"><span class="info-label">Consent:</span><span class="info-value">✓ Provided</span></div>` : ''}
            </div>

            ${finalSummary ? `
            <div class="summary-box">
              <h3 style="margin-top: 0;">Chat Summary</h3>
              <p style="margin: 0;">${finalSummary.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
            </div>
            ` : ''}

            ${transcriptHtml}

            <div style="text-align: center; margin-top: 25px;">
              <a href="${adminDashboardUrl}" class="button">View in Admin Dashboard</a>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated email from the Tabalt Support chatbot system.</p>
            <p>Lead ID: ${leadId}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email with retry (outside transaction to avoid blocking)
    let emailResult = { success: false, error: 'Not sent' };
    try {
      emailResult = await sendEmailWithRetry(ADMIN_EMAIL, emailSubject, htmlContent);
    } catch (emailError) {
      console.error('Email send error (non-blocking):', emailError);
      // Don't fail the request if email fails
    }

    // Commit transaction
    await dbSession.commitTransaction();

    // Log activity
    await Activity.create({
      type: 'chatbot_contact_shared',
      description: isUpdate 
        ? `Chatbot lead updated: ${name || email} (${email})`
        : `Chatbot lead created: ${name || email} (${email})`,
      metadata: {
        leadId: leadId.toString(),
        email,
        isUpdate,
        clientRequestId: clientRequestId || null,
        leadCreated: true
      }
    }).catch(err => console.error('Error creating activity:', err));

    // Check for repeated failures and send admin alert
    const failureCount = emailFailureCounts.get(ADMIN_EMAIL) || 0;
    if (failureCount >= 3) {
      await sendAdminErrorEmail(
        `Email sending has failed ${failureCount} times in the last 24 hours for lead: ${email}`,
        null
      );
      emailFailureCounts.set(ADMIN_EMAIL, 0); // Reset after alert
    }

    res.json({
      success: true,
      message: isUpdate ? 'Lead updated successfully' : 'Lead created successfully',
      leadId: leadId.toString(),
      emailSent: emailResult.success
    });

  } catch (error) {
    await dbSession.abortTransaction();
    
    console.error('Chatbot lead creation error:', error);
    
    // Send admin error email (don't await to avoid blocking)
    sendAdminErrorEmail(
      `Failed to create/update lead: ${error.message}`,
      process.env.NODE_ENV === 'development' ? error.stack : undefined
    ).catch(err => console.error('Failed to send admin error email:', err));

    res.status(500).json({
      success: false,
      message: 'Failed to process lead. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    await dbSession.endSession();
  }
});

module.exports = router;
