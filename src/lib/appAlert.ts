import { Alert, Platform } from 'react-native';
import { showWebAlert, type AppAlertButton } from './webAlert';

export type { AppAlertButton } from './webAlert';

/**
 * Drop-in for Alert.alert. react-native-web's Alert.alert is an empty stub, so
 * on web every confirm-then-act flow and every error message silently did
 * nothing; there the browser's own dialogs are used instead.
 */
export function appAlert(title: string, message?: string, buttons?: AppAlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  showWebAlert(globalThis as Parameters<typeof showWebAlert>[0], title, message, buttons);
}
