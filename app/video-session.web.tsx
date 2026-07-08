import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/contexts/ThemeContext';

export default function VideoSessionWeb() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={styles.inner}>
        <Text style={styles.icon}>📱</Text>
        <Text style={[styles.message, { color: colors.ink }]}>Private video sessions are available in the iOS app.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.btn, { backgroundColor: colors.primary }]}>
          <Text style={styles.btnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { fontSize: 52, marginBottom: 20 },
  message: { fontSize: 17, lineHeight: 26, textAlign: 'center', marginBottom: 32 },
  btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 32 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
