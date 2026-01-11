const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized to access this route' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Special case: If user is spbajaj25@gmail.com and trying to access admin routes,
      // temporarily set role to admin for authorization
      if (req.user.email && req.user.email.toLowerCase() === 'spbajaj25@gmail.com') {
        // Create a temporary role override for authorization checks
        req.user._originalRole = req.user.role;
        req.user.role = 'admin';
      }

      next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized to access this route' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    // Special exception: Allow spbajaj25@gmail.com to access admin routes
    const isOwnerEmail = req.user && req.user.email && req.user.email.toLowerCase() === 'spbajaj25@gmail.com';
    
    if (!roles.includes(req.user.role) && !(isOwnerEmail && roles.includes('admin'))) {
      return res.status(403).json({ 
        message: `User role '${req.user.role}' is not authorized to access this route` 
      });
    }
    next();
  };
};

