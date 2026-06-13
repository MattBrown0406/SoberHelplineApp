import { useWindowDimensions } from 'react-native';

export interface Responsive {
  width: number;
  height: number;
  isTablet: boolean;
  isLandscape: boolean;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isTablet: width >= 768,
    isLandscape: width > height,
  };
}
