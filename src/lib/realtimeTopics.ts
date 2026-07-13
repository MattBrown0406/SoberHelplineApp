export function privateVideoChannelTopic(accountId: string, instanceId: string): string {
  return `member-video-${accountId}-${instanceId}`;
}
