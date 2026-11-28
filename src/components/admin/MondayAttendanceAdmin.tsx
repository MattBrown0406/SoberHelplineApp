import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, TouchableOpacity, View, Switch } from "react-native";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";
import { familySquaresSyncWindow } from "../../../supabase/functions/_shared/family-squares-time";

type Draft = {
  topic: string;
  takeaway: string;
  welcome_url: string;
  zoom_uuid: string;
  reminders_enabled: boolean;
};
const empty: Draft = {
  topic: "",
  takeaway: "",
  welcome_url: "",
  zoom_uuid: "",
  reminders_enabled: false,
};
type Week = {
  meeting_date: string;
  views: number;
  rsvps: number | null;
  join_taps: number;
  return_signals: number;
  confirmed: number | null;
  confirmed_10min: number | null;
  returned_next_week: number | null;
  unmatched: number | null;
};
export function MondayAttendanceAdmin() {
  const { colors } = useTheme();
  const [date, setDate] = useState(
    familySquaresSyncWindow(new Date()).meetingDate,
  );
  const [draft, setDraft] = useState<Draft>(empty);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [loadedDate, setLoadedDate] = useState("");
  const [savedUuid, setSavedUuid] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  async function load() {
    const g = ++generation.current;
    setLoaded(false);
    setMessage("");
    try {
      const [content, stats] = await Promise.all([
        supabase.rpc("admin_monday_meeting", { p_date: date }),
        supabase.rpc("admin_monday_attendance"),
      ]);
      if (g !== generation.current) return;
      if (content.error || stats.error)
        throw new Error("Could not load meeting settings.");
      setDraft(content.data);
      setLoadedDate(date);
      setSavedUuid(content.data.zoom_uuid);
      setWeeks(stats.data || []);
      setLoaded(true);
    } catch {
      if (g === generation.current)
        setMessage(
          "Could not load meeting settings. Check the date and retry.",
        );
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [date]);
  async function save() {
    if (busy || !loaded || loadedDate !== date) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.rpc("admin_save_monday_meeting", {
        p_date: date,
        p_topic: draft.topic,
        p_takeaway: draft.takeaway,
        p_welcome_url: draft.welcome_url,
        p_zoom_uuid: draft.zoom_uuid,
        p_reminders_enabled: draft.reminders_enabled,
      });
      if (!result.error) setSavedUuid(draft.zoom_uuid);
      setMessage(
        result.error
          ? "Could not save. Use a Monday date and an approved public video URL."
          : "Meeting settings saved.",
      );
    } catch {
      setMessage("Could not save. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (busy || !loaded || loadedDate !== date || draft.zoom_uuid !== savedUuid)
      return;
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.functions.invoke("monday-zoom-attendance", {
        body: { meeting_date: date },
      });
      if (result.error) throw result.error;
      await load();
      setMessage(
        "Zoom attendance reconciled. Unmatched guests remain unknown.",
      );
    } catch {
      setMessage(
        "Could not reconcile Zoom attendance. Check the occurrence UUID and server Zoom credentials. Previous results were preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: keyof Omit<Draft, "reminders_enabled">,
    label: string,
    max: number,
  ) => (
    <View key={key}>
      <Text style={{ color: colors.ink }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={loaded && !busy}
        value={draft[key]}
        onChangeText={(v) => setDraft((d) => ({ ...d, [key]: v }))}
        maxLength={max}
        autoCapitalize="none"
        style={{
          minHeight: 44,
          padding: 10,
          borderWidth: 1,
          borderColor: colors.line,
          color: colors.ink,
          borderRadius: 8,
        }}
      />
    </View>
  );
  return (
    <View
      style={{
        padding: 18,
        backgroundColor: colors.white,
        borderRadius: 16,
        gap: 12,
        marginBottom: 16,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 19, fontWeight: "700", color: colors.ink }}
      >
        Monday attendance
      </Text>
      <Text style={{ color: colors.inkSoft }}>
        Publish the actual topic and takeaway for this date. An empty agenda
        shows the normal meeting card. Welcome video is optional.
      </Text>
      <TextInput
        accessibilityLabel="Meeting date YYYY-MM-DD"
        value={date}
        editable={!busy}
        onChangeText={setDate}
        style={{
          minHeight: 44,
          color: colors.ink,
          borderWidth: 1,
          borderColor: colors.line,
          padding: 10,
        }}
      />
      {field("topic", "Meeting topic", 120)}
      {field("takeaway", "What families will leave with", 240)}
      {field(
        "welcome_url",
        "Welcome video URL (YouTube, Vimeo, or soberhelpline.com)",
        1000,
      )}
      {field(
        "zoom_uuid",
        "Past Zoom occurrence UUID (for attendance reconciliation)",
        200,
      )}
      <Text style={{ color: colors.inkSoft }}>
        Activate the new reminder sequence only after deploying monday-reminders
        and the updated legacy senders. It replaces the older Monday reminders.
      </Text>
      <Switch
        accessibilityLabel="Activate coordinated Monday reminders"
        disabled={!loaded || loadedDate !== date || busy}
        value={draft.reminders_enabled}
        onValueChange={(v) => setDraft((d) => ({ ...d, reminders_enabled: v }))}
      />
      <TouchableOpacity
        accessibilityRole="button"
        disabled={!loaded || loadedDate !== date || busy}
        onPress={() => void save()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary, fontWeight: "700" }}>
          Save meeting settings
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={
          !loaded ||
          loadedDate !== date ||
          busy ||
          !draft.zoom_uuid ||
          draft.zoom_uuid !== savedUuid
        }
        onPress={() => void sync()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary, fontWeight: "700" }}>
          Reconcile completed meeting with Zoom
        </Text>
      </TouchableOpacity>
      {!!message && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.inkSoft }}
        >
          {message}
        </Text>
      )}
      {!loaded && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void load()}
          style={{ minHeight: 44 }}
        >
          <Text style={{ color: colors.primary }}>Retry loading</Text>
        </TouchableOpacity>
      )}
      <Text style={{ color: colors.inkSoft }}>
        App returns are unverified signals. “Unknown” means no Zoom report has
        been reconciled. Next-week returns require reports for both weeks.
      </Text>
      {weeks.map((w) => (
        <Text
          key={w.meeting_date}
          style={{ color: colors.ink, lineHeight: 22 }}
        >
          {w.meeting_date}: {w.views} card views · {w.rsvps ?? "Unknown"} seats
          · {w.join_taps} Join taps · {w.return_signals} app returns ·{" "}
          {w.confirmed ?? "Unknown"} confirmed attendees ·{" "}
          {w.confirmed_10min ?? "Unknown"} confirmed 10+ min ·{" "}
          {w.returned_next_week ?? "Unknown"} returned next week ·{" "}
          {w.unmatched ?? "Unknown"} unmatched connections
        </Text>
      ))}
    </View>
  );
}
