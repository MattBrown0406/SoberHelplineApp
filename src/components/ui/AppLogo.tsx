import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface Props {
  size?: number;
}

// The lighthouse as the App Store icon and the launch screen draw it (white
// light beams). Also the launch-screen image in app.json.
const LOGO = require('../../../assets/images/lighthouse-mark.png');

export function AppLogo({ size = 72 }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size * 0.22 }]}>
      <Image source={LOGO} style={{ width: size, height: size, borderRadius: size * 0.22 }} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});
