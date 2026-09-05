export function walletMembershipCopy(language: string) {
  return language.startsWith('es') ? {
    offline: 'Los datos guardados se leen sin internet en este dispositivo y con esta cuenta. No se sincronizan ni se supervisan para emergencias. Protege el acceso a tu dispositivo. Llamar, enviar y usar una impresora pueden requerir conexión.',
    read: 'Leer lo guardado', edit: 'Editar datos', empty: 'Aún no hay datos guardados. Agrega contactos y un plan práctico antes de necesitarlos.',
    choose: 'Elegir qué compartir o imprimir', selection: 'Nada está seleccionado. Marca solo los campos o resúmenes que quieras revelar. Revisa la vista previa antes de continuar.',
    preview: 'Vista previa exacta', share: 'Compartir este texto', print: 'Imprimir este texto', back: 'Cambiar selección', close: 'Cerrar', error: 'No se pudo abrir la opción. Inténtalo de nuevo.',
    note: 'Selección de mi Safety Wallet. No es un registro médico ni un servicio de monitoreo de emergencias. En peligro inmediato, llama al número local de emergencias (911 en EE. UU.).',
    priceUnavailable: 'Precio de la tienda no disponible', retryPrices: 'Reintentar precios', month: '/mes',
    benefits: 'Cómo usar tu membresía', free: 'La guía de crisis y los contactos de emergencia son gratuitos, sin suscripción.',
    essential: 'Essential: guarda tu plan en Safety Wallet, practica límites en Crisis Copilot y abre Chat para enviar preguntas al coach. Los mensajes no son atención de emergencia ni garantizan respuesta inmediata.',
    premier: 'Premier: además, solicita una sesión de video privado desde Support. Para revisar un plan, abre Crisis Copilot, elige y revisa lo que compartirás y solicita la revisión. Las sesiones requieren programación y disponibilidad.',
    service: 'El coaching individual por separado cuesta {rate}/hora. Essential puede elegir una llamada única de revisión del plan por {rate}; Premier incluye la revisión mediante su beneficio de video privado, sujeto a disponibilidad. El precio de la suscripción no es el cargo de un servicio separado.',
    wallet: 'Abrir Safety Wallet', copilot: 'Preparar o revisar un plan', chat: 'Abrir mensajes', manage: 'Restaurar compras o gestionar suscripción en Ajustes',
  } : {
    offline: 'Saved details can be read without internet on this device with this account. They are not synced or monitored for emergencies. Protect access to your device. Calling, sending and using a printer may require a connection.',
    read: 'Read saved essentials', edit: 'Edit details', empty: 'No saved details yet. Add contacts and a practical plan before you need them.',
    choose: 'Choose what to share or print', selection: 'Nothing is preselected. Select only the fields or incident summaries you want to disclose. Review the preview before continuing.',
    preview: 'Exact preview', share: 'Share this text', print: 'Print this text', back: 'Change selection', close: 'Close', error: 'Could not open that option. Please try again.',
    note: 'Selected details from my Safety Wallet. Not a medical record or emergency monitoring service. In immediate danger, call your local emergency number (911 in the U.S.).',
    priceUnavailable: 'Store price unavailable', retryPrices: 'Retry prices', month: '/month',
    benefits: 'How to use your membership', free: 'Crisis guidance and emergency contacts are free, with no subscription required.',
    essential: 'Essential: save your plan in Safety Wallet, practice boundaries in Crisis Copilot, and open Chat to send questions to your coach. Messaging is not emergency care and does not guarantee an immediate response.',
    premier: 'Premier: also request a private video session from Support. For a plan review, open Crisis Copilot, select and preview what to share, then request review. Sessions require scheduling and availability.',
    service: 'Separate 1:1 coaching is {rate}/hour. Essential can choose a one-time plan-review call for {rate}; Premier includes review through its private-video benefit, subject to availability. The subscription price is not a separate service charge.',
    wallet: 'Open Safety Wallet', copilot: 'Prepare or review a plan', chat: 'Open messages', manage: 'Restore purchases or manage subscription in Settings',
  };
}
