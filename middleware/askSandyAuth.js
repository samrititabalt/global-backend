const jwt = require('jsonwebtoken');
const AskSandyUser = require('../models/AskSandyUser');

exports.protectAskSandy = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ message: 'Not authorized. Please log in to Ask Sandy.' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'ask_sandy') {
      return res.status(401).json({ message: 'Invalid token for Ask Sandy.' });
    }
    const user = await AskSandyUser.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found.' });
    }
    req.askSandyUser = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized to access this route' });
  }
};
