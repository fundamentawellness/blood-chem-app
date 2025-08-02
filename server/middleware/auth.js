const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Audit = require('../models/Audit');

// JWT token verification middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      await Audit.createEntry({
        userId: null,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'API_ACCESS',
        eventType: 'access_denied',
        severity: 'high',
        status: 'failure',
        errorMessage: 'No token provided',
        resource: req.originalUrl,
        context: 'Authentication middleware'
      });

      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication token is required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists and is active
    const user = await User.findByPk(decoded.userId);
    if (!user || !user.isActive) {
      await Audit.createEntry({
        userId: decoded.userId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'API_ACCESS',
        eventType: 'access_denied',
        severity: 'high',
        status: 'failure',
        errorMessage: 'User not found or inactive',
        resource: req.originalUrl,
        context: 'Authentication middleware'
      });

      return res.status(401).json({
        error: 'Access denied',
        message: 'User account is inactive or not found'
      });
    }

    // Check if password was changed after token was issued
    if (user.passwordChangedAt && decoded.iat < user.passwordChangedAt.getTime() / 1000) {
      await Audit.createEntry({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'API_ACCESS',
        eventType: 'access_denied',
        severity: 'medium',
        status: 'failure',
        errorMessage: 'Token issued before password change',
        resource: req.originalUrl,
        context: 'Authentication middleware'
      });

      return res.status(401).json({
        error: 'Access denied',
        message: 'Password was changed, please login again'
      });
    }

    // Add user to request object
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      await Audit.createEntry({
        userId: null,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'API_ACCESS',
        eventType: 'access_denied',
        severity: 'medium',
        status: 'failure',
        errorMessage: 'Token expired',
        resource: req.originalUrl,
        context: 'Authentication middleware'
      });

      return res.status(401).json({
        error: 'Access denied',
        message: 'Token has expired'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      await Audit.createEntry({
        userId: null,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'API_ACCESS',
        eventType: 'access_denied',
        severity: 'high',
        status: 'failure',
        errorMessage: 'Invalid token',
        resource: req.originalUrl,
        context: 'Authentication middleware'
      });

      return res.status(401).json({
        error: 'Access denied',
        message: 'Invalid token'
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
};

// Role-based access control middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      Audit.createEntry({
        userId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'ROLE_ACCESS',
        eventType: 'access_denied',
        severity: 'medium',
        status: 'failure',
        errorMessage: `Insufficient role. Required: ${roles.join(', ')}, User: ${req.user.role}`,
        resource: req.originalUrl,
        context: 'Role-based access control'
      });

      return res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// HIPAA compliance middleware - check if user has completed training
const requireHIPAATraining = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'Authentication required'
    });
  }

  if (!req.user.hipaaTrainingCompleted) {
    await Audit.createEntry({
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'HIPAA_ACCESS',
      eventType: 'access_denied',
      severity: 'high',
      status: 'failure',
      errorMessage: 'HIPAA training not completed',
      resource: req.originalUrl,
      context: 'HIPAA compliance check'
    });

    return res.status(403).json({
      error: 'Access denied',
      message: 'HIPAA training must be completed before accessing patient data'
    });
  }

  next();
};

// Data access level middleware
const requireDataAccessLevel = (requiredLevel) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required'
      });
    }

    const accessLevels = {
      'readonly': 1,
      'limited': 2,
      'full': 3
    };

    const userLevel = accessLevels[req.user.dataAccessLevel] || 0;
    const requiredLevelNum = accessLevels[requiredLevel] || 0;

    if (userLevel < requiredLevelNum) {
      Audit.createEntry({
        userId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        action: 'DATA_ACCESS',
        eventType: 'access_denied',
        severity: 'medium',
        status: 'failure',
        errorMessage: `Insufficient data access level. Required: ${requiredLevel}, User: ${req.user.dataAccessLevel}`,
        resource: req.originalUrl,
        context: 'Data access level check'
      });

      return res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient data access level'
      });
    }

    next();
  };
};

// Session timeout middleware
const checkSessionTimeout = (req, res, next) => {
  if (!req.user) {
    return next();
  }

  const sessionTimeout = parseInt(process.env.AUTO_LOGOUT_MINUTES) * 60 * 1000; // Convert to milliseconds
  const lastActivity = req.session.lastActivity || 0;
  const currentTime = Date.now();

  if (currentTime - lastActivity > sessionTimeout) {
    // Session expired
    req.session.destroy();
    
    Audit.createEntry({
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      action: 'SESSION_TIMEOUT',
      eventType: 'logout',
      severity: 'low',
      status: 'success',
      resource: req.originalUrl,
      context: 'Session timeout'
    });

    return res.status(401).json({
      error: 'Session expired',
      message: 'Your session has expired. Please login again.'
    });
  }

  // Update last activity
  req.session.lastActivity = currentTime;
  next();
};

module.exports = {
  authenticateToken,
  requireRole,
  requireHIPAATraining,
  requireDataAccessLevel,
  checkSessionTimeout
};