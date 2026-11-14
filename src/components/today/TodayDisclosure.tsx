import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

/** The "Title · Show / Hide" row that opens and closes a tucked-away section of Today. */
export function TodayDisclosureToggle({ title, expanded, onPress }: { title: string; expanded: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  return (
    <TouchableOpacity
      accessibilityRole="button"
      aria-expanded={expanded} accessibilityState={{ expanded }}
      onPress={onPress}
      style={{ paddingVertical: 16, minHeight: 48, marginBottom: 8 }}
    >
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>
        {title} · {t(expanded ? 'disclosure.hide' : 'disclosure.show')}
      </Text>
    </TouchableOpacity>
  );
}

/** Keep opened forms mounted when tucked away so collapsing never loses edits. */
export function TodayDisclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  return (
    <View>
      <TodayDisclosureToggle
        title={title}
        expanded={expanded}
        onPress={() => { setVisited(true); setExpanded(value => !value); }}
      />
      {visited && <View style={{ display: expanded ? 'flex' : 'none' }}>{children}</View>}
    </View>
  );
}
