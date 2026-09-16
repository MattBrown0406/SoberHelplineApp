import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Localization from 'expo-localization';
import i18n from '../i18n';
import { captureAppError } from '../lib/monitoring';
import { errorBoundaryCopy } from '../lib/errorBoundaryCopy';

/** Root error boundary — last line of defense for render failures. */
function reportError(error: Error) {
  captureAppError(error);
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }
}

function currentLanguage(): string {
  try {
    if (i18n.isInitialized && i18n.language) return i18n.language;
    return Localization.getLocales()[0]?.languageCode ?? 'en';
  } catch {
    return 'en';
  }
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

  componentDidCatch(error: Error) {
    reportError(error);
  }

  render() {
    if (this.state.hasError) {
      const copy = errorBoundaryCopy(currentLanguage());
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚓</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => this.setState({ hasError: false })}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{copy.retry}</Text>
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
