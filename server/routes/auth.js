const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Audit = require('../models/Audit');
const { asyncHandler, ValidationError, AuthenticationError } = require('../middleware/errorHandler');
const { createManualAuditEntry } = require('../middleware/audit');

const router = express.Router();

// Validation middleware
const validateRegistration = [
  body('email').isEmail().normalizeEmail(),
  body('password')
    .isLength({ min: parseInt(process.env.PASSWORD_MIN_LENGTH) || 12 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  body('firstName').trim().isLength({ min: 1, max: 50 }),
  body('lastName').trim().isLength({ min: 1, max: 50 }),
  body('npi').isLength({ min: 10, max: 10 }).isNumeric(),
  body('licenseNumber').trim().isLength({ min: 1 }),
  body('specialty').trim().isLength({ min: 1 }),
  body('phone').matches(/^\+?[\d\s\-\(\)]+$/),
  body('address').trim().isLength({ min: 1 })
];

const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

// Register new healthcare provider
router.post('/register', validateRegistration, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const {
    email,
    password,
    firstName,
    lastName,
    npi,
    licenseNumber,
    specialty,
    phone,
    address
  } = req.body;

  // Check if user already exists
  const existingUser = await User.findByEmail(email);
  if (existingUser) {
    throw new ValidationError('User with this email already exists');
  }

  // Check if NPI already exists
  const existingNPI = await User.findByNPI(npi);
  if (existingNPI) {
    throw new ValidationError('User with this NPI already exists');
  }

  // Create new user
  const user = await User.create({
    email,
    password,
    firstName,
    lastName,
    npi,
    licenseNumber,
    specialty,
    phone,
    address,
    role: 'provider',
    hipaaTrainingCompleted: false // Will need to complete training
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'USER_REGISTRATION',
    eventType: 'create',
    severity: 'medium',
    status: 'success',
    resource: '/api/auth/register',
    resourceType: 'user',
    details: {
      email: user.email,
      npi: user.npi,
      specialty: user.specialty
    },
    context: 'User registration'
  });

  res.status(201).json({
    message: 'User registered successfully',
    user: user.toJSON(),
    requiresHIPAATraining: true
  });
}));

// Login
router.post('/login', validateLogin, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { email, password } = req.body;

  // Find user by email
  const user = await User.findByEmail(email);
  if (!user) {
    await createManualAuditEntry({
      userId: null,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'LOGIN_ATTEMPT',
      eventType: 'failed_login',
      severity: 'medium',
      status: 'failure',
      errorMessage: 'User not found',
      resource: '/api/auth/login',
      context: 'Login attempt'
    });

    throw new AuthenticationError('Invalid email or password');
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await createManualAuditEntry({
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'LOGIN_ATTEMPT',
      eventType: 'access_denied',
      severity: 'medium',
      status: 'failure',
      errorMessage: 'Account locked',
      resource: '/api/auth/login',
      context: 'Login attempt - account locked'
    });

    throw new AuthenticationError('Account is temporarily locked due to multiple failed login attempts');
  }

  // Validate password
  const isValidPassword = await user.validatePassword(password);
  if (!isValidPassword) {
    // Increment failed login attempts
    user.failedLoginAttempts += 1;
    
    // Lock account after 5 failed attempts
    if (user.failedLoginAttempts >= 5) {
      user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    }
    
    await user.save();

    await createManualAuditEntry({
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'LOGIN_ATTEMPT',
      eventType: 'failed_login',
      severity: 'medium',
      status: 'failure',
      errorMessage: 'Invalid password',
      resource: '/api/auth/login',
      context: 'Login attempt - invalid password'
    });

    throw new AuthenticationError('Invalid email or password');
  }

  // Check if user is active
  if (!user.isActive) {
    await createManualAuditEntry({
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'LOGIN_ATTEMPT',
      eventType: 'access_denied',
      severity: 'high',
      status: 'failure',
      errorMessage: 'Account inactive',
      resource: '/api/auth/login',
      context: 'Login attempt - inactive account'
    });

    throw new AuthenticationError('Account is inactive');
  }

  // Reset failed login attempts
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLogin = new Date();
  await user.save();

  // Generate JWT token
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000)
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  // Create audit entry for successful login
  await createManualAuditEntry({
    userId: user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'LOGIN_SUCCESS',
    eventType: 'login',
    severity: 'medium',
    status: 'success',
    resource: '/api/auth/login',
    context: 'Successful login'
  });

  res.json({
    message: 'Login successful',
    token,
    user: user.toJSON(),
    requiresHIPAATraining: !user.hipaaTrainingCompleted
  });
}));

// Logout
router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (token && req.user) {
    await createManualAuditEntry({
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'LOGOUT',
      eventType: 'logout',
      severity: 'low',
      status: 'success',
      resource: '/api/auth/logout',
      context: 'User logout'
    });
  }

  res.json({
    message: 'Logout successful'
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AuthenticationError('Refresh token is required');
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findByPk(decoded.userId);

    if (!user || !user.isActive) {
      throw new AuthenticationError('Invalid refresh token');
    }

    // Generate new access token
    const newToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      message: 'Token refreshed successfully',
      token: newToken
    });
  } catch (error) {
    throw new AuthenticationError('Invalid refresh token');
  }
}));

// Change password
router.post('/change-password', asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!req.user) {
    throw new AuthenticationError('Authentication required');
  }

  // Validate current password
  const isValidPassword = await req.user.validatePassword(currentPassword);
  if (!isValidPassword) {
    throw new AuthenticationError('Current password is incorrect');
  }

  // Validate new password
  if (newPassword.length < parseInt(process.env.PASSWORD_MIN_LENGTH) || 12) {
    throw new ValidationError('New password does not meet requirements');
  }

  // Update password
  req.user.password = newPassword;
  await req.user.save();

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PASSWORD_CHANGE',
    eventType: 'password_change',
    severity: 'medium',
    status: 'success',
    resource: '/api/auth/change-password',
    context: 'Password change'
  });

  res.json({
    message: 'Password changed successfully'
  });
}));

// Complete HIPAA training
router.post('/complete-hipaa-training', asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AuthenticationError('Authentication required');
  }

  req.user.hipaaTrainingCompleted = true;
  req.user.hipaaTrainingDate = new Date();
  await req.user.save();

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'HIPAA_TRAINING_COMPLETED',
    eventType: 'update',
    severity: 'medium',
    status: 'success',
    resource: '/api/auth/complete-hipaa-training',
    resourceType: 'user',
    context: 'HIPAA training completion'
  });

  res.json({
    message: 'HIPAA training completed successfully',
    user: req.user.toJSON()
  });
}));

// Get current user profile
router.get('/profile', asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AuthenticationError('Authentication required');
  }

  res.json({
    user: req.user.toJSON()
  });
}));

// Update user profile
router.put('/profile', asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AuthenticationError('Authentication required');
  }

  const allowedFields = ['firstName', 'lastName', 'phone', 'address', 'specialty'];
  const updates = {};

  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  await req.user.update(updates);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PROFILE_UPDATE',
    eventType: 'update',
    severity: 'low',
    status: 'success',
    resource: '/api/auth/profile',
    resourceType: 'user',
    newValues: updates,
    context: 'Profile update'
  });

  res.json({
    message: 'Profile updated successfully',
    user: req.user.toJSON()
  });
}));

module.exports = router;