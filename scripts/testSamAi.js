/**
 * Quick sanity check for the SamAI ↔ OpenAI pipeline.
 * Usage:
 *   node scripts/testSamAi.js "your question" "Service Name"
 */
require('dotenv').config();

const { generateAIResponse } = require('../services/openaiService');

const [, , promptArg, serviceArg] = process.argv;
const prompt = promptArg || 'Hi there!';
const serviceName = serviceArg || 'General Support';

async function run() {
  try {
    console.log(`Service : ${serviceName}`);
    console.log(`Prompt  : ${prompt}`);

    const response = await generateAIResponse(prompt, [], serviceName);
    console.log('SamAI →', response);
  } catch (error) {
    console.error('Test failed:', error);
    process.exitCode = 1;
  }
}

run();

