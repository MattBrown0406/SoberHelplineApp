import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import {
  addProfileItem,
  PROFILE_ITEM_MAX,
  PROFILE_LIST_LIMIT,
  removeProfileItem,
} from '../../lib/lovedOneProfile';

export type ChipSuggestion = { label: string; fromTracker: boolean };

/**
 * One pattern-map list: what's been added (tap to remove), tap-to-add
 * suggestion chips (tracker-seeded ones first), and a free-text field for the
 * family's own words. Pass `draftText` + `onDraftChange` to own the typed
 * (not yet Added) text — setup does, so it can fold it into this step's list
 * before moving on or leaving.
 */
export function ChipPicker({
  items,
  onChange,
  suggestions,
  placeholder,
  draftText,
  onDraftChange,
  inputDisabled = false,
}: {
  items: readonly string[];
  onChange: (items: string[]) => void;
  suggestions: readonly ChipSuggestion[];
  placeholder?: string;
  draftText?: string;
  onDraftChange?: (text: string) => void;
  /** Lock the typed-text field and Add (e.g. while the parent is saving). */
  inputDisabled?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const [ownDraft, setOwnDraft] = useState('');
  const controlled = draftText !== undefined && onDraftChange !== undefined;
  const draft = controlled ? draftText : ownDraft;
  const setDraft = controlled ? onDraftChange : setOwnDraft;
  const full = items.length >= PROFILE_LIST_LIMIT;
  const lower = new Set(items.map((item) => item.toLowerCase()));
  const open = suggestions.filter((suggestion) => !lower.has(suggestion.label.toLowerCase()));

  function addDraft() {
    if (inputDisabled) return;
    const next = addProfileItem(items, draft);
    if (next.length !== items.length) onChange(next);
    setDraft('');
  }

  return (
    <View>
      {items.length > 0 && (
        <View style={styles.chips}>
          {items.map((item) => (
            <TouchableOpacity
              key={item}
              accessibilityRole="button"
              accessibilityLabel={t('setup.removeA11y', { item })}
              onPress={() => onChange(removeProfileItem(items, item))}
              style={[styles.chip, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.chipText, { color: '#fff' }]}>{item}  ×</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {full ? (
        <Text style={[styles.note, { color: colors.inkSoft }]}>{t('setup.listFull')}</Text>
      ) : (
        <>
          {open.length > 0 && (
            <View style={styles.chips}>
              {open.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion.label}
                  accessibilityRole="button"
                  accessibilityLabel={t('setup.addA11y', { item: suggestion.label })}
                  accessibilityHint={suggestion.fromTracker ? t('setup.fromTracker') : undefined}
                  onPress={() => onChange(addProfileItem(items, suggestion.label))}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: suggestion.fromTracker ? colors.secondaryLight : colors.white,
                      borderColor: suggestion.fromTracker ? colors.secondary : colors.line,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: colors.ink }]}>+ {suggestion.label}</Text>
                  {suggestion.fromTracker && (
                    <Text style={[styles.tracker, { color: colors.inkSoft }]}>{t('setup.fromTracker')}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel={placeholder ?? t('setup.addPlaceholder')}
              value={draft}
              editable={!inputDisabled}
              onChangeText={setDraft}
              onSubmitEditing={addDraft}
              placeholder={placeholder ?? t('setup.addPlaceholder')}
              placeholderTextColor={colors.inkSoft}
              maxLength={PROFILE_ITEM_MAX}
              returnKeyType="done"
              style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white }]}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('setup.add')}
              accessibilityState={{ disabled: inputDisabled || !draft.trim() }}
              disabled={inputDisabled || !draft.trim()}
              onPress={addDraft}
              style={[styles.addButton, { backgroundColor: !inputDisabled && draft.trim() ? colors.primary : colors.line }]}
            >
              <Text style={styles.addText}>{t('setup.add')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipText: { fontSize: 14, fontWeight: '700' },
  tracker: { fontSize: 10, fontWeight: '800', marginTop: 1 },
  note: { fontSize: 12.5, marginTop: 10 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  addButton: { minHeight: 46, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  addText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
