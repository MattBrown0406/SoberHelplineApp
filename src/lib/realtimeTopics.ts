export function privateVideoChannelTopic(accountId: string, instanceId: string): string {
  return `member-video-${accountId}-${instanceId}`;
}

export function threadChannelTopic(threadId: string, instanceId: string): string {
  return `thread-${threadId}-${instanceId}`;
}
