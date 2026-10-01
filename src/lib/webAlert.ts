export type AppAlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
};

type BrowserDialogs = {
  alert?: (message: string) => void;
  confirm?: (message: string) => boolean;
};

export function showWebAlert(
  dialogs: BrowserDialogs,
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
): void {
  const text = [title, message].filter(Boolean).join('\n\n');
  const cancel = buttons?.find((button) => button.style === 'cancel');
  const actions = (buttons ?? []).filter((button) => button.style !== 'cancel');

  if (actions.length === 0) {
    dialogs.alert?.(text);
    void cancel?.onPress?.();
    return;
  }
  if (actions.length === 1 && !cancel) {
    dialogs.alert?.(text);
    void actions[0].onPress?.();
    return;
  }
  // One question per choice, in order; declining them all is "cancel".
  for (const action of actions) {
    const prompt = actions.length === 1 ? text : `${text}\n\n${action.text}?`;
    if (dialogs.confirm?.(prompt)) {
      void action.onPress?.();
      return;
    }
  }
  void cancel?.onPress?.();
}
