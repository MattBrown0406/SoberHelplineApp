import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { boundaryFollowThroughCopy } from './followThroughCopy';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  prefill: string;
  onSave: (text: string, tag: string | null) => void | Promise<void>;
  lastAnchorTag: string | null;
}

export function WallBuilder({ prefill, onSave, lastAnchorTag }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('boundaries');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [text, setText] = useState(prefill);

  useEffect(() => {
    if (prefill) setText(prefill);
  }, [prefill]);

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true); setError(false);
    try { await onSave(trimmed, lastAnchorTag); setText(''); }
    catch { setError(true); }
    finally { setSaving(false); }
  }

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>
        {t('builder.eyebrow')}
      </Text>
      <Text style={[styles.sub, { color: colors.inkSoft }]}>
        {t('builder.sub')}
      </Text>
      <TextInput
        style={[
          styles.input,
          { borderColor: colors.line, color: colors.ink },
        ]}
        placeholder={t('builder.placeholder')}
        placeholderTextColor={colors.inkSoft}
        value={text}
        editable={!saving}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <TouchableOpacity
        style={[
          styles.saveBtn,
          {
            backgroundColor: text.trim() ? colors.primary : colors.line,
          },
        ]}
        onPress={() => void handleSave()}
        accessibilityRole="button"
        disabled={!text.trim() || saving}
        activeOpacity={0.8}
      >
        <Text style={styles.saveBtnText}>{t('builder.saveButton')}</Text>
      </TouchableOpacity>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.ink }}>{boundaryFollowThroughCopy(i18n.language).wallError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sub: {
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 80,
    marginBottom: 12,
  },
  saveBtn: {
    borderRadius: 99,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
