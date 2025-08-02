import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const WARNING_TIME = 5 * 60 * 1000; // 5 minutes before timeout

export const useSessionTimeout = () => {
  const { user, logout, updateActivity } = useAuth();
  const timeoutRef = useRef(null);
  const warningRef = useRef(null);
  const activityRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    // Update activity on user interactions
    const updateUserActivity = () => {
      updateActivity();
      resetTimers();
    };

    // Reset timers
    const resetTimers = () => {
      // Clear existing timers
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (warningRef.current) {
        clearTimeout(warningRef.current);
      }

      // Set warning timer
      warningRef.current = setTimeout(() => {
        showWarning();
      }, SESSION_TIMEOUT - WARNING_TIME);

      // Set logout timer
      timeoutRef.current = setTimeout(() => {
        handleSessionTimeout();
      }, SESSION_TIMEOUT);
    };

    // Show warning before timeout
    const showWarning = () => {
      const warningMessage = 'Your session will expire in 5 minutes due to inactivity. Click anywhere to continue.';
      
      // Create warning element
      const warningElement = document.createElement('div');
      warningElement.id = 'session-warning';
      warningElement.innerHTML = `
        <div style="
          position: fixed;
          top: 20px;
          right: 20px;
          background: #F59E0B;
          color: white;
          padding: 16px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          z-index: 9999;
          max-width: 300px;
          font-family: system-ui, -apple-system, sans-serif;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span style="font-weight: 600;">Session Warning</span>
          </div>
          <p style="margin: 8px 0 0 0; font-size: 14px;">${warningMessage}</p>
          <button onclick="document.getElementById('session-warning').remove(); resetSessionTimers();" style="
            background: white;
            color: #F59E0B;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            margin-top: 12px;
            cursor: pointer;
            font-weight: 600;
          ">Continue Session</button>
        </div>
      `;

      // Add to page
      document.body.appendChild(warningElement);

      // Add global function to reset timers
      window.resetSessionTimers = () => {
        updateUserActivity();
        if (warningElement.parentNode) {
          warningElement.parentNode.removeChild(warningElement);
        }
      };
    };

    // Handle session timeout
    const handleSessionTimeout = () => {
      // Remove warning if still present
      const warningElement = document.getElementById('session-warning');
      if (warningElement) {
        warningElement.remove();
      }

      // Show timeout message
      const timeoutMessage = 'Your session has expired due to inactivity. You will be redirected to the login page.';
      
      const timeoutElement = document.createElement('div');
      timeoutElement.id = 'session-timeout';
      timeoutElement.innerHTML = `
        <div style="
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #EF4444;
          color: white;
          padding: 24px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          z-index: 10000;
          max-width: 400px;
          text-align: center;
          font-family: system-ui, -apple-system, sans-serif;
        ">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px;">
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span style="font-weight: 600; font-size: 18px;">Session Expired</span>
          </div>
          <p style="margin: 0; font-size: 16px;">${timeoutMessage}</p>
        </div>
      `;

      document.body.appendChild(timeoutElement);

      // Logout after showing message
      setTimeout(() => {
        logout();
      }, 3000);
    };

    // Set up activity listeners
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click'
    ];

    events.forEach(event => {
      document.addEventListener(event, updateUserActivity, true);
    });

    // Initial timer setup
    resetTimers();

    // Cleanup function
    return () => {
      // Remove event listeners
      events.forEach(event => {
        document.removeEventListener(event, updateUserActivity, true);
      });

      // Clear timers
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (warningRef.current) {
        clearTimeout(warningRef.current);
      }

      // Remove warning elements
      const warningElement = document.getElementById('session-warning');
      if (warningElement) {
        warningElement.remove();
      }

      const timeoutElement = document.getElementById('session-timeout');
      if (timeoutElement) {
        timeoutElement.remove();
      }

      // Remove global function
      delete window.resetSessionTimers;
    };
  }, [user, logout, updateActivity]);

  // Return session info
  return {
    sessionTimeout: SESSION_TIMEOUT,
    warningTime: WARNING_TIME,
    resetSession: () => {
      updateActivity();
      // Reset timers manually
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (warningRef.current) {
        clearTimeout(warningRef.current);
      }
    }
  };
};