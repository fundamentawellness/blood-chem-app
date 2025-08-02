const Audit = require('../models/Audit');

// Audit logging middleware
const auditLogger = async (req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;

  // Override res.send to capture response data
  res.send = function(data) {
    const duration = Date.now() - startTime;
    
    // Create audit entry asynchronously (don't block response)
    createAuditEntry(req, res, duration, data).catch(err => {
      console.error('Audit logging error:', err);
    });

    // Call original send method
    return originalSend.call(this, data);
  };

  next();
};

// Create audit entry
const createAuditEntry = async (req, res, duration, responseData) => {
  try {
    // Skip audit for certain endpoints
    const skipAuditEndpoints = [
      '/api/health',
      '/api/auth/login',
      '/api/auth/refresh',
      '/favicon.ico'
    ];

    if (skipAuditEndpoints.some(endpoint => req.originalUrl.includes(endpoint))) {
      return;
    }

    // Determine event type based on HTTP method and URL
    const eventType = determineEventType(req.method, req.originalUrl);
    
    // Determine severity based on endpoint and method
    const severity = determineSeverity(req.method, req.originalUrl, res.statusCode);
    
    // Determine if PHI is being accessed
    const phiAccessed = isPHIAccess(req.originalUrl, req.method);
    
    // Determine resource type
    const resourceType = determineResourceType(req.originalUrl);
    
    // Determine status
    const status = res.statusCode >= 400 ? 'failure' : 'success';

    const auditData = {
      userId: req.user?.id || null,
      sessionId: req.sessionID,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      action: `${req.method} ${req.originalUrl}`,
      resource: req.originalUrl,
      resourceId: extractResourceId(req.originalUrl),
      resourceType,
      eventType,
      severity,
      status,
      details: {
        method: req.method,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        referer: req.get('Referer')
      },
      phiAccessed,
      phiFields: phiAccessed ? extractPHIFields(req.body, req.query) : null,
      purpose: extractPurpose(req.originalUrl, req.method),
      location: req.get('X-Forwarded-For') || req.ip,
      context: req.get('X-Request-Context') || 'API Request',
      duration
    };

    // Add error details if response indicates failure
    if (res.statusCode >= 400) {
      try {
        const responseObj = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
        auditData.errorMessage = responseObj.message || responseObj.error || 'Request failed';
      } catch (e) {
        auditData.errorMessage = 'Request failed';
      }
    }

    // Add request body for certain operations (be careful with sensitive data)
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      auditData.newValues = sanitizeRequestBody(req.body);
    }

    await Audit.createEntry(auditData);

  } catch (error) {
    console.error('Error creating audit entry:', error);
  }
};

// Determine event type based on HTTP method and URL
const determineEventType = (method, url) => {
  if (url.includes('/auth/login')) return 'login';
  if (url.includes('/auth/logout')) return 'logout';
  if (url.includes('/auth/refresh')) return 'login';
  
  switch (method) {
    case 'GET':
      return 'read';
    case 'POST':
      if (url.includes('/upload')) return 'file_upload';
      if (url.includes('/export')) return 'data_export';
      if (url.includes('/report')) return 'report_generation';
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
};

// Determine severity level
const determineSeverity = (method, url, statusCode) => {
  // High severity for authentication failures
  if (statusCode === 401 || statusCode === 403) return 'high';
  
  // High severity for patient data access
  if (url.includes('/patients') || url.includes('/documents')) return 'high';
  
  // Medium severity for user management
  if (url.includes('/users') || url.includes('/auth')) return 'medium';
  
  // Low severity for general operations
  return 'low';
};

// Check if PHI is being accessed
const isPHIAccess = (url, method) => {
  const phiEndpoints = [
    '/patients',
    '/documents',
    '/reports',
    '/lab-results'
  ];
  
  return phiEndpoints.some(endpoint => url.includes(endpoint));
};

// Determine resource type
const determineResourceType = (url) => {
  if (url.includes('/patients')) return 'patient';
  if (url.includes('/documents')) return 'document';
  if (url.includes('/users')) return 'user';
  if (url.includes('/reports')) return 'report';
  if (url.includes('/auth')) return 'auth';
  return 'system';
};

// Extract resource ID from URL
const extractResourceId = (url) => {
  const match = url.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  return match ? match[1] : null;
};

// Extract PHI fields from request
const extractPHIFields = (body, query) => {
  const phiFields = [];
  
  if (body) {
    if (body.firstName || body.lastName) phiFields.push('name');
    if (body.dateOfBirth) phiFields.push('dateOfBirth');
    if (body.ssn) phiFields.push('ssn');
    if (body.phone) phiFields.push('phone');
    if (body.email) phiFields.push('email');
    if (body.address) phiFields.push('address');
    if (body.medicalHistory) phiFields.push('medicalHistory');
  }
  
  if (query) {
    if (query.name) phiFields.push('name');
    if (query.dob) phiFields.push('dateOfBirth');
  }
  
  return phiFields.length > 0 ? phiFields : null;
};

// Extract purpose from URL and method
const extractPurpose = (url, method) => {
  if (url.includes('/patients')) return 'patient_care';
  if (url.includes('/documents')) return 'medical_records';
  if (url.includes('/reports')) return 'healthcare_operations';
  if (url.includes('/auth')) return 'authentication';
  return 'general_operations';
};

// Sanitize request body for audit logging
const sanitizeRequestBody = (body) => {
  const sanitized = { ...body };
  
  // Remove sensitive fields
  const sensitiveFields = ['password', 'ssn', 'creditCard', 'cvv'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
};

// Manual audit entry creation
const createManualAuditEntry = async (data) => {
  try {
    await Audit.createEntry(data);
  } catch (error) {
    console.error('Error creating manual audit entry:', error);
  }
};

// Batch audit entry creation
const createBatchAuditEntries = async (entries) => {
  try {
    await Audit.bulkCreate(entries.map(entry => ({
      ...entry,
      timestamp: new Date()
    })));
  } catch (error) {
    console.error('Error creating batch audit entries:', error);
  }
};

module.exports = {
  auditLogger,
  createManualAuditEntry,
  createBatchAuditEntries
};