import React from 'react';

export function Badge({ children, className = '', variant = 'default' }) {
  const base = 'inline-block px-2 py-0.5 rounded text-xs font-semibold';
  const variants = {
    default: 'bg-gray-200 text-gray-800',
    secondary: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    danger: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`${base} ${variants[variant] || variants.default} ${className}`}>{children}</span>
  );
} 