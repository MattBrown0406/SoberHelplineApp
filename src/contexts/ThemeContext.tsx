import React, { createContext, useContext, useState } from 'react';
import type { OrgBranding } from '../api/types';

export interface AppColors {
  // Primary — white-label primary replaces these
  primary: string;
  primaryDark: string;
  primaryLight: string;
  // Secondary — white-label secondary replaces these
  secondary: string;
  secondaryLight: string;
  // Fixed palette (not overridable)
  coral: string;
  coralLight: string;
  cream: string;
  sand: string;
  ink: string;
  inkSoft: string;
  line: string;
  green: string;
  greenLight: string;
  white: string;
}

const DEFAULT_COLORS: AppColors = {
  primary: '#1a365d',
  primaryDark: '#0f2440',
  primaryLight: '#e8eef6',
  secondary: '#d9913b',
  secondaryLight: '#fdf3e3',
  coral: '#c4604f',
  coralLight: '#fbeae7',
  cream: '#faf6ef',
  sand: '#e8ddc9',
  ink: '#22302f',
  inkSoft: '#5c6b6a',
  line: '#e2e0d8',
  green: '#4d7c5f',
  greenLight: '#e9f2ec',
  white: '#ffffff',
};

interface ThemeContextValue {
  colors: AppColors;
  branding: OrgBranding | null;
  applyBranding: (branding: OrgBranding | null) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: DEFAULT_COLORS,
  branding: null,
  applyBranding: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<OrgBranding | null>(null);

  const colors: AppColors = branding
    ? {
        ...DEFAULT_COLORS,
        primary: branding.primaryColor,
        // Derive a dark variant by appending opacity — good enough until design
        // specifies exact shade generation. Replace with a proper shade function
        // when white-label QA begins.
        primaryDark: branding.primaryColor,
        primaryLight: branding.primaryColor + '20',
        secondary: branding.secondaryColor,
        secondaryLight: branding.secondaryColor + '20',
      }
    : DEFAULT_COLORS;

  return (
    <ThemeContext.Provider value={{ colors, branding, applyBranding: setBranding }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
