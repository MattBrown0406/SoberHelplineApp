import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";
import { appAlert } from "../../lib/appAlert";
import {
  parseMondayMeeting,
  type MondayMeeting,
} from "../../lib/mondayMeeting";
import { familySquaresSyncWindow } from "../../../supabase/functions/_shared/family-squares-time";

/** Date-bound public agenda. Missing/unpublished content never invents a topic. */
export function MondayMeetingDetails({ accountId }: { accountId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation("common");
  const [meeting, setMeeting] = useState<MondayMeeting | null>(null);
  const generation = useRef(0);
  const focused = useIsFocused();
  const load = useCallback(async () => {
    const g = ++generation.current;
    const date = familySquaresSyncWindow(new Date()).meetingDate;
    try {
      const { data, error } = await supabase.rpc("monday_meeting_details", {
        p_date: date,
      });
      if (g === generation.current)
        setMeeting(error ? null : parseMondayMeeting(data, date));
    } catch {
      if (g === generation.current) setMeeting(null);
    }
  }, [accountId]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && focused) void load();
    });
    return () => sub.remove();
  }, [load, focused]);
  useEffect(() => {
    if (!meeting || !focused) return;
    void Promise.resolve(
      supabase.rpc("monday_card_viewed", { p_date: meeting.meeting_date }),
    ).catch(() => undefined);
  }, [accountId, meeting?.meeting_date, focused]);
  if (
    !meeting ||
    meeting.meeting_date !== familySquaresSyncWindow(new Date()).meetingDate
  )
    return null;
  return (
    <View style={{ gap: 8, marginVertical: 10 }}>
      {!!meeting.topic && (
        <Text
          accessibilityRole="header"
          style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}
        >
          {meeting.topic}
        </Text>
      )}
      {!!meeting.takeaway && (
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.inkSoft }}>
          {meeting.takeaway}
        </Text>
      )}
      {!!meeting.welcome_url && (
        <TouchableOpacity
          accessibilityRole="button"
          style={{ minHeight: 44, justifyContent: "center" }}
          onPress={() => {
            void Linking.openURL(meeting.welcome_url).catch(() =>
              appAlert(t("monday.welcomeError")),
            );
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: "700" }}>
            {t("monday.welcome")}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
