const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const passport = require('passport');
require('dotenv').config();
const { ensureDefaultPlans } = require('./utils/planDefaults');

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://mainproduct.vercel.app',
  'https://mainproduct.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
};

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Session configuration for OAuth (optional, but recommended)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Email service is ready to use (no initialization needed)
console.log('📧 Email service ready');

// Database Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/globalcare', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  console.log('MongoDB Connected ' + process.env.MONGODB_URI);
  try {
    await ensureDefaultPlans();
    console.log('Default plans ready');
  } catch (planError) {
    console.error('Failed to seed default plans:', planError.message);
  }
})
.catch(err => console.error('MongoDB Connection Error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/customer', require('./routes/customer'));
app.use('/api/agent', require('./routes/agent'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/public', require('./routes/public'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/call', require('./routes/call'));
app.use('/api/payment', require('./routes/payment'));

// Redirect common OAuth routes that are missing /api prefix
app.get('/auth/google', (req, res) => {
  res.redirect(301, '/api/auth/google');
});
app.get('/auth/google/callback', (req, res) => {
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/auth/google/callback${queryString}`);
});
app.get('/auth/microsoft', (req, res) => {
  res.redirect(301, '/api/auth/microsoft');
});
app.get('/auth/microsoft/callback', (req, res) => {
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/auth/microsoft/callback${queryString}`);
});

// Make io available to routes
app.set('io', io);

// Socket.io Connection Handling
const socketHandler = require('./socket/socketHandler');
socketHandler(io);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

