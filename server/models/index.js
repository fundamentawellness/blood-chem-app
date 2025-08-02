const User = require('./User');
const Patient = require('./Patient');
const Document = require('./Document');
const Audit = require('./Audit');

// User associations
User.hasMany(Patient, {
  foreignKey: 'primaryProviderId',
  as: 'patients'
});

User.hasMany(Document, {
  foreignKey: 'uploadedBy',
  as: 'uploadedDocuments'
});

User.hasMany(Audit, {
  foreignKey: 'userId',
  as: 'auditLogs'
});

// Patient associations
Patient.belongsTo(User, {
  foreignKey: 'primaryProviderId',
  as: 'primaryProvider'
});

Patient.hasMany(Document, {
  foreignKey: 'patientId',
  as: 'documents'
});

Patient.hasMany(Audit, {
  foreignKey: 'resourceId',
  constraints: false,
  scope: {
    resourceType: 'patient'
  },
  as: 'auditLogs'
});

// Document associations
Document.belongsTo(User, {
  foreignKey: 'uploadedBy',
  as: 'uploadedByUser'
});

Document.belongsTo(Patient, {
  foreignKey: 'patientId',
  as: 'patient'
});

Document.hasMany(Audit, {
  foreignKey: 'resourceId',
  constraints: false,
  scope: {
    resourceType: 'document'
  },
  as: 'auditLogs'
});

// Audit associations
Audit.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// Export all models
module.exports = {
  User,
  Patient,
  Document,
  Audit
};