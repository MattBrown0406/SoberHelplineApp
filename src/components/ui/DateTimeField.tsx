import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '../../contexts/ThemeContext';
import { applyInputValue, fieldBaseValue, mergePickedValue, toDateInputValue, toInputValue, type DateTimeFieldMode } from '../../lib/dateTimeInput';

type Props = {
  /** null = nothing chosen yet: the web input is empty and the native button shows `label`. */
  value: Date | null;
  /** Where the native picker opens (and what the chosen part merges into) while value is null. */
  fallbackValue?: Date;
  mode: DateTimeFieldMode;
  onChange: (next: Date) => void;
  /** Text on the native button (the web input shows the browser's own format). */
  label: string;
  accessibilityLabel: string;
  minimumDate?: Date;
  minuteInterval?: 1 | 2 | 3 | 4 | 5 | 6 | 10 | 12 | 15 | 20 | 30;
  style?: StyleProp<ViewStyle>;
};

/**
 * One date OR time part of a Date, editable on every platform.
 * @react-native-community/datetimepicker renders nothing on web, so there the
 * field is the browser's own <input type="date"|"time">; on iOS/Android it is
 * a button that opens the native picker. Only the chosen part changes.
 */
export function DateTimeField({ value, fallbackValue, mode, onChange, label, accessibilityLabel, minimumDate, minuteInterval, style }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const base = fieldBaseValue(value, fallbackValue);

  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: mode,
      // Empty until chosen, so an unset time never looks set and choosing the
      // suggested time still fires a change.
      value: value ? toInputValue(value, mode) : '',
      min: mode === 'date' && minimumDate ? toDateInputValue(minimumDate) : undefined,
      step: mode === 'time' && minuteInterval ? minuteInterval * 60 : undefined,
      'aria-label': accessibilityLabel,
      onChange: (event: { target: { value: string } }) => {
        const next = applyInputValue(base, event.target.value, mode);
        if (next) onChange(next);
      },
      style: {
        minHeight: 44,
        boxSizing: 'border-box',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.primary,
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 15,
        fontFamily: 'inherit',
        color: colors.ink,
        backgroundColor: colors.white,
      },
    });
  }

  const handleChange = (event: DateTimePickerEvent, picked?: Date) => {
    // Android shows a dialog that is gone after any answer; the iOS time
    // spinner reports every scroll step, so it stays until the button closes it.
    if (Platform.OS !== 'ios' || mode === 'date' || event.type === 'dismissed') setOpen(false);
    if (!picked || event.type === 'dismissed') return;
    onChange(mergePickedValue(base, picked, mode));
  };

  const toggle = () => {
    // The iOS picker only reports changes, so opening it on the suggested
    // value counts as choosing it (Android's dialog reports even an unchanged OK).
    if (!open && value === null && Platform.OS === 'ios') onChange(mergePickedValue(base, base, mode));
    setOpen((current) => !current);
  };

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={[styles.button, { borderColor: colors.primary }, style]}
      >
        <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      </TouchableOpacity>
      {open ? (
        <DateTimePicker
          value={base}
          mode={mode}
          minimumDate={mode === 'date' ? minimumDate : undefined}
          minuteInterval={mode === 'time' ? minuteInterval : undefined}
          onChange={handleChange}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, justifyContent: 'center' },
  label: { fontSize: 14 },
});
