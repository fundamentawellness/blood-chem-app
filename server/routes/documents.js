const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const Document = require('../models/Document');
const Patient = require('../models/Patient');
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { requireHIPAATraining, requireDataAccessLevel } = require('../middleware/auth');
const { createManualAuditEntry } = require('../middleware/audit');

const router = express.Router();

// Apply HIPAA training requirement to all document routes
router.use(requireHIPAATraining);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    const patientId = req.body.patientId;
    const patientPath = path.join(uploadPath, patientId);
    
    try {
      await fs.mkdir(patientPath, { recursive: true });
      cb(null, patientPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}_${originalName}`;
    cb(null, fileName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,xlsx,xls,jpg,jpeg,png').split(',');
  const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);
  
  if (allowedTypes.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new ValidationError(`File type .${fileExtension} is not allowed`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
  }
});

// Validation middleware
const validateDocument = [
  body('patientId').isUUID(),
  body('documentType').isIn([
    'lab_result',
    'medical_record',
    'prescription',
    'imaging',
    'consent_form',
    'insurance_document',
    'referral',
    'other'
  ]),
  body('title').optional().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('dateOfService').optional().isISO8601().toDate(),
  body('orderingProvider').optional().trim().isLength({ max: 100 }),
  body('labFacility').optional().trim().isLength({ max: 100 }),
  body('tags').optional().isArray(),
  body('category').optional().trim().isLength({ max: 50 })
];

// Upload document
router.post('/upload', requireDataAccessLevel('limited'), upload.single('file'), validateDocument, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  if (!req.file) {
    throw new ValidationError('No file uploaded');
  }

  const {
    patientId,
    documentType,
    title,
    description,
    dateOfService,
    orderingProvider,
    labFacility,
    tags,
    category
  } = req.body;

  // Verify patient exists and belongs to the provider
  const patient = await Patient.findOne({
    where: {
      id: patientId,
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Create document record
  const document = await Document.create({
    patientId,
    uploadedBy: req.user.id,
    documentType,
    fileName: req.file.filename,
    originalFileName: req.file.originalname,
    filePath: req.file.path,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    title: title || req.file.originalname,
    description,
    dateOfService,
    orderingProvider,
    labFacility,
    tags: tags ? JSON.parse(tags) : [],
    category,
    processingStatus: 'pending'
  });

  // Process lab results if applicable
  if (documentType === 'lab_result' && req.file.mimetype.includes('spreadsheet')) {
    // Start background processing for lab results
    processLabResults(document.id).catch(err => {
      console.error('Error processing lab results:', err);
    });
  }

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_UPLOAD',
    eventType: 'file_upload',
    severity: 'high',
    status: 'success',
    resource: '/api/documents/upload',
    resourceType: 'document',
    resourceId: document.id,
    phiAccessed: true,
    phiFields: ['patientId', 'documentType'],
    details: {
      fileName: document.originalFileName,
      fileSize: document.fileSize,
      documentType,
      patientId
    },
    context: 'Document upload'
  });

  res.status(201).json({
    message: 'Document uploaded successfully',
    document: document.toJSON()
  });
}));

// Get documents for a patient
router.get('/patient/:patientId', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { documentType, page = 1, limit = 20 } = req.query;

  // Verify patient exists and belongs to the provider
  const patient = await Patient.findOne({
    where: {
      id: patientId,
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  const whereClause = {
    patientId,
    isActive: true
  };

  if (documentType) {
    whereClause.documentType = documentType;
  }

  const offset = (page - 1) * limit;

  const documents = await Document.findAndCountAll({
    where: whereClause,
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_LIST_ACCESS',
    eventType: 'read',
    severity: 'high',
    status: 'success',
    resource: `/api/documents/patient/${patientId}`,
    resourceType: 'document',
    phiAccessed: true,
    phiFields: ['patientId'],
    details: {
      patientId,
      documentType,
      count: documents.count
    },
    context: 'Document list access'
  });

  res.json({
    documents: documents.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: documents.count,
      totalPages: Math.ceil(documents.count / limit)
    }
  });
}));

// Get document by ID
router.get('/:id', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const document = await Document.findOne({
    where: { id, isActive: true },
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: ['id', 'firstName', 'lastName', 'mrn']
    }]
  });

  if (!document) {
    throw new NotFoundError('Document not found');
  }

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_VIEW',
    eventType: 'read',
    severity: 'high',
    status: 'success',
    resource: `/api/documents/${id}`,
    resourceType: 'document',
    resourceId: id,
    phiAccessed: true,
    phiFields: ['patientId', 'documentType'],
    context: 'Document view'
  });

  res.json({
    document: document.toJSON()
  });
}));

// Download document
router.get('/:id/download', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const document = await Document.findOne({
    where: { id, isActive: true },
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: ['id', 'firstName', 'lastName', 'mrn']
    }]
  });

  if (!document) {
    throw new NotFoundError('Document not found');
  }

  // Check if file exists
  try {
    await fs.access(document.filePath);
  } catch (error) {
    throw new NotFoundError('File not found on server');
  }

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_DOWNLOAD',
    eventType: 'file_download',
    severity: 'high',
    status: 'success',
    resource: `/api/documents/${id}/download`,
    resourceType: 'document',
    resourceId: id,
    phiAccessed: true,
    phiFields: ['patientId', 'documentType'],
    context: 'Document download'
  });

  res.download(document.filePath, document.originalFileName);
}));

// Update document metadata
router.put('/:id', requireDataAccessLevel('limited'), validateDocument, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { id } = req.params;

  const document = await Document.findOne({
    where: { id, isActive: true },
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: ['id']
    }]
  });

  if (!document) {
    throw new NotFoundError('Document not found');
  }

  const oldValues = document.toJSON();

  // Update document
  await document.update(req.body);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_UPDATE',
    eventType: 'update',
    severity: 'medium',
    status: 'success',
    resource: `/api/documents/${id}`,
    resourceType: 'document',
    resourceId: id,
    phiAccessed: true,
    oldValues,
    newValues: req.body,
    context: 'Document update'
  });

  res.json({
    message: 'Document updated successfully',
    document: document.toJSON()
  });
}));

// Delete document (soft delete)
router.delete('/:id', requireDataAccessLevel('full'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const document = await Document.findOne({
    where: { id, isActive: true },
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: ['id']
    }]
  });

  if (!document) {
    throw new NotFoundError('Document not found');
  }

  // Soft delete
  await document.update({
    isActive: false,
    isArchived: true
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_DELETE',
    eventType: 'delete',
    severity: 'high',
    status: 'success',
    resource: `/api/documents/${id}`,
    resourceType: 'document',
    resourceId: id,
    phiAccessed: true,
    oldValues: {
      isActive: true,
      isArchived: false
    },
    newValues: {
      isActive: false,
      isArchived: true
    },
    context: 'Document deletion'
  });

  res.json({
    message: 'Document deleted successfully'
  });
}));

// Get lab results for a patient
router.get('/patient/:patientId/lab-results', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  // Verify patient exists and belongs to the provider
  const patient = await Patient.findOne({
    where: {
      id: patientId,
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  const offset = (page - 1) * limit;

  const labResults = await Document.findAndCountAll({
    where: {
      patientId,
      documentType: 'lab_result',
      isActive: true
    },
    order: [['dateOfService', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'LAB_RESULTS_ACCESS',
    eventType: 'read',
    severity: 'high',
    status: 'success',
    resource: `/api/documents/patient/${patientId}/lab-results`,
    resourceType: 'document',
    phiAccessed: true,
    phiFields: ['patientId', 'labResults'],
    details: {
      patientId,
      count: labResults.count
    },
    context: 'Lab results access'
  });

  res.json({
    labResults: labResults.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: labResults.count,
      totalPages: Math.ceil(labResults.count / limit)
    }
  });
}));

// Get document statistics
router.get('/stats/overview', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const totalDocuments = await Document.count({
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: []
    }],
    where: { isActive: true }
  });

  const documentsByType = await Document.findAll({
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: []
    }],
    where: { isActive: true },
    attributes: [
      'documentType',
      [Document.sequelize.fn('COUNT', Document.sequelize.col('Document.id')), 'count']
    ],
    group: ['documentType']
  });

  const recentUploads = await Document.count({
    include: [{
      model: Patient,
      where: { primaryProviderId: req.user.id },
      attributes: []
    }],
    where: {
      isActive: true,
      createdAt: {
        [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      }
    }
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'DOCUMENT_STATS_ACCESS',
    eventType: 'read',
    severity: 'medium',
    status: 'success',
    resource: '/api/documents/stats/overview',
    resourceType: 'document',
    phiAccessed: false,
    details: {
      totalDocuments,
      recentUploads
    },
    context: 'Document statistics access'
  });

  res.json({
    totalDocuments,
    recentUploads,
    documentsByType: documentsByType.reduce((acc, item) => {
      acc[item.documentType] = parseInt(item.dataValues.count);
      return acc;
    }, {})
  });
}));

// Background function to process lab results
async function processLabResults(documentId) {
  try {
    const document = await Document.findByPk(documentId);
    if (!document) return;

    // Update status to processing
    await document.update({ processingStatus: 'processing' });

    // Here you would implement the actual lab result processing logic
    // This could involve:
    // 1. Reading the spreadsheet file
    // 2. Extracting lab values
    // 3. Parsing and structuring the data
    // 4. Storing in the labResults field

    // For now, we'll simulate processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Update with processed data
    await document.update({
      processingStatus: 'completed',
      labResults: {
        // Example structure for lab results
        processed: true,
        timestamp: new Date().toISOString(),
        // Add actual extracted lab data here
      }
    });

  } catch (error) {
    console.error('Error processing lab results:', error);
    await Document.update({
      processingStatus: 'failed',
      processingError: error.message
    }, { where: { id: documentId } });
  }
}

module.exports = router;