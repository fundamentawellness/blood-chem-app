import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from 'react-error-boundary';

// Components
import Layout from './components/Layout/Layout';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import Dashboard from './components/Dashboard/Dashboard';
import Patients from './components/Patients/Patients';
import PatientDetail from './components/Patients/PatientDetail';
import Documents from './components/Documents/Documents';
import Reports from './components/Reports/Reports';
import Profile from './components/Profile/Profile';
import HIPAA from './components/HIPAA/HIPAA';
import AuditLogs from './components/Audit/AuditLogs';
import ErrorFallback from './components/Common/ErrorFallback';

// Context
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Hooks
import { useSessionTimeout } from './hooks/useSessionTimeout';

// Styles
import './styles/globals.css';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

// Protected Route Component
const ProtectedRoute = ({ children, requireHIPAATraining = true }) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireHIPAATraining && !user?.hipaaTrainingCompleted) {
    return <Navigate to="/hipaa-training" replace />;
  }

  return children;
};

// Admin Route Component
const AdminRoute = ({ children }) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

// Session Timeout Component
const SessionTimeoutHandler = () => {
  useSessionTimeout();
  return null;
};

function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router>
            <SessionTimeoutHandler />
            <div className="min-h-screen bg-gray-50">
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                
                {/* Protected Routes */}
                <Route path="/" element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="patients" element={<Patients />} />
                  <Route path="patients/:id" element={<PatientDetail />} />
                  <Route path="documents" element={<Documents />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="profile" element={<Profile />} />
                </Route>

                {/* HIPAA Training Route */}
                <Route path="/hipaa-training" element={
                  <ProtectedRoute requireHIPAATraining={false}>
                    <Layout>
                      <HIPAA />
                    </Layout>
                  </ProtectedRoute>
                } />

                {/* Admin Routes */}
                <Route path="/admin" element={
                  <AdminRoute>
                    <Layout />
                  </AdminRoute>
                }>
                  <Route path="audit" element={<AuditLogs />} />
                </Route>

                {/* 404 Route */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </div>
            
            {/* Toast Notifications */}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#10B981',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#EF4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </Router>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;