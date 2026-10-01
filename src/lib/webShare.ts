// Share and print on react-native-web.
// - Share.share rejects in browsers without navigator.share (most desktop
//   browsers), so a selected disclosure falls back to the clipboard.
// - expo-print ignores `html` on web and calls window.print(), which prints the
//   whole screen (address, weapons, overdose history) instead of the selected
//   text. On web the generated HTML is printed from its own window instead.

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

type ShareDeps = {
  /** False when the platform has no share sheet (web without navigator.share). */
  canShare: boolean;
  share: (text: string) => Promise<unknown>;
  copy: (text: string) => Promise<unknown>;
};

function isUserCancel(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/** Share text, or copy it when sharing is unavailable or fails (not when the person cancels). */
export async function shareOrCopy(text: string, deps: ShareDeps): Promise<ShareOutcome> {
  if (deps.canShare) {
    try {
      await deps.share(text);
      return 'shared';
    } catch (error) {
      if (isUserCancel(error)) return 'cancelled';
    }
  }
  try {
    await deps.copy(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

type BrowserScope = {
  navigator?: { share?: unknown };
  open?: (url?: string, target?: string) => PrintWindow | null;
};

type PrintWindow = {
  document: { open(): void; write(html: string): void; close(): void };
  focus?: () => void;
  print(): void;
  close?: () => void;
  onafterprint?: (() => void) | null;
};

/** Whether this browser offers a native share sheet. */
export function webCanShare(scope: unknown): boolean {
  try {
    return typeof (scope as BrowserScope | null)?.navigator?.share === 'function';
  } catch {
    return false;
  }
}

/** Whether a separate print window can be opened at all (otherwise hide Print). */
export function canOpenPrintWindow(scope: unknown): boolean {
  return typeof (scope as BrowserScope | null)?.open === 'function';
}

/**
 * Print exactly `html` from a new window. 'blocked' when the browser refused
 * the window (pop-up blocker); nothing else on screen is ever printed.
 * Must be called synchronously from the tap so pop-up blockers allow it.
 */
export function printHtmlInNewWindow(scope: unknown, html: string): 'printed' | 'blocked' {
  const browser = scope as BrowserScope | null;
  let printWindow: PrintWindow | null = null;
  try {
    printWindow = browser?.open?.('', '_blank') ?? null;
  } catch {
    printWindow = null;
  }
  if (!printWindow) return 'blocked';
  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow?.close?.();
    printWindow.focus?.();
    printWindow.print();
    return 'printed';
  } catch {
    printWindow.close?.();
    return 'blocked';
  }
}
