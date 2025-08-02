const { createManualAuditEntry } = require('./audit');

// Global error handler middleware
const errorHandler = async (err, req, res, next) => {
  // Log error details
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Create audit entry for the error
  await createManualAuditEntry({
    userId: req.user?.id || null,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: `${req.method} ${req.originalUrl}`,
    resource: req.originalUrl,
    eventType: 'system_error',
    severity: 'high',
    status: 'failure',
    errorMessage: err.message,
    details: {
      method: req.method,
      url: req.originalUrl,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    },
    context: 'Error handler middleware'
  });

  // Handle different types of errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.errors
    });
  }

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Database Validation Error',
      message: 'Invalid data provided',
      details: err.errors.map(e => ({
        field: e.path,
        message: e.message
      }))
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: 'Duplicate Entry',
      message: 'A record with this information already exists',
      details: err.errors.map(e => ({
        field: e.path,
        message: e.message
      }))
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: 'Reference Error',
      message: 'Referenced record does not exist',
      details: {
        table: err.table,
        field: err.fields
      }
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Invalid or expired token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Authentication Error',
      message: 'Token has expired'
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      error: 'File Upload Error',
      message: err.message
    });
  }

  // Handle file system errors
  if (err.code === 'ENOENT') {
    return res.status(404).json({
      error: 'File Not Found',
      message: 'The requested file could not be found'
    });
  }

  if (err.code === 'EACCES') {
    return res.status(403).json({
      error: 'Permission Denied',
      message: 'Access to the requested resource is denied'
    });
  }

  // Handle network errors
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Database connection failed'
    });
  }

  // Handle timeout errors
  if (err.code === 'ETIMEDOUT') {
    return res.status(408).json({
      error: 'Request Timeout',
      message: 'The request timed out'
    });
  }

  // Default error response
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Don't expose internal errors in production
  const response = {
    error: 'Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : message
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Validation error class
class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

// Authentication error class
class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
  }
}

// Authorization error class
class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
  }
}

// Not found error class
class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

// Conflict error class
class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

module.exports = {
  errorHandler,
  asyncHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError
};