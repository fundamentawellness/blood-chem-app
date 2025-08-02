const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Audit = sequelize.define('Audit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  sessionId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: true
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  resource: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  resourceType: {
    type: DataTypes.ENUM(
      'user',
      'patient',
      'document',
      'report',
      'auth',
      'system'
    ),
    allowNull: true
  },
  eventType: {
    type: DataTypes.ENUM(
      'create',
      'read',
      'update',
      'delete',
      'login',
      'logout',
      'failed_login',
      'password_change',
      'data_export',
      'data_import',
      'file_upload',
      'file_download',
      'report_generation',
      'access_denied',
      'system_error'
    ),
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    defaultValue: 'low'
  },
  status: {
    type: DataTypes.ENUM('success', 'failure', 'warning'),
    defaultValue: 'success'
  },
  details: {
    type: DataTypes.JSON,
    allowNull: true
  },
  oldValues: {
    type: DataTypes.JSON,
    allowNull: true
  },
  newValues: {
    type: DataTypes.JSON,
    allowNull: true
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // HIPAA specific fields
  phiAccessed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  phiFields: {
    type: DataTypes.JSON,
    allowNull: true
  },
  purpose: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Location and context
  location: {
    type: DataTypes.STRING,
    allowNull: true
  },
  context: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Timestamps
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  duration: {
    type: DataTypes.INTEGER, // in milliseconds
    allowNull: true
  }
}, {
  tableName: 'audit_logs',
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['timestamp']
    },
    {
      fields: ['action']
    },
    {
      fields: ['eventType']
    },
    {
      fields: ['resourceType']
    },
    {
      fields: ['severity']
    },
    {
      fields: ['phiAccessed']
    },
    {
      fields: ['ipAddress']
    }
  ],
  timestamps: false // We use our own timestamp field
});

// Instance methods
Audit.prototype.isPHIAccess = function() {
  return this.phiAccessed || this.resourceType === 'patient';
};

Audit.prototype.isSecurityEvent = function() {
  const securityEvents = [
    'login',
    'logout',
    'failed_login',
    'password_change',
    'access_denied'
  ];
  return securityEvents.includes(this.eventType);
};

Audit.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  values.isPHIAccess = this.isPHIAccess();
  values.isSecurityEvent = this.isSecurityEvent();
  return values;
};

// Class methods
Audit.findByUser = function(userId, limit = 100) {
  return this.findAll({
    where: { userId },
    order: [['timestamp', 'DESC']],
    limit
  });
};

Audit.findPHIAccess = function(startDate, endDate) {
  return this.findAll({
    where: {
      phiAccessed: true,
      timestamp: {
        [sequelize.Op.between]: [startDate, endDate]
      }
    },
    order: [['timestamp', 'DESC']]
  });
};

Audit.findSecurityEvents = function(startDate, endDate) {
  return this.findAll({
    where: {
      eventType: {
        [sequelize.Op.in]: ['login', 'logout', 'failed_login', 'password_change', 'access_denied']
      },
      timestamp: {
        [sequelize.Op.between]: [startDate, endDate]
      }
    },
    order: [['timestamp', 'DESC']]
  });
};

Audit.findFailedLogins = function(userId, hours = 24) {
  const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
  return this.findAll({
    where: {
      userId,
      eventType: 'failed_login',
      timestamp: {
        [sequelize.Op.gte]: cutoffTime
      }
    },
    order: [['timestamp', 'DESC']]
  });
};

// Static method to create audit entry
Audit.createEntry = function(data) {
  return this.create({
    ...data,
    timestamp: new Date()
  });
};

module.exports = Audit;