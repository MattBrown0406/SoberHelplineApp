import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

export const monitoringEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    enabled: true,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    enableNativeCrashHandling: true,
    enableNativeNagger: false,
    tracesSampleRate: __DEV__ ? 0 : 0.05,
    profilesSampleRate: 0,
    maxBreadcrumbs: 25,
    beforeBreadcrumb(breadcrumb) {
      // Keep category/level for diagnostics, but never forward message bodies,
      // URLs, form values, or other arbitrary recovery-related data.
      return { category: breadcrumb.category, level: breadcrumb.level, timestamp: breadcrumb.timestamp };
    },
    beforeSend(event) {
      delete event.user;
      delete event.request;
      delete event.extra;
      delete event.message;
      delete event.transaction;
      delete event.tags;
      if (event.contexts) {
        event.contexts = {
          app: event.contexts.app,
          device: event.contexts.device,
          os: event.contexts.os,
        };
      }
      for (const exception of event.exception?.values ?? []) {
        exception.value = 'Application error';
        for (const frame of exception.stacktrace?.frames ?? []) {
          delete frame.vars;
          delete frame.context_line;
          delete frame.pre_context;
          delete frame.post_context;
          delete frame.abs_path;
        }
      }
      return event;
    },
  });
}

export function addAppBreadcrumb(category: string, level: Sentry.SeverityLevel = 'info'): void {
  if (!monitoringEnabled) return;
  Sentry.addBreadcrumb({ category, level });
}

export function captureAppError(error: unknown): void {
  if (!monitoringEnabled) return;
  Sentry.captureException(error);
}
