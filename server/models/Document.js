const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Document = sequelize.define('Document', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  patientId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'patients',
      key: 'id'
    }
  },
  uploadedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  documentType: {
    type: DataTypes.ENUM(
      'lab_result',
      'medical_record',
      'prescription',
      'imaging',
      'consent_form',
      'insurance_document',
      'referral',
      'other'
    ),
    allowNull: false
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // Document metadata
  title: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  dateOfService: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  orderingProvider: {
    type: DataTypes.STRING,
    allowNull: true
  },
  labFacility: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Processing status
  processingStatus: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    defaultValue: 'pending'
  },
  processingError: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Extracted data from lab results
  extractedData: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // Lab results specific fields
  labResults: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // Security and access control
  isEncrypted: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  accessLevel: {
    type: DataTypes.ENUM('public', 'restricted', 'confidential'),
    defaultValue: 'restricted'
  },
  // HIPAA compliance
  retentionPeriod: {
    type: DataTypes.INTEGER, // in days
    allowNull: true
  },
  retentionDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Status
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  isArchived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // Tags and categorization
  tags: {
    type: DataTypes.JSON,
    allowNull: true
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Version control
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  previousVersionId: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'documents',
  indexes: [
    {
      fields: ['patientId']
    },
    {
      fields: ['uploadedBy']
    },
    {
      fields: ['documentType']
    },
    {
      fields: ['dateOfService']
    },
    {
      fields: ['processingStatus']
    },
    {
      fields: ['isActive']
    }
  ]
});

// Instance methods
Document.prototype.getFileExtension = function() {
  return this.originalFileName.split('.').pop().toLowerCase();
};

Document.prototype.isImage = function() {
  const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'];
  return imageTypes.includes(this.getFileExtension());
};

Document.prototype.isPDF = function() {
  return this.getFileExtension() === 'pdf';
};

Document.prototype.isSpreadsheet = function() {
  const spreadsheetTypes = ['xlsx', 'xls', 'csv'];
  return spreadsheetTypes.includes(this.getFileExtension());
};

Document.prototype.getFileSizeInMB = function() {
  return (this.fileSize / (1024 * 1024)).toFixed(2);
};

Document.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  // Add computed properties
  values.fileExtension = this.getFileExtension();
  values.isImage = this.isImage();
  values.isPDF = this.isPDF();
  values.isSpreadsheet = this.isSpreadsheet();
  values.fileSizeInMB = this.getFileSizeInMB();
  return values;
};

// Class methods
Document.findByPatient = function(patientId) {
  return this.findAll({
    where: { 
      patientId,
      isActive: true 
    },
    order: [['createdAt', 'DESC']]
  });
};

Document.findByType = function(documentType) {
  return this.findAll({
    where: { 
      documentType,
      isActive: true 
    },
    order: [['createdAt', 'DESC']]
  });
};

Document.findLabResults = function(patientId) {
  return this.findAll({
    where: { 
      patientId,
      documentType: 'lab_result',
      isActive: true 
    },
    order: [['dateOfService', 'DESC']]
  });
};

module.exports = Document;