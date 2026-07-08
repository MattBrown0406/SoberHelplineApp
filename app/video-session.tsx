// Expo Router requires a base file alongside platform-specific siblings.
// On native .native.tsx wins; on web .web.tsx wins. This is never rendered.
import React from 'react';
import { View } from 'react-native';
export default function VideoSessionFallback() {
  return <View />;
}
