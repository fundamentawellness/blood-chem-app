const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { Op } = require('sequelize');
const Patient = require('../models/Patient');
const User = require('../models/User');
const { asyncHandler, ValidationError, NotFoundError, AuthorizationError } = require('../middleware/errorHandler');
const { requireHIPAATraining, requireDataAccessLevel } = require('../middleware/auth');
const { createManualAuditEntry } = require('../middleware/audit');

const router = express.Router();

// Apply HIPAA training requirement to all patient routes
router.use(requireHIPAATraining);

// Validation middleware
const validatePatient = [
  body('firstName').trim().isLength({ min: 1, max: 50 }),
  body('lastName').trim().isLength({ min: 1, max: 50 }),
  body('dateOfBirth').isISO8601().toDate(),
  body('gender').isIn(['male', 'female', 'other', 'prefer_not_to_say']),
  body('phone').matches(/^\+?[\d\s\-\(\)]+$/),
  body('address').trim().isLength({ min: 1 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('ssn').optional().matches(/^\d{3}-?\d{2}-?\d{4}$/),
  body('height').optional().isFloat({ min: 0 }),
  body('weight').optional().isFloat({ min: 0 }),
  body('bloodType').optional().isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  body('consentSigned').optional().isBoolean()
];

const validatePatientUpdate = [
  body('firstName').optional().trim().isLength({ min: 1, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 1, max: 50 }),
  body('dateOfBirth').optional().isISO8601().toDate(),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer_not_to_say']),
  body('phone').optional().matches(/^\+?[\d\s\-\(\)]+$/),
  body('address').optional().trim().isLength({ min: 1 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('ssn').optional().matches(/^\d{3}-?\d{2}-?\d{4}$/),
  body('height').optional().isFloat({ min: 0 }),
  body('weight').optional().isFloat({ min: 0 }),
  body('bloodType').optional().isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  body('consentSigned').optional().isBoolean()
];

// Generate MRN (Medical Record Number)
const generateMRN = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const mrn = `MRN${year}${month}${random}`;
  
  // Check if MRN already exists
  const existingPatient = await Patient.findByMRN(mrn);
  if (existingPatient) {
    return generateMRN(); // Recursive call if duplicate
  }
  
  return mrn;
};

// Get all patients for the authenticated provider
router.get('/', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    sortBy = 'lastName',
    sortOrder = 'ASC'
  } = req.query;

  const offset = (page - 1) * limit;
  const whereClause = {
    primaryProviderId: req.user.id,
    isActive: true
  };

  // Add search functionality
  if (search) {
    whereClause[Op.or] = [
      { firstName: { [Op.iLike]: `%${search}%` } },
      { lastName: { [Op.iLike]: `%${search}%` } },
      { mrn: { [Op.iLike]: `%${search}%` } }
    ];
  }

  // Add status filter
  if (status) {
    whereClause.status = status;
  }

  // Validate sort parameters
  const allowedSortFields = ['firstName', 'lastName', 'dateOfBirth', 'lastVisit', 'createdAt'];
  const allowedSortOrders = ['ASC', 'DESC'];
  
  const finalSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'lastName';
  const finalSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

  const patients = await Patient.findAndCountAll({
    where: whereClause,
    order: [[finalSortBy, finalSortOrder]],
    limit: parseInt(limit),
    offset: parseInt(offset),
    attributes: { exclude: ['ssn'] } // Exclude sensitive data from list
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_LIST_ACCESS',
    eventType: 'read',
    severity: 'high',
    status: 'success',
    resource: '/api/patients',
    resourceType: 'patient',
    phiAccessed: true,
    details: {
      search,
      status,
      page,
      limit,
      totalCount: patients.count
    },
    context: 'Patient list access'
  });

  res.json({
    patients: patients.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: patients.count,
      totalPages: Math.ceil(patients.count / limit)
    }
  });
}));

// Get patient by ID
router.get('/:id', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await Patient.findOne({
    where: {
      id,
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_VIEW',
    eventType: 'read',
    severity: 'high',
    status: 'success',
    resource: `/api/patients/${id}`,
    resourceType: 'patient',
    resourceId: id,
    phiAccessed: true,
    phiFields: ['name', 'dateOfBirth', 'medicalHistory', 'allergies', 'medications'],
    context: 'Patient detail view'
  });

  res.json({
    patient: patient.toJSON()
  });
}));

// Create new patient
router.post('/', requireDataAccessLevel('limited'), validatePatient, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const mrn = await generateMRN();
  
  const patientData = {
    ...req.body,
    mrn,
    primaryProviderId: req.user.id,
    consentSigned: req.body.consentSigned || false,
    consentDate: req.body.consentSigned ? new Date() : null
  };

  const patient = await Patient.create(patientData);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_CREATE',
    eventType: 'create',
    severity: 'high',
    status: 'success',
    resource: '/api/patients',
    resourceType: 'patient',
    resourceId: patient.id,
    phiAccessed: true,
    phiFields: ['name', 'dateOfBirth', 'ssn', 'phone', 'email', 'address'],
    newValues: {
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth
    },
    context: 'Patient creation'
  });

  res.status(201).json({
    message: 'Patient created successfully',
    patient: patient.toJSON()
  });
}));

// Update patient
router.put('/:id', requireDataAccessLevel('limited'), validatePatientUpdate, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { id } = req.params;

  const patient = await Patient.findOne({
    where: {
      id,
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Store old values for audit
  const oldValues = patient.toJSON();

  // Update patient
  await patient.update(req.body);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_UPDATE',
    eventType: 'update',
    severity: 'high',
    status: 'success',
    resource: `/api/patients/${id}`,
    resourceType: 'patient',
    resourceId: id,
    phiAccessed: true,
    phiFields: Object.keys(req.body),
    oldValues,
    newValues: req.body,
    context: 'Patient update'
  });

  res.json({
    message: 'Patient updated successfully',
    patient: patient.toJSON()
  });
}));

// Delete patient (soft delete)
router.delete('/:id', requireDataAccessLevel('full'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const patient = await Patient.findOne({
    where: {
      id,
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Soft delete - mark as inactive
  await patient.update({
    isActive: false,
    status: 'inactive'
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_DELETE',
    eventType: 'delete',
    severity: 'high',
    status: 'success',
    resource: `/api/patients/${id}`,
    resourceType: 'patient',
    resourceId: id,
    phiAccessed: true,
    phiFields: ['name', 'dateOfBirth'],
    oldValues: {
      isActive: true,
      status: patient.status
    },
    newValues: {
      isActive: false,
      status: 'inactive'
    },
    context: 'Patient deletion'
  });

  res.json({
    message: 'Patient deleted successfully'
  });
}));

// Get patient statistics
router.get('/stats/overview', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const totalPatients = await Patient.count({
    where: {
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  const activePatients = await Patient.count({
    where: {
      primaryProviderId: req.user.id,
      isActive: true,
      status: 'active'
    }
  });

  const newPatientsThisMonth = await Patient.count({
    where: {
      primaryProviderId: req.user.id,
      isActive: true,
      createdAt: {
        [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    }
  });

  const patientsByStatus = await Patient.findAll({
    where: {
      primaryProviderId: req.user.id,
      isActive: true
    },
    attributes: [
      'status',
      [Patient.sequelize.fn('COUNT', Patient.sequelize.col('id')), 'count']
    ],
    group: ['status']
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_STATS_ACCESS',
    eventType: 'read',
    severity: 'medium',
    status: 'success',
    resource: '/api/patients/stats/overview',
    resourceType: 'patient',
    phiAccessed: false,
    details: {
      totalPatients,
      activePatients,
      newPatientsThisMonth
    },
    context: 'Patient statistics access'
  });

  res.json({
    totalPatients,
    activePatients,
    newPatientsThisMonth,
    patientsByStatus: patientsByStatus.reduce((acc, item) => {
      acc[item.status] = parseInt(item.dataValues.count);
      return acc;
    }, {})
  });
}));

// Search patients
router.get('/search/advanced', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const {
    query: searchQuery,
    ageMin,
    ageMax,
    bloodType,
    status,
    hasAllergies,
    hasMedications,
    limit = 50
  } = req.query;

  const whereClause = {
    primaryProviderId: req.user.id,
    isActive: true
  };

  // Basic search
  if (searchQuery) {
    whereClause[Op.or] = [
      { firstName: { [Op.iLike]: `%${searchQuery}%` } },
      { lastName: { [Op.iLike]: `%${searchQuery}%` } },
      { mrn: { [Op.iLike]: `%${searchQuery}%` } }
    ];
  }

  // Age filter
  if (ageMin || ageMax) {
    const today = new Date();
    const minDate = ageMax ? new Date(today.getFullYear() - ageMax, today.getMonth(), today.getDate()) : null;
    const maxDate = ageMin ? new Date(today.getFullYear() - ageMin, today.getMonth(), today.getDate()) : null;

    if (minDate && maxDate) {
      whereClause.dateOfBirth = {
        [Op.between]: [minDate, maxDate]
      };
    } else if (minDate) {
      whereClause.dateOfBirth = {
        [Op.gte]: minDate
      };
    } else if (maxDate) {
      whereClause.dateOfBirth = {
        [Op.lte]: maxDate
      };
    }
  }

  // Blood type filter
  if (bloodType) {
    whereClause.bloodType = bloodType;
  }

  // Status filter
  if (status) {
    whereClause.status = status;
  }

  // Allergies filter
  if (hasAllergies === 'true') {
    whereClause.allergies = {
      [Op.not]: null
    };
  }

  // Medications filter
  if (hasMedications === 'true') {
    whereClause.medications = {
      [Op.not]: null
    };
  }

  const patients = await Patient.findAll({
    where: whereClause,
    order: [['lastName', 'ASC'], ['firstName', 'ASC']],
    limit: parseInt(limit),
    attributes: { exclude: ['ssn'] }
  });

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_ADVANCED_SEARCH',
    eventType: 'read',
    severity: 'high',
    status: 'success',
    resource: '/api/patients/search/advanced',
    resourceType: 'patient',
    phiAccessed: true,
    details: {
      searchQuery,
      ageMin,
      ageMax,
      bloodType,
      status,
      hasAllergies,
      hasMedications,
      resultsCount: patients.length
    },
    context: 'Advanced patient search'
  });

  res.json({
    patients: patients.map(p => p.toJSON()),
    count: patients.length
  });
}));

module.exports = router;