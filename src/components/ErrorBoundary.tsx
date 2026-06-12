import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

/**
 * Root error boundary — last line of defense so a render crash never shows
 * families a red screen. Reports to Sentry when EXPO_PUBLIC_SENTRY_DSN is set
 * (P2: swap reportError for @sentry/react-native captureException).
 */
function reportError(error: Error, info: React.ErrorInfo) {
  // eslint-disable-next-line no-console
  console.error('[ErrorBoundary]', error, info.componentStack);
  // TODO(P2): Sentry.captureException(error) once DSN + SDK are configured.
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚓</Text>
          <Text style={styles.title}>Something went wrong on our side.</Text>
          <Text style={styles.body}>
            Your data is safe. If you need support right now, call 988 or 911.
          </Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => this.setState({ hasError: false })}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#142a47',
    padding: 32,
  },
  icon: { fontSize: 40, marginBottom: 14 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 26,
  },
  btn: {
    backgroundColor: '#e9a13b',
    borderRadius: 99,
    paddingVertical: 13,
    paddingHorizontal: 34,
  },
  btnText: { color: '#142a47', fontWeight: '700', fontSize: 15 },
});
