const jwt = require('jsonwebtoken');

const generateAskSandyToken = (id) => {
  return jwt.sign(
    { id, type: 'ask_sandy' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

module.exports = generateAskSandyToken;
