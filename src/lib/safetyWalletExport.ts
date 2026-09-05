import { DEFAULT_SAFETY_PLAN, type SafetyPlan, type SafetyIncident } from './safetyWallet';
export type WalletExportItem = { id: string; label: string; value: string };
export function walletExportItems(plan: SafetyPlan, incidents: SafetyIncident[], label: (key: string) => string): WalletExportItem[] {
  return [
    ...Object.keys(DEFAULT_SAFETY_PLAN).flatMap((key) => {
      const value = plan[key as keyof SafetyPlan].trim();
      return value ? [{ id: `plan:${key}`, label: label(`wallet.fields.${key}`), value }] : [];
    }),
    ...incidents.map((incident) => ({ id: `incident:${incident.id}`, label: `${label('wallet.recentIncidents')} · ${incident.createdAt}`, value: incident.summary })),
  ];
}
/** Selection is an allowlist; no implicit full-wallet fallback. */
export function selectedWalletText(items: WalletExportItem[], selected: string[], title: string, note: string): string {
  const chosen = items.filter((item) => selected.includes(item.id));
  if (!chosen.length) return '';
  return [title, ...chosen.map((item) => `${item.label}: ${item.value}`), note].join('\n\n');
}
export function walletPrintHtml(preview: string): string {
  const escaped = preview.replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]!));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:16px sans-serif;line-height:1.6">${escaped}</pre></body></html>`;
}
