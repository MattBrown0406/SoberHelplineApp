import React, { useCallback, useRef, useState } from "react";
import {
  AppState,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { useFamilySquaresWeeklySeat } from "../../hooks/useFamilySquaresWeeklySeat";

/** Personal text is read/written only by its owner; never sent to attendance analytics. */
export function MondayReflection({ accountId }: { accountId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation("common");
  const [date, setDate] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const dirty = useRef(false);
  const locked = useRef(false);
  const weekly = useFamilySquaresWeeklySeat(accountId);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        if (locked.current || dirty.current) return;
        const g = ++generation.current;
        try {
          const found = await supabase.rpc("monday_followup");
          if (!active || g !== generation.current || found.error || !found.data)
            return;
          const result = await supabase.rpc("monday_reflection", {
            p_date: found.data,
          });
          if (
            !active ||
            g !== generation.current ||
            result.error ||
            dirty.current
          )
            return;
          setDate(found.data);
          setBody(typeof result.data === "string" ? result.data : "");
        } catch {
          /* A failed load never invents a previous meeting or overwrites text. */
        }
      };
      void load();
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") void load();
      });
      return () => {
        active = false;
        generation.current++;
        sub.remove();
      };
    }, [accountId]),
  );
  async function save() {
    if (locked.current || !date) return;
    locked.current = true;
    setBusy(true);
    setStatus("");
    const g = generation.current;
    try {
      const { error } = await supabase.rpc("monday_save_reflection", {
        p_date: date,
        p_body: body,
        p_expected_account: accountId,
      });
      if (g !== generation.current) return;
      setStatus(error ? "error" : "saved");
      if (!error) dirty.current = false;
    } catch {
      if (g === generation.current) setStatus("error");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!date) return null;
  return (
    <View
      style={{
        padding: 18,
        borderRadius: 18,
        backgroundColor: colors.white,
        borderWidth: 1,
        borderColor: colors.line,
        marginBottom: 14,
        gap: 10,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}
      >
        {t("monday.reflectionTitle")}
      </Text>
      <Text style={{ color: colors.inkSoft }}>
        {t("monday.reflectionPrivacy")}
      </Text>
      <TextInput
        accessibilityLabel={t("monday.reflectionTitle")}
        value={body}
        onChangeText={(v) => {
          dirty.current = true;
          setBody(v);
          setStatus("");
        }}
        multiline
        maxLength={1000}
        editable={!busy}
        style={{
          minHeight: 90,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 10,
          color: colors.ink,
        }}
      />
      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void save()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary, fontWeight: "700" }}>
          {t(busy ? "monday.saving" : "monday.save")}
        </Text>
      </TouchableOpacity>
      {!!status && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: status === "error" ? colors.coral : colors.inkSoft }}
        >
          {t(`monday.${status}`)}
        </Text>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        disabled={weekly.busy || weekly.enabled}
        onPress={() => {
          void weekly.setEnabled(true).then((ok) => {
            if (!ok) setStatus("error");
          });
        }}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary, fontWeight: "700" }}>
          {t(weekly.enabled ? "monday.weeklySaved" : "monday.nextMonday")}
        </Text>
      </TouchableOpacity>
      <Text style={{ color: colors.inkSoft }}>{t("monday.weeklyNote")}</Text>
    </View>
  );
}
