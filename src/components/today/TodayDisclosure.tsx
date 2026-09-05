import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

/** Keep opened forms mounted when tucked away so collapsing never loses edits. */
export function TodayDisclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  return (
    <View>
      <TouchableOpacity
        accessibilityRole="button"
        aria-expanded={expanded} accessibilityState={{ expanded }}
        onPress={() => { setVisited(true); setExpanded(value => !value); }}
        style={{ paddingVertical: 16, minHeight: 48, marginBottom: 8 }}
      >
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>
          {title} · {t(expanded ? 'disclosure.hide' : 'disclosure.show')}
        </Text>
      </TouchableOpacity>
      {visited && <View style={{ display: expanded ? 'flex' : 'none' }}>{children}</View>}
    </View>
  );
}
