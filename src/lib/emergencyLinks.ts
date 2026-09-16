import { Alert, Linking } from 'react-native';
import i18n from 'i18next';

/**
 * Opens a tel:/sms: link for an emergency or crisis line. Devices without
 * telephony (iPad, some tablets, simulators, web) reject openURL; a crisis
 * button must never fail silently, so the number is shown to dial elsewhere.
 */
export function openEmergencyLink(url: string, displayNumber?: string): void {
  const number = displayNumber ?? url.replace(/^(tel|sms):/, '');
  void Linking.openURL(url).catch(() => {
    Alert.alert(
      i18n.t('crisis:emergency.openErrorTitle'),
      i18n.t('crisis:emergency.openErrorBody', { number }),
    );
  });
}
