export const reminderCopy = {
  en: {
    title: 'Personal reminders', back: 'Back', intro: 'Optional daily reminders, only on this device. Choose what you want to return to and a local time. Nothing is enabled until you tap Enable reminder.',
    privacy: 'Notifications say only “A moment for you” and “Open the app when it suits you.” No names, topic, or personal text. Your device may still show the app name and icon. These reminders are not monitoring or urgent alerts; delivery depends on device settings.',
    categories: { boundary: 'Review a boundary', meeting: 'Attend a family meeting', learning: 'Resume learning', coaching: 'Prepare for coaching' },
    time: 'Daily time on this device (24-hour HH:MM)', timeHint: 'For example, 09:30 or 18:00.', enable: 'Enable reminder', resume: 'Resume reminder', pause: 'Pause', remove: 'Delete', active: 'Scheduled daily', paused: 'Paused', empty: 'No personal reminders yet.',
    web: 'Personal notifications are unavailable on the web. Use the iOS or Android app to opt in on that device.', signIn: 'Sign in to manage your device-local reminders.', loading: 'Checking device reminders…', retry: 'Retry device check',
    permission: 'Notification permission was not granted. No reminder was added. You can allow notifications in device settings, then try again.',
    failure: 'Could not confirm the change. A reminder may still be scheduled. Retry the device check; if cancellation keeps failing, turn off notifications for this app in device settings.',
    invalid: 'Enter a valid 24-hour time, such as 09:30.', manage: 'Pause a reminder before changing its time. After signing out or switching accounts, reminders must be resumed explicitly.',
    notificationTitle: 'A moment for you', notificationBody: 'Open the app when it suits you.',
  },
  es: {
    title: 'Recordatorios personales', back: 'Volver', intro: 'Recordatorios diarios opcionales, solo en este dispositivo. Elige qué quieres retomar y una hora local. Nada se activa hasta que toques Activar recordatorio.',
    privacy: 'Las notificaciones solo dicen “Un momento para ti” y “Abre la app cuando te venga bien”. Sin nombres, temas ni texto personal. Tu dispositivo puede mostrar el nombre y el icono de la app. No son vigilancia ni alertas urgentes; la entrega depende de los ajustes del dispositivo.',
    categories: { boundary: 'Revisar un límite', meeting: 'Asistir a una reunión familiar', learning: 'Retomar el aprendizaje', coaching: 'Prepararme para una sesión de orientación' },
    time: 'Hora diaria en este dispositivo (24 horas HH:MM)', timeHint: 'Por ejemplo, 09:30 o 18:00.', enable: 'Activar recordatorio', resume: 'Reanudar recordatorio', pause: 'Pausar', remove: 'Eliminar', active: 'Programado cada día', paused: 'En pausa', empty: 'Aún no hay recordatorios personales.',
    web: 'Las notificaciones personales no están disponibles en la web. Usa la app de iOS o Android para activarlas en ese dispositivo.', signIn: 'Inicia sesión para gestionar los recordatorios de este dispositivo.', loading: 'Comprobando los recordatorios del dispositivo…', retry: 'Volver a comprobar el dispositivo',
    permission: 'No se concedió permiso para las notificaciones. No se añadió ningún recordatorio. Puedes permitir las notificaciones en los ajustes del dispositivo e intentarlo de nuevo.',
    failure: 'No se pudo confirmar el cambio. Es posible que un recordatorio siga programado. Vuelve a comprobar el dispositivo; si la cancelación sigue fallando, desactiva las notificaciones de esta app en los ajustes del dispositivo.',
    invalid: 'Introduce una hora válida en formato de 24 horas, como 09:30.', manage: 'Pausa un recordatorio antes de cambiar su hora. Después de cerrar sesión o cambiar de cuenta, debes reanudar los recordatorios explícitamente.',
    notificationTitle: 'Un momento para ti', notificationBody: 'Abre la app cuando te venga bien.',
  },
} as const;
