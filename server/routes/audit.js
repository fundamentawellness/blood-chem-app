const express = require('express');
const { query, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const Audit = require('../models/Audit');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { requireRole, requireDataAccessLevel } = require('../middleware/auth');

const router = express.Router();

// Only admins and users with full access can view audit logs
router.use(requireRole(['admin']));
router.use(requireDataAccessLevel('full'));

// Validation middleware
const validateAuditQuery = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('userId').optional().isUUID(),
  query('eventType').optional().isIn([
    'create', 'read', 'update', 'delete', 'login', 'logout', 'failed_login',
    'password_change', 'data_export', 'data_import', 'file_upload', 'file_download',
    'report_generation', 'access_denied', 'system_error'
  ]),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('status').optional().isIn(['success', 'failure', 'warning']),
  query('resourceType').optional().isIn(['user', 'patient', 'document', 'report', 'auth', 'system']),
  query('phiAccessed').optional().isBoolean()
];

// Get audit logs
router.get('/', validateAuditQuery, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const {
    page = 1,
    limit = 50,
    startDate,
    endDate,
    userId,
    eventType,
    severity,
    status,
    resourceType,
    phiAccessed,
    search
  } = req.query;

  const offset = (page - 1) * limit;
  const whereClause = {};

  // Date range filter
  if (startDate || endDate) {
    whereClause.timestamp = {};
    if (startDate) {
      whereClause.timestamp[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      whereClause.timestamp[Op.lte] = new Date(endDate);
    }
  }

  // User filter
  if (userId) {
    whereClause.userId = userId;
  }

  // Event type filter
  if (eventType) {
    whereClause.eventType = eventType;
  }

  // Severity filter
  if (severity) {
    whereClause.severity = severity;
  }

  // Status filter
  if (status) {
    whereClause.status = status;
  }

  // Resource type filter
  if (resourceType) {
    whereClause.resourceType = resourceType;
  }

  // PHI access filter
  if (phiAccessed !== undefined) {
    whereClause.phiAccessed = phiAccessed === 'true';
  }

  // Search filter
  if (search) {
    whereClause[Op.or] = [
      { action: { [Op.iLike]: `%${search}%` } },
      { resource: { [Op.iLike]: `%${search}%` } },
      { errorMessage: { [Op.iLike]: `%${search}%` } },
      { context: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const auditLogs = await Audit.findAndCountAll({
    where: whereClause,
    order: [['timestamp', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.json({
    auditLogs: auditLogs.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: auditLogs.count,
      totalPages: Math.ceil(auditLogs.count / limit)
    }
  });
}));

// Get audit log by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const auditLog = await Audit.findByPk(id);
  if (!auditLog) {
    throw new ValidationError('Audit log not found');
  }

  res.json({
    auditLog
  });
}));

// Get PHI access logs
router.get('/phi-access', validateAuditQuery, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const {
    page = 1,
    limit = 50,
    startDate,
    endDate,
    userId
  } = req.query;

  const offset = (page - 1) * limit;
  const whereClause = {
    phiAccessed: true
  };

  // Date range filter
  if (startDate || endDate) {
    whereClause.timestamp = {};
    if (startDate) {
      whereClause.timestamp[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      whereClause.timestamp[Op.lte] = new Date(endDate);
    }
  }

  // User filter
  if (userId) {
    whereClause.userId = userId;
  }

  const phiAccessLogs = await Audit.findAndCountAll({
    where: whereClause,
    order: [['timestamp', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.json({
    phiAccessLogs: phiAccessLogs.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: phiAccessLogs.count,
      totalPages: Math.ceil(phiAccessLogs.count / limit)
    }
  });
}));

// Get security events
router.get('/security-events', validateAuditQuery, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const {
    page = 1,
    limit = 50,
    startDate,
    endDate,
    userId
  } = req.query;

  const offset = (page - 1) * limit;
  const whereClause = {
    eventType: {
      [Op.in]: ['login', 'logout', 'failed_login', 'password_change', 'access_denied']
    }
  };

  // Date range filter
  if (startDate || endDate) {
    whereClause.timestamp = {};
    if (startDate) {
      whereClause.timestamp[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      whereClause.timestamp[Op.lte] = new Date(endDate);
    }
  }

  // User filter
  if (userId) {
    whereClause.userId = userId;
  }

  const securityEvents = await Audit.findAndCountAll({
    where: whereClause,
    order: [['timestamp', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.json({
    securityEvents: securityEvents.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: securityEvents.count,
      totalPages: Math.ceil(securityEvents.count / limit)
    }
  });
}));

// Get audit statistics
router.get('/stats/overview', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const whereClause = {};
  if (startDate || endDate) {
    whereClause.timestamp = {};
    if (startDate) {
      whereClause.timestamp[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      whereClause.timestamp[Op.lte] = new Date(endDate);
    }
  }

  // Total audit entries
  const totalEntries = await Audit.count({ where: whereClause });

  // PHI access count
  const phiAccessCount = await Audit.count({
    where: {
      ...whereClause,
      phiAccessed: true
    }
  });

  // Security events count
  const securityEventsCount = await Audit.count({
    where: {
      ...whereClause,
      eventType: {
        [Op.in]: ['login', 'logout', 'failed_login', 'password_change', 'access_denied']
      }
    }
  });

  // Failed login attempts
  const failedLoginsCount = await Audit.count({
    where: {
      ...whereClause,
      eventType: 'failed_login'
    }
  });

  // Events by type
  const eventsByType = await Audit.findAll({
    where: whereClause,
    attributes: [
      'eventType',
      [Audit.sequelize.fn('COUNT', Audit.sequelize.col('id')), 'count']
    ],
    group: ['eventType'],
    order: [[Audit.sequelize.fn('COUNT', Audit.sequelize.col('id')), 'DESC']]
  });

  // Events by severity
  const eventsBySeverity = await Audit.findAll({
    where: whereClause,
    attributes: [
      'severity',
      [Audit.sequelize.fn('COUNT', Audit.sequelize.col('id')), 'count']
    ],
    group: ['severity']
  });

  // Recent activity (last 24 hours)
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentActivity = await Audit.count({
    where: {
      ...whereClause,
      timestamp: {
        [Op.gte]: last24Hours
      }
    }
  });

  res.json({
    totalEntries,
    phiAccessCount,
    securityEventsCount,
    failedLoginsCount,
    recentActivity,
    eventsByType: eventsByType.reduce((acc, item) => {
      acc[item.eventType] = parseInt(item.dataValues.count);
      return acc;
    }, {}),
    eventsBySeverity: eventsBySeverity.reduce((acc, item) => {
      acc[item.severity] = parseInt(item.dataValues.count);
      return acc;
    }, {})
  });
}));

// Get user activity summary
router.get('/user/:userId/activity', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { startDate, endDate } = req.query;

  const whereClause = { userId };

  if (startDate || endDate) {
    whereClause.timestamp = {};
    if (startDate) {
      whereClause.timestamp[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      whereClause.timestamp[Op.lte] = new Date(endDate);
    }
  }

  // Get user's audit entries
  const userActivity = await Audit.findAll({
    where: whereClause,
    order: [['timestamp', 'DESC']],
    limit: 100
  });

  // Get activity summary
  const activitySummary = await Audit.findAll({
    where: whereClause,
    attributes: [
      'eventType',
      [Audit.sequelize.fn('COUNT', Audit.sequelize.col('id')), 'count']
    ],
    group: ['eventType']
  });

  // Get PHI access summary
  const phiAccessSummary = await Audit.count({
    where: {
      ...whereClause,
      phiAccessed: true
    }
  });

  // Get failed login attempts
  const failedLogins = await Audit.count({
    where: {
      ...whereClause,
      eventType: 'failed_login'
    }
  });

  res.json({
    userId,
    activity: userActivity,
    summary: {
      totalActivity: userActivity.length,
      phiAccessCount: phiAccessSummary,
      failedLogins,
      activityByType: activitySummary.reduce((acc, item) => {
        acc[item.eventType] = parseInt(item.dataValues.count);
        return acc;
      }, {})
    }
  });
}));

// Export audit logs (for compliance purposes)
router.get('/export/csv', validateAuditQuery, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const {
    startDate,
    endDate,
    userId,
    eventType,
    severity,
    status,
    resourceType,
    phiAccessed
  } = req.query;

  const whereClause = {};

  // Apply filters
  if (startDate || endDate) {
    whereClause.timestamp = {};
    if (startDate) {
      whereClause.timestamp[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      whereClause.timestamp[Op.lte] = new Date(endDate);
    }
  }

  if (userId) whereClause.userId = userId;
  if (eventType) whereClause.eventType = eventType;
  if (severity) whereClause.severity = severity;
  if (status) whereClause.status = status;
  if (resourceType) whereClause.resourceType = resourceType;
  if (phiAccessed !== undefined) whereClause.phiAccessed = phiAccessed === 'true';

  const auditLogs = await Audit.findAll({
    where: whereClause,
    order: [['timestamp', 'DESC']]
  });

  // Create CSV content
  const csvHeaders = [
    'Timestamp',
    'User ID',
    'IP Address',
    'Action',
    'Resource',
    'Event Type',
    'Severity',
    'Status',
    'PHI Accessed',
    'Error Message',
    'Context'
  ];

  const csvRows = auditLogs.map(log => [
    log.timestamp,
    log.userId,
    log.ipAddress,
    log.action,
    log.resource,
    log.eventType,
    log.severity,
    log.status,
    log.phiAccessed,
    log.errorMessage,
    log.context
  ]);

  const csvContent = [csvHeaders, ...csvRows]
    .map(row => row.map(field => `"${field || ''}"`).join(','))
    .join('\n');

  // Set response headers for CSV download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.csv"`);

  res.send(csvContent);
}));

module.exports = router;