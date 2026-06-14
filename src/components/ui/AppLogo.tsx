import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface Props {
  size?: number;
}

const LOGO = require('../../../assets/images/lighthouse-icon.png');

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
