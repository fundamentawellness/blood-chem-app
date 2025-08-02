import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';

// Action types
const AUTH_ACTIONS = {
  LOGIN_START: 'LOGIN_START',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  UPDATE_USER: 'UPDATE_USER',
  REFRESH_TOKEN: 'REFRESH_TOKEN',
  SESSION_TIMEOUT: 'SESSION_TIMEOUT'
};

// Initial state
const initialState = {
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: false,
  error: null,
  lastActivity: Date.now()
};

// Reducer
const authReducer = (state, action) => {
  switch (action.type) {
    case AUTH_ACTIONS.LOGIN_START:
      return {
        ...state,
        isLoading: true,
        error: null
      };
    
    case AUTH_ACTIONS.LOGIN_SUCCESS:
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        lastActivity: Date.now()
      };
    
    case AUTH_ACTIONS.LOGIN_FAILURE:
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload
      };
    
    case AUTH_ACTIONS.LOGOUT:
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: null
      };
    
    case AUTH_ACTIONS.UPDATE_USER:
      return {
        ...state,
        user: { ...state.user, ...action.payload }
      };
    
    case AUTH_ACTIONS.REFRESH_TOKEN:
      return {
        ...state,
        token: action.payload,
        lastActivity: Date.now()
      };
    
    case AUTH_ACTIONS.SESSION_TIMEOUT:
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: 'Session expired. Please login again.'
      };
    
    default:
      return state;
  }
};

// Create context
const AuthContext = createContext();

// Provider component
export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const navigate = useNavigate();

  // Set up axios interceptor for token
  useEffect(() => {
    if (state.token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${state.token}`;
      localStorage.setItem('token', state.token);
    } else {
      delete api.defaults.headers.common['Authorization'];
      localStorage.removeItem('token');
    }
  }, [state.token]);

  // Check token validity on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (state.token) {
        try {
          const response = await api.get('/api/auth/profile');
          dispatch({
            type: AUTH_ACTIONS.LOGIN_SUCCESS,
            payload: {
              user: response.data.user,
              token: state.token
            }
          });
        } catch (error) {
          console.error('Token validation failed:', error);
          dispatch({ type: AUTH_ACTIONS.LOGOUT });
          navigate('/login');
        }
      }
    };

    checkAuth();
  }, []);

  // Login function
  const login = async (credentials) => {
    dispatch({ type: AUTH_ACTIONS.LOGIN_START });
    
    try {
      const response = await api.post('/api/auth/login', credentials);
      const { user, token, requiresHIPAATraining } = response.data;
      
      dispatch({
        type: AUTH_ACTIONS.LOGIN_SUCCESS,
        payload: { user, token }
      });

      toast.success('Login successful!');
      
      // Redirect based on HIPAA training status
      if (requiresHIPAATraining) {
        navigate('/hipaa-training');
      } else {
        navigate('/dashboard');
      }
      
      return { success: true, requiresHIPAATraining };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Login failed';
      dispatch({
        type: AUTH_ACTIONS.LOGIN_FAILURE,
        payload: errorMessage
      });
      
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Register function
  const register = async (userData) => {
    dispatch({ type: AUTH_ACTIONS.LOGIN_START });
    
    try {
      const response = await api.post('/api/auth/register', userData);
      const { user, requiresHIPAATraining } = response.data;
      
      toast.success('Registration successful! Please complete HIPAA training.');
      navigate('/hipaa-training');
      
      return { success: true, requiresHIPAATraining };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Registration failed';
      dispatch({
        type: AUTH_ACTIONS.LOGIN_FAILURE,
        payload: errorMessage
      });
      
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Logout function
  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      dispatch({ type: AUTH_ACTIONS.LOGOUT });
      navigate('/login');
      toast.success('Logged out successfully');
    }
  };

  // Update user profile
  const updateProfile = async (profileData) => {
    try {
      const response = await api.put('/api/auth/profile', profileData);
      dispatch({
        type: AUTH_ACTIONS.UPDATE_USER,
        payload: response.data.user
      });
      
      toast.success('Profile updated successfully');
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Profile update failed';
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Complete HIPAA training
  const completeHIPAATraining = async () => {
    try {
      const response = await api.post('/api/auth/complete-hipaa-training');
      dispatch({
        type: AUTH_ACTIONS.UPDATE_USER,
        payload: response.data.user
      });
      
      toast.success('HIPAA training completed successfully');
      navigate('/dashboard');
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to complete training';
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Change password
  const changePassword = async (passwordData) => {
    try {
      await api.post('/api/auth/change-password', passwordData);
      toast.success('Password changed successfully');
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Password change failed';
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  // Refresh token
  const refreshToken = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await api.post('/api/auth/refresh', { refreshToken });
      dispatch({
        type: AUTH_ACTIONS.REFRESH_TOKEN,
        payload: response.data.token
      });
      
      return { success: true };
    } catch (error) {
      console.error('Token refresh failed:', error);
      dispatch({ type: AUTH_ACTIONS.SESSION_TIMEOUT });
      navigate('/login');
      toast.error('Session expired. Please login again.');
      return { success: false };
    }
  };

  // Update last activity
  const updateActivity = () => {
    dispatch({
      type: AUTH_ACTIONS.UPDATE_USER,
      payload: { lastActivity: Date.now() }
    });
  };

  // Check if user has required permissions
  const hasPermission = (requiredRole, requiredAccessLevel) => {
    if (!state.user) return false;
    
    if (requiredRole && !requiredRole.includes(state.user.role)) {
      return false;
    }
    
    if (requiredAccessLevel) {
      const accessLevels = {
        'readonly': 1,
        'limited': 2,
        'full': 3
      };
      
      const userLevel = accessLevels[state.user.dataAccessLevel] || 0;
      const requiredLevel = accessLevels[requiredAccessLevel] || 0;
      
      return userLevel >= requiredLevel;
    }
    
    return true;
  };

  // Check if user can access PHI
  const canAccessPHI = () => {
    return state.user?.hipaaTrainingCompleted && state.isAuthenticated;
  };

  const value = {
    ...state,
    login,
    register,
    logout,
    updateProfile,
    completeHIPAATraining,
    changePassword,
    refreshToken,
    updateActivity,
    hasPermission,
    canAccessPHI
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};