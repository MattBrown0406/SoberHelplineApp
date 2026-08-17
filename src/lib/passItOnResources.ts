export type ResourceLanguage = 'en' | 'es';

export const MONDAY_FAMILY_CALL_URL = 'https://soberhelpline.com/monday-zoom-registration';

export function resourceLanguage(language: string): ResourceLanguage {
  return language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function isResourceActionCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || /printing did not complete/i.test(error.message);
}

export function mondayCallShareMessage(language: ResourceLanguage): string {
  if (language === 'es') {
    return [
      'Quiero compartir contigo un recurso gratuito para familias afectadas por la adicción.',
      '',
      'The Family Squares — llamada gratuita de apoyo familiar',
      'Lunes a las 7:00 p. m. del Pacífico · por Zoom',
      '',
      `Inscripción: ${MONDAY_FAMILY_CALL_URL}`,
      '',
      'No tienes que resolverlo todo a solas.',
    ].join('\n');
  }

  return [
    'I wanted to share a free resource for families affected by addiction.',
    '',
    'The Family Squares — free family support call',
    'Mondays at 7:00 PM Pacific · on Zoom',
    '',
    `Register: ${MONDAY_FAMILY_CALL_URL}`,
    '',
    'You do not have to figure this out alone.',
  ].join('\n');
}

export function boundaryCardHtml(language: ResourceLanguage): string {
  const copy = language === 'es' ? SPANISH_CARD : ENGLISH_CARD;
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: Letter portrait; margin: 0.45in; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #22302f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .sheet { min-height: 9.9in; border: 3px solid #1f746f; border-radius: 24px; padding: 0.45in; display: flex; flex-direction: column; }
  .brand { color: #1f746f; font-size: 17px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase; }
  h1 { margin: 18px 0 8px; color: #22302f; font-size: 34px; line-height: 1.08; }
  .truth { margin: 0 0 20px; padding: 16px 18px; background: #e8f3f1; border-left: 5px solid #1f746f; border-radius: 10px; font-size: 18px; line-height: 1.45; font-weight: 600; }
  .formula { margin: 2px 0 16px; font-size: 16px; line-height: 1.45; color: #445250; }
  .prompt { margin-top: 15px; font-size: 15px; font-weight: 700; color: #22302f; }
  .line { height: 56px; border-bottom: 1.5px solid #879694; }
  .tips { margin-top: 22px; padding: 15px 18px; background: #fff6e8; border-radius: 12px; font-size: 14px; line-height: 1.5; }
  .safety { margin-top: 12px; color: #8b3a32; font-size: 12px; line-height: 1.4; }
  .footer { margin-top: auto; padding-top: 20px; border-top: 1px solid #d7dfdd; text-align: center; }
  .call { font-size: 16px; font-weight: 800; color: #1f746f; }
  .schedule { margin: 5px 0; font-size: 13px; }
  .url { font-size: 13px; font-weight: 700; color: #22302f; }
  .note { margin-top: 8px; font-size: 10px; color: #66726f; }
</style>
</head>
<body>
  <main class="sheet">
    <div class="brand">Sober Helpline</div>
    <h1>${copy.title}</h1>
    <p class="truth">${copy.truth}</p>
    <p class="formula">${copy.formula}</p>
    <div class="prompt">${copy.when}</div><div class="line"></div>
    <div class="prompt">${copy.action}</div><div class="line"></div>
    <div class="prompt">${copy.followThrough}</div><div class="line"></div>
    <div class="tips"><strong>${copy.keepTitle}</strong><br>${copy.keepBody}</div>
    <div class="safety">${copy.safety}</div>
    <footer class="footer">
      <div class="call">${copy.call}</div>
      <div class="schedule">${copy.schedule}</div>
      <div class="url">${MONDAY_FAMILY_CALL_URL}</div>
      <div class="note">${copy.disclaimer}</div>
    </footer>
  </main>
</body>
</html>`;
}

const ENGLISH_CARD = {
  title: 'A boundary I can hold',
  truth: 'A boundary is what I will do to protect safety, dignity, and recovery. It is not a way to control another person.',
  formula: 'Keep it observable, short, and focused on your own action.',
  when: 'When…',
  action: 'I will…',
  followThrough: 'If it happens again, I will follow through by…',
  keepTitle: 'Keep it steady:',
  keepBody: 'Say it once. Do not debate it while anyone is intoxicated. Choose only a response you can carry out safely.',
  safety: 'If anyone may be in immediate danger or you suspect an overdose, call 911. A boundary card does not replace emergency or clinical help.',
  call: 'Free Monday family support call',
  schedule: 'The Family Squares · Mondays · 7:00 PM Pacific · Zoom',
  disclaimer: 'Family education and peer support from Sober Helpline. Not medical or emergency care.',
} as const;

const SPANISH_CARD = {
  title: 'Un límite que puedo mantener',
  truth: 'Un límite es lo que yo haré para proteger la seguridad, la dignidad y la recuperación. No es una manera de controlar a otra persona.',
  formula: 'Hazlo observable, breve y enfocado en tu propia acción.',
  when: 'Cuando…',
  action: 'Yo haré…',
  followThrough: 'Si vuelve a ocurrir, cumpliré mi límite al…',
  keepTitle: 'Mantén la calma:',
  keepBody: 'Dilo una vez. No lo discutas mientras alguien esté intoxicado. Elige solo una respuesta que puedas cumplir de forma segura.',
  safety: 'Si alguien puede estar en peligro inmediato o sospechas una sobredosis, llama al 911. Esta tarjeta no reemplaza ayuda médica, clínica ni de emergencia.',
  call: 'Llamada gratuita de apoyo familiar los lunes',
  schedule: 'The Family Squares · lunes · 7:00 p. m. del Pacífico · Zoom',
  disclaimer: 'Educación familiar y apoyo entre pares de Sober Helpline. No es atención médica ni de emergencia.',
} as const;
