const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { Op } = require('sequelize');
const Document = require('../models/Document');
const Patient = require('../models/Patient');
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { requireHIPAATraining, requireDataAccessLevel } = require('../middleware/auth');
const { createManualAuditEntry } = require('../middleware/audit');

const router = express.Router();

// Apply HIPAA training requirement to all report routes
router.use(requireHIPAATraining);

// Validation middleware
const validateReportRequest = [
  body('reportType').isIn([
    'lab_summary',
    'patient_summary',
    'trend_analysis',
    'comparative_analysis',
    'custom_report'
  ]),
  body('patientIds').optional().isArray(),
  body('dateRange').optional().isObject(),
  body('parameters').optional().isObject()
];

// Generate lab summary report
router.post('/lab-summary', requireDataAccessLevel('readonly'), validateReportRequest, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { patientIds, dateRange, parameters } = req.body;

  // Verify all patients belong to the provider
  if (patientIds && patientIds.length > 0) {
    const patients = await Patient.findAll({
      where: {
        id: { [Op.in]: patientIds },
        primaryProviderId: req.user.id,
        isActive: true
      }
    });

    if (patients.length !== patientIds.length) {
      throw new ValidationError('Some patients not found or access denied');
    }
  }

  const whereClause = {
    documentType: 'lab_result',
    isActive: true,
    processingStatus: 'completed'
  };

  // Add patient filter
  if (patientIds && patientIds.length > 0) {
    whereClause.patientId = { [Op.in]: patientIds };
  } else {
    // Get all patients for the provider
    const providerPatients = await Patient.findAll({
      where: { primaryProviderId: req.user.id, isActive: true },
      attributes: ['id']
    });
    whereClause.patientId = { [Op.in]: providerPatients.map(p => p.id) };
  }

  // Add date range filter
  if (dateRange) {
    whereClause.dateOfService = {};
    if (dateRange.start) {
      whereClause.dateOfService[Op.gte] = new Date(dateRange.start);
    }
    if (dateRange.end) {
      whereClause.dateOfService[Op.lte] = new Date(dateRange.end);
    }
  }

  const labResults = await Document.findAll({
    where: whereClause,
    include: [{
      model: Patient,
      attributes: ['id', 'firstName', 'lastName', 'mrn', 'dateOfBirth', 'gender']
    }],
    order: [['dateOfService', 'DESC']]
  });

  // Process lab results data
  const reportData = processLabSummaryData(labResults, parameters);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'LAB_SUMMARY_REPORT',
    eventType: 'report_generation',
    severity: 'high',
    status: 'success',
    resource: '/api/reports/lab-summary',
    resourceType: 'report',
    phiAccessed: true,
    phiFields: ['patientId', 'labResults'],
    details: {
      patientCount: patientIds ? patientIds.length : 'all',
      dateRange,
      resultsCount: labResults.length
    },
    context: 'Lab summary report generation'
  });

  res.json({
    reportType: 'lab_summary',
    generatedAt: new Date().toISOString(),
    parameters: { patientIds, dateRange, parameters },
    data: reportData,
    summary: {
      totalPatients: reportData.patients.length,
      totalLabResults: labResults.length,
      dateRange: dateRange || 'all'
    }
  });
}));

// Generate patient summary report
router.post('/patient-summary', requireDataAccessLevel('readonly'), validateReportRequest, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { patientIds, dateRange, parameters } = req.body;

  // Verify all patients belong to the provider
  if (patientIds && patientIds.length > 0) {
    const patients = await Patient.findAll({
      where: {
        id: { [Op.in]: patientIds },
        primaryProviderId: req.user.id,
        isActive: true
      }
    });

    if (patients.length !== patientIds.length) {
      throw new ValidationError('Some patients not found or access denied');
    }
  }

  const whereClause = {
    primaryProviderId: req.user.id,
    isActive: true
  };

  // Add date range filter for patient creation
  if (dateRange) {
    whereClause.createdAt = {};
    if (dateRange.start) {
      whereClause.createdAt[Op.gte] = new Date(dateRange.start);
    }
    if (dateRange.end) {
      whereClause.createdAt[Op.lte] = new Date(dateRange.end);
    }
  }

  const patients = await Patient.findAll({
    where: whereClause,
    include: [{
      model: Document,
      where: { isActive: true },
      required: false,
      attributes: ['id', 'documentType', 'createdAt']
    }],
    order: [['lastName', 'ASC'], ['firstName', 'ASC']]
  });

  // Process patient data
  const reportData = processPatientSummaryData(patients, parameters);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'PATIENT_SUMMARY_REPORT',
    eventType: 'report_generation',
    severity: 'high',
    status: 'success',
    resource: '/api/reports/patient-summary',
    resourceType: 'report',
    phiAccessed: true,
    phiFields: ['patientId', 'demographics', 'medicalHistory'],
    details: {
      patientCount: patients.length,
      dateRange
    },
    context: 'Patient summary report generation'
  });

  res.json({
    reportType: 'patient_summary',
    generatedAt: new Date().toISOString(),
    parameters: { patientIds, dateRange, parameters },
    data: reportData,
    summary: {
      totalPatients: patients.length,
      dateRange: dateRange || 'all'
    }
  });
}));

// Generate trend analysis report
router.post('/trend-analysis', requireDataAccessLevel('readonly'), validateReportRequest, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { patientIds, dateRange, parameters } = req.body;

  // Verify all patients belong to the provider
  if (patientIds && patientIds.length > 0) {
    const patients = await Patient.findAll({
      where: {
        id: { [Op.in]: patientIds },
        primaryProviderId: req.user.id,
        isActive: true
      }
    });

    if (patients.length !== patientIds.length) {
      throw new ValidationError('Some patients not found or access denied');
    }
  }

  const whereClause = {
    documentType: 'lab_result',
    isActive: true,
    processingStatus: 'completed'
  };

  // Add patient filter
  if (patientIds && patientIds.length > 0) {
    whereClause.patientId = { [Op.in]: patientIds };
  } else {
    // Get all patients for the provider
    const providerPatients = await Patient.findAll({
      where: { primaryProviderId: req.user.id, isActive: true },
      attributes: ['id']
    });
    whereClause.patientId = { [Op.in]: providerPatients.map(p => p.id) };
  }

  // Add date range filter
  if (dateRange) {
    whereClause.dateOfService = {};
    if (dateRange.start) {
      whereClause.dateOfService[Op.gte] = new Date(dateRange.start);
    }
    if (dateRange.end) {
      whereClause.dateOfService[Op.lte] = new Date(dateRange.end);
    }
  }

  const labResults = await Document.findAll({
    where: whereClause,
    include: [{
      model: Patient,
      attributes: ['id', 'firstName', 'lastName', 'mrn', 'dateOfBirth', 'gender']
    }],
    order: [['dateOfService', 'ASC']]
  });

  // Process trend analysis data
  const reportData = processTrendAnalysisData(labResults, parameters);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'TREND_ANALYSIS_REPORT',
    eventType: 'report_generation',
    severity: 'high',
    status: 'success',
    resource: '/api/reports/trend-analysis',
    resourceType: 'report',
    phiAccessed: true,
    phiFields: ['patientId', 'labResults'],
    details: {
      patientCount: patientIds ? patientIds.length : 'all',
      dateRange,
      resultsCount: labResults.length
    },
    context: 'Trend analysis report generation'
  });

  res.json({
    reportType: 'trend_analysis',
    generatedAt: new Date().toISOString(),
    parameters: { patientIds, dateRange, parameters },
    data: reportData,
    summary: {
      totalPatients: reportData.patients.length,
      totalLabResults: labResults.length,
      dateRange: dateRange || 'all'
    }
  });
}));

// Generate comparative analysis report
router.post('/comparative-analysis', requireDataAccessLevel('readonly'), validateReportRequest, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { patientIds, dateRange, parameters } = req.body;

  if (!patientIds || patientIds.length < 2) {
    throw new ValidationError('Comparative analysis requires at least 2 patients');
  }

  // Verify all patients belong to the provider
  const patients = await Patient.findAll({
    where: {
      id: { [Op.in]: patientIds },
      primaryProviderId: req.user.id,
      isActive: true
    }
  });

  if (patients.length !== patientIds.length) {
    throw new ValidationError('Some patients not found or access denied');
  }

  const whereClause = {
    documentType: 'lab_result',
    isActive: true,
    processingStatus: 'completed',
    patientId: { [Op.in]: patientIds }
  };

  // Add date range filter
  if (dateRange) {
    whereClause.dateOfService = {};
    if (dateRange.start) {
      whereClause.dateOfService[Op.gte] = new Date(dateRange.start);
    }
    if (dateRange.end) {
      whereClause.dateOfService[Op.lte] = new Date(dateRange.end);
    }
  }

  const labResults = await Document.findAll({
    where: whereClause,
    include: [{
      model: Patient,
      attributes: ['id', 'firstName', 'lastName', 'mrn', 'dateOfBirth', 'gender']
    }],
    order: [['patientId'], ['dateOfService', 'ASC']]
  });

  // Process comparative analysis data
  const reportData = processComparativeAnalysisData(labResults, parameters);

  // Create audit entry
  await createManualAuditEntry({
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    action: 'COMPARATIVE_ANALYSIS_REPORT',
    eventType: 'report_generation',
    severity: 'high',
    status: 'success',
    resource: '/api/reports/comparative-analysis',
    resourceType: 'report',
    phiAccessed: true,
    phiFields: ['patientId', 'labResults'],
    details: {
      patientCount: patientIds.length,
      dateRange,
      resultsCount: labResults.length
    },
    context: 'Comparative analysis report generation'
  });

  res.json({
    reportType: 'comparative_analysis',
    generatedAt: new Date().toISOString(),
    parameters: { patientIds, dateRange, parameters },
    data: reportData,
    summary: {
      totalPatients: patientIds.length,
      totalLabResults: labResults.length,
      dateRange: dateRange || 'all'
    }
  });
}));

// Get available report types
router.get('/types', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const reportTypes = [
    {
      id: 'lab_summary',
      name: 'Lab Summary Report',
      description: 'Comprehensive summary of lab results for selected patients',
      parameters: ['patientIds', 'dateRange', 'labParameters']
    },
    {
      id: 'patient_summary',
      name: 'Patient Summary Report',
      description: 'Demographic and medical summary for selected patients',
      parameters: ['patientIds', 'dateRange', 'includeDocuments']
    },
    {
      id: 'trend_analysis',
      name: 'Trend Analysis Report',
      description: 'Analysis of lab result trends over time',
      parameters: ['patientIds', 'dateRange', 'trendParameters']
    },
    {
      id: 'comparative_analysis',
      name: 'Comparative Analysis Report',
      description: 'Compare lab results between multiple patients',
      parameters: ['patientIds', 'dateRange', 'comparisonMetrics']
    },
    {
      id: 'custom_report',
      name: 'Custom Report',
      description: 'Create a custom report with specific parameters',
      parameters: ['patientIds', 'dateRange', 'customParameters']
    }
  ];

  res.json({
    reportTypes
  });
}));

// Get report history
router.get('/history', requireDataAccessLevel('readonly'), asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  // Get audit entries for report generation
  const Audit = require('../models/Audit');
  
  const reportHistory = await Audit.findAndCountAll({
    where: {
      userId: req.user.id,
      eventType: 'report_generation',
      resource: { [Op.like]: '/api/reports/%' }
    },
    order: [['timestamp', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.json({
    history: reportHistory.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: reportHistory.count,
      totalPages: Math.ceil(reportHistory.count / limit)
    }
  });
}));

// Helper functions for data processing
function processLabSummaryData(labResults, parameters) {
  const patients = {};
  const summary = {
    totalResults: labResults.length,
    dateRange: null,
    abnormalResults: 0,
    normalResults: 0
  };

  labResults.forEach(result => {
    const patientId = result.patientId;
    if (!patients[patientId]) {
      patients[patientId] = {
        patient: result.Patient,
        results: [],
        summary: {
          totalResults: 0,
          abnormalResults: 0,
          normalResults: 0
        }
      };
    }

    patients[patientId].results.push({
      id: result.id,
      dateOfService: result.dateOfService,
      labResults: result.labResults,
      title: result.title
    });

    patients[patientId].summary.totalResults++;
    summary.totalResults++;

    // Process lab results data
    if (result.labResults && result.labResults.processed) {
      // Add logic to determine normal vs abnormal results
      // This would depend on the actual lab data structure
    }
  });

  return {
    patients: Object.values(patients),
    summary
  };
}

function processPatientSummaryData(patients, parameters) {
  const summary = {
    totalPatients: patients.length,
    demographics: {
      ageGroups: {},
      genderDistribution: {},
      bloodTypes: {}
    },
    medicalData: {
      patientsWithAllergies: 0,
      patientsWithMedications: 0,
      averageDocumentsPerPatient: 0
    }
  };

  let totalDocuments = 0;

  patients.forEach(patient => {
    // Process demographics
    const age = patient.getAge();
    const ageGroup = getAgeGroup(age);
    summary.demographics.ageGroups[ageGroup] = (summary.demographics.ageGroups[ageGroup] || 0) + 1;

    summary.demographics.genderDistribution[patient.gender] = 
      (summary.demographics.genderDistribution[patient.gender] || 0) + 1;

    if (patient.bloodType) {
      summary.demographics.bloodTypes[patient.bloodType] = 
        (summary.demographics.bloodTypes[patient.bloodType] || 0) + 1;
    }

    // Process medical data
    if (patient.allergies && Object.keys(patient.allergies).length > 0) {
      summary.medicalData.patientsWithAllergies++;
    }

    if (patient.medications && Object.keys(patient.medications).length > 0) {
      summary.medicalData.patientsWithMedications++;
    }

    totalDocuments += patient.Documents ? patient.Documents.length : 0;
  });

  summary.medicalData.averageDocumentsPerPatient = 
    patients.length > 0 ? (totalDocuments / patients.length).toFixed(2) : 0;

  return {
    patients: patients.map(p => ({
      id: p.id,
      mrn: p.mrn,
      name: p.getFullName(),
      age: p.getAge(),
      gender: p.gender,
      bloodType: p.bloodType,
      hasAllergies: p.allergies && Object.keys(p.allergies).length > 0,
      hasMedications: p.medications && Object.keys(p.medications).length > 0,
      documentCount: p.Documents ? p.Documents.length : 0
    })),
    summary
  };
}

function processTrendAnalysisData(labResults, parameters) {
  // Group results by patient and analyze trends
  const patientTrends = {};
  const overallTrends = {
    totalResults: labResults.length,
    timePeriods: {}
  };

  labResults.forEach(result => {
    const patientId = result.patientId;
    if (!patientTrends[patientId]) {
      patientTrends[patientId] = {
        patient: result.Patient,
        trends: []
      };
    }

    patientTrends[patientId].trends.push({
      date: result.dateOfService,
      labResults: result.labResults
    });

    // Process overall trends
    const month = result.dateOfService.toISOString().substring(0, 7);
    overallTrends.timePeriods[month] = (overallTrends.timePeriods[month] || 0) + 1;
  });

  return {
    patientTrends: Object.values(patientTrends),
    overallTrends
  };
}

function processComparativeAnalysisData(labResults, parameters) {
  // Compare lab results between patients
  const comparisons = {};
  const patientData = {};

  labResults.forEach(result => {
    const patientId = result.patientId;
    if (!patientData[patientId]) {
      patientData[patientId] = {
        patient: result.Patient,
        results: []
      };
    }

    patientData[patientId].results.push({
      date: result.dateOfService,
      labResults: result.labResults
    });
  });

  // Generate comparisons
  const patientIds = Object.keys(patientData);
  for (let i = 0; i < patientIds.length; i++) {
    for (let j = i + 1; j < patientIds.length; j++) {
      const comparisonKey = `${patientIds[i]}_vs_${patientIds[j]}`;
      comparisons[comparisonKey] = {
        patient1: patientData[patientIds[i]],
        patient2: patientData[patientIds[j]],
        differences: [] // Add logic to compare lab values
      };
    }
  }

  return {
    comparisons,
    patientData
  };
}

function getAgeGroup(age) {
  if (age < 18) return 'Under 18';
  if (age < 30) return '18-29';
  if (age < 50) return '30-49';
  if (age < 65) return '50-64';
  return '65+';
}

module.exports = router;