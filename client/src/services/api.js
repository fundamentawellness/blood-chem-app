import axios from 'axios';
import toast from 'react-hot-toast';

// Create axios instance
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001',
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add token to requests if available
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add timestamp for cache busting
    if (config.method === 'get') {
      config.params = {
        ...config.params,
        _t: Date.now(),
      };
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 errors (unauthorized)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Try to refresh token
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(
            `${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/auth/refresh`,
            { refreshToken }
          );

          const newToken = response.data.token;
          localStorage.setItem('token', newToken);
          api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
          originalRequest.headers['Authorization'] = `Bearer ${newToken}`;

          return api(originalRequest);
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
      }

      // If refresh fails, redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Handle other errors
    if (error.response) {
      const { status, data } = error.response;
      
      switch (status) {
        case 400:
          toast.error(data.message || 'Bad request');
          break;
        case 403:
          toast.error(data.message || 'Access denied');
          break;
        case 404:
          toast.error(data.message || 'Resource not found');
          break;
        case 409:
          toast.error(data.message || 'Conflict occurred');
          break;
        case 422:
          toast.error(data.message || 'Validation failed');
          break;
        case 500:
          toast.error('Internal server error. Please try again later.');
          break;
        case 503:
          toast.error('Service temporarily unavailable. Please try again later.');
          break;
        default:
          toast.error(data.message || 'An error occurred');
      }
    } else if (error.request) {
      // Network error
      toast.error('Network error. Please check your connection.');
    } else {
      // Other error
      toast.error('An unexpected error occurred');
    }

    return Promise.reject(error);
  }
);

// API endpoints
export const endpoints = {
  // Auth
  auth: {
    login: '/api/auth/login',
    register: '/api/auth/register',
    logout: '/api/auth/logout',
    profile: '/api/auth/profile',
    changePassword: '/api/auth/change-password',
    completeHIPAATraining: '/api/auth/complete-hipaa-training',
    refresh: '/api/auth/refresh',
  },

  // Patients
  patients: {
    list: '/api/patients',
    create: '/api/patients',
    get: (id) => `/api/patients/${id}`,
    update: (id) => `/api/patients/${id}`,
    delete: (id) => `/api/patients/${id}`,
    stats: '/api/patients/stats/overview',
    search: '/api/patients/search/advanced',
  },

  // Documents
  documents: {
    upload: '/api/documents/upload',
    list: '/api/documents',
    get: (id) => `/api/documents/${id}`,
    download: (id) => `/api/documents/${id}/download`,
    update: (id) => `/api/documents/${id}`,
    delete: (id) => `/api/documents/${id}`,
    byPatient: (patientId) => `/api/documents/patient/${patientId}`,
    labResults: (patientId) => `/api/documents/patient/${patientId}/lab-results`,
    stats: '/api/documents/stats/overview',
  },

  // Reports
  reports: {
    labSummary: '/api/reports/lab-summary',
    patientSummary: '/api/reports/patient-summary',
    trendAnalysis: '/api/reports/trend-analysis',
    comparativeAnalysis: '/api/reports/comparative-analysis',
    types: '/api/reports/types',
    history: '/api/reports/history',
  },

  // Audit
  audit: {
    logs: '/api/audit',
    phiAccess: '/api/audit/phi-access',
    securityEvents: '/api/audit/security-events',
    stats: '/api/audit/stats/overview',
    userActivity: (userId) => `/api/audit/user/${userId}/activity`,
    export: '/api/audit/export/csv',
  },

  // Health check
  health: '/api/health',
};

// API service functions
export const apiService = {
  // Auth
  login: (credentials) => api.post(endpoints.auth.login, credentials),
  register: (userData) => api.post(endpoints.auth.register, userData),
  logout: () => api.post(endpoints.auth.logout),
  getProfile: () => api.get(endpoints.auth.profile),
  updateProfile: (profileData) => api.put(endpoints.auth.profile, profileData),
  changePassword: (passwordData) => api.post(endpoints.auth.changePassword, passwordData),
  completeHIPAATraining: () => api.post(endpoints.auth.completeHIPAATraining),
  refreshToken: (refreshToken) => api.post(endpoints.auth.refresh, { refreshToken }),

  // Patients
  getPatients: (params) => api.get(endpoints.patients.list, { params }),
  createPatient: (patientData) => api.post(endpoints.patients.create, patientData),
  getPatient: (id) => api.get(endpoints.patients.get(id)),
  updatePatient: (id, patientData) => api.put(endpoints.patients.update(id), patientData),
  deletePatient: (id) => api.delete(endpoints.patients.delete(id)),
  getPatientStats: () => api.get(endpoints.patients.stats),
  searchPatients: (params) => api.get(endpoints.patients.search, { params }),

  // Documents
  uploadDocument: (formData) => api.post(endpoints.documents.upload, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getDocuments: (params) => api.get(endpoints.documents.list, { params }),
  getDocument: (id) => api.get(endpoints.documents.get(id)),
  downloadDocument: (id) => api.get(endpoints.documents.download(id), { responseType: 'blob' }),
  updateDocument: (id, documentData) => api.put(endpoints.documents.update(id), documentData),
  deleteDocument: (id) => api.delete(endpoints.documents.delete(id)),
  getPatientDocuments: (patientId, params) => api.get(endpoints.documents.byPatient(patientId), { params }),
  getLabResults: (patientId, params) => api.get(endpoints.documents.labResults(patientId), { params }),
  getDocumentStats: () => api.get(endpoints.documents.stats),

  // Reports
  generateLabSummary: (reportData) => api.post(endpoints.reports.labSummary, reportData),
  generatePatientSummary: (reportData) => api.post(endpoints.reports.patientSummary, reportData),
  generateTrendAnalysis: (reportData) => api.post(endpoints.reports.trendAnalysis, reportData),
  generateComparativeAnalysis: (reportData) => api.post(endpoints.reports.comparativeAnalysis, reportData),
  getReportTypes: () => api.get(endpoints.reports.types),
  getReportHistory: (params) => api.get(endpoints.reports.history, { params }),

  // Audit
  getAuditLogs: (params) => api.get(endpoints.audit.logs, { params }),
  getPHIAccessLogs: (params) => api.get(endpoints.audit.phiAccess, { params }),
  getSecurityEvents: (params) => api.get(endpoints.audit.securityEvents, { params }),
  getAuditStats: (params) => api.get(endpoints.audit.stats, { params }),
  getUserActivity: (userId, params) => api.get(endpoints.audit.userActivity(userId), { params }),
  exportAuditLogs: (params) => api.get(endpoints.audit.export, { 
    params,
    responseType: 'blob'
  }),

  // Health check
  healthCheck: () => api.get(endpoints.health),
};

// Utility functions
export const apiUtils = {
  // Handle file upload with progress
  uploadWithProgress: (url, formData, onProgress) => {
    return api.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        onProgress(percentCompleted);
      },
    });
  },

  // Download file
  downloadFile: (url, filename) => {
    return api.get(url, { responseType: 'blob' }).then((response) => {
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    });
  },

  // Cancel request
  cancelRequest: (source) => {
    if (source) {
      source.cancel('Request cancelled');
    }
  },

  // Create cancel token
  createCancelToken: () => {
    return axios.CancelToken.source();
  },
};

export default api;