import React from 'react';

export function Button({ children, onClick, className = '', disabled = false, type = 'button', ...props }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
} 