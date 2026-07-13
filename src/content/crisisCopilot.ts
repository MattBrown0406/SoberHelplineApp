export type CrisisSituationKey =
  | 'overdose'
  | 'selfHarm'
  | 'violence'
  | 'driving'
  | 'missing'
  | 'demands'
  | 'treatment'
  | 'relapseHome'
  | 'familyConflict'
  | 'unsure';

export type CrisisSituation = {
  key: CrisisSituationKey;
  label: string;
  description: string;
  action: string[];
  say: string;
  dont: string[];
  next24: string[];
  next72: string[];
};

type CrisisLanguage = 'en' | 'es';

const EN: Record<CrisisSituationKey, CrisisSituation> = {
  overdose: {
    key: 'overdose', label: 'Possible overdose or poisoning', description: 'They may be unconscious, difficult to wake, or breathing abnormally.',
    action: ['Call 911 now and say that an overdose or poisoning may be involved.', 'Give naloxone if available and follow its package instructions.', 'Follow the dispatcher’s instructions and stay until responders arrive.'],
    say: '“I think this may be an overdose. I am calling 911 now.”',
    dont: ['Do not let them “sleep it off.”', 'Do not delay emergency help to avoid embarrassment or legal consequences.', 'Do not put yourself at risk handling unknown substances.'],
    next24: ['Write down what responders said and where your loved one was taken.', 'Secure medications and substances when it is safe and lawful to do so.', 'Choose one family contact to communicate verified updates.'],
    next72: ['Arrange professional assessment and overdose-prevention follow-up.', 'Replace naloxone and make sure family members know where it is.', 'Review the boundary and treatment plan before discharge or return home.'],
  },
  selfHarm: {
    key: 'selfHarm', label: 'Suicide or self-harm concern', description: 'They are threatening self-harm, have a plan, or you are worried they may act.',
    action: ['Call or text 988. Call 911 for immediate danger, an attempt, or available lethal means.', 'Stay nearby only if it is safe for you to do so.', 'Bring in another safe adult and follow crisis-responder instructions.'],
    say: '“I am taking you seriously. I am staying with you while we get professional help.”',
    dont: ['Do not promise secrecy.', 'Do not argue about whether they “mean it.”', 'Do not physically take a weapon or dangerous object if doing so puts you at risk.'],
    next24: ['Record the safety instructions given by professionals.', 'Confirm who will supervise and what follow-up is scheduled.', 'Secure lethal means only when it can be done safely.'],
    next72: ['Confirm the first clinical follow-up occurred.', 'Write a family response plan for renewed threats.', 'Make sure every decision-maker knows when to call 988 or 911.'],
  },
  violence: {
    key: 'violence', label: 'Violence, weapons, or threats', description: 'Someone may be assaulted, a weapon is involved, or the situation is escalating.',
    action: ['Move yourself and children to safety.', 'Call 911 from a safe location.', 'Create distance and let trained responders handle the confrontation.'],
    say: '“I am not going to argue or fight. I am moving to safety and calling for help.”',
    dont: ['Do not block an exit or physically restrain them.', 'Do not announce plans that increase danger.', 'Do not return until authorities say it is safe.'],
    next24: ['Document factual threats, injuries, and responder information.', 'Arrange a safe place for children and vulnerable adults.', 'Decide who, if anyone, will communicate with your loved one.'],
    next72: ['Create a written re-entry and contact boundary.', 'Seek legal or domestic-violence guidance when relevant.', 'Do not resume the old living arrangement without a safety review.'],
  },
  driving: {
    key: 'driving', label: 'Intoxicated and trying to drive', description: 'They have access to a vehicle or may endanger the public.',
    action: ['Do not ride with them or physically stand in front of the vehicle.', 'Call 911 if they drive or are about to drive while impaired.', 'Provide the vehicle description, location, and direction of travel if known.'],
    say: '“I will not give you keys or ride with you. If you drive impaired, I will call 911.”',
    dont: ['Do not wrestle for keys if that creates violence.', 'Do not follow in a dangerous chase.', 'Do not provide another vehicle or money for transportation without a safe plan.'],
    next24: ['Secure spare keys when safe and lawful.', 'Record what happened without exaggeration.', 'Tell the family the same vehicle-access boundary.'],
    next72: ['Create a written transportation boundary.', 'Review insurance, vehicle ownership, and legal options.', 'Connect transportation support only to recovery-safe destinations.'],
  },
  missing: {
    key: 'missing', label: 'Missing or unreachable', description: 'No one knows where they are, or a sudden disappearance raises safety concerns.',
    action: ['Check immediate medical and safety risks, recent messages, and last verified location.', 'Contact hospitals, authorities, or emergency services when circumstances justify it.', 'Use one family coordinator so information is verified and not duplicated.'],
    say: '“We are concerned about your safety. Please reply with your location and whether you need medical help.”',
    dont: ['Do not send money as proof of safety.', 'Do not flood social media with sensitive details before considering safety and privacy.', 'Do not treat an unverified message as confirmation they are safe.'],
    next24: ['Create a factual timeline of last verified contact.', 'List hospitals, agencies, and people contacted.', 'Preserve messages and relevant information.'],
    next72: ['Review what warning signs were missed.', 'Set a future check-in and missing-person response plan.', 'Discuss professional assessment when contact resumes.'],
  },
  demands: {
    key: 'demands', label: 'Demanding money, housing, keys, or transportation', description: 'The family is being pressured to rescue, fund, or absorb consequences.',
    action: ['Pause before answering and align with one family decision-maker.', 'Offer recovery-supportive help without cash, keys, or an unsafe place to stay.', 'End the conversation if threats or intimidation begin.'],
    say: '“I love you. I will support recovery, food, or treatment directly. I will not provide cash, keys, or a rescue that supports the addiction.”',
    dont: ['Do not negotiate against yourself because the pressure is uncomfortable.', 'Do not make secret side deals with one family member.', 'Do not threaten a consequence the family will not keep.'],
    next24: ['Write down the request and the response.', 'Confirm every family decision-maker is using the same boundary.', 'Offer one concrete recovery-supportive option.'],
    next72: ['Review whether the boundary was kept.', 'Remove easy access to money, vehicles, or accounts when appropriate.', 'Prepare the response to the next predictable request.'],
  },
  treatment: {
    key: 'treatment', label: 'Refusing or leaving treatment', description: 'They are rejecting help, threatening to leave, or asking the family to undo consequences.',
    action: ['Ask the provider what is actually happening and what options remain.', 'Keep the family’s treatment and housing boundary consistent.', 'Prepare a safe “yes” plan and a clear refusal plan.'],
    say: '“The decision is yours. Our support remains available for recovery, but we will not make leaving treatment easier.”',
    dont: ['Do not argue the entire history again.', 'Do not offer home, money, or transportation before the family aligns.', 'Do not confuse loving them with removing every consequence.'],
    next24: ['Confirm facts directly with authorized providers when consent allows.', 'Write the family’s refusal and return-home plan.', 'Identify one treatment option that can act quickly if they say yes.'],
    next72: ['Verify whether the handoff actually occurred.', 'Confirm transportation, medication, housing, and first follow-up.', 'Escalate unresolved care gaps instead of assuming a referral is enough.'],
  },
  relapseHome: {
    key: 'relapseHome', label: 'Relapse or asking to return home', description: 'The family must decide what support is safe and what conditions apply.',
    action: ['Screen for overdose, suicide, violence, and medical danger first.', 'Do not make a housing decision in the middle of intimidation or intoxication.', 'State the conditions for recovery-supportive help clearly.'],
    say: '“I love you. Returning home requires a safe, recovery-focused plan. We will discuss it when you are sober and the family is aligned.”',
    dont: ['Do not call relapse harmless or inevitable.', 'Do not allow children to absorb an unsafe return.', 'Do not agree to vague promises without a concrete plan.'],
    next24: ['Document what happened and what immediate support was offered.', 'Align the household before discussing return.', 'Identify assessment, detox, or treatment options.'],
    next72: ['Confirm the next level of care and actual arrival.', 'Set written home, contact, and financial boundaries.', 'Schedule a family debrief and prevention-plan review.'],
  },
  familyConflict: {
    key: 'familyConflict', label: 'The family is escalating or divided', description: 'Relatives are arguing, rescuing independently, or sending conflicting messages.',
    action: ['Stop the group argument and choose one temporary coordinator.', 'Agree on what no one will do tonight.', 'Move detailed discussion to a scheduled family call when everyone is calmer.'],
    say: '“We do not have to solve everything tonight. For now, we will keep everyone safe, make no secret deals, and speak with one voice.”',
    dont: ['Do not recruit your loved one into the family disagreement.', 'Do not shame the relative who is struggling to hold a boundary.', 'Do not make irreversible decisions in an angry group text.'],
    next24: ['Write one shared boundary and name the communicator.', 'List unresolved disagreements without debating them.', 'Schedule a focused family alignment conversation.'],
    next72: ['Assign roles for the next predictable crisis.', 'Decide how money, housing, and treatment decisions will be approved.', 'Request professional family guidance if alignment remains stuck.'],
  },
  unsure: {
    key: 'unsure', label: 'I’m not sure—help me assess it', description: 'Start with immediate danger questions, then choose the closest pattern.',
    action: ['Answer the safety questions honestly.', 'If your instincts say someone may be in immediate danger, call emergency services.', 'Focus on the next safe action, not solving the entire addiction tonight.'],
    say: '“I want to understand what is happening. First, I need to know whether anyone is in immediate danger.”',
    dont: ['Do not minimize danger because you are uncertain.', 'Do not confront someone alone to gather proof.', 'Do not let fear force an immediate financial or housing decision.'],
    next24: ['Write a factual timeline and list unanswered safety questions.', 'Choose one family coordinator.', 'Seek professional guidance for the unclear parts.'],
    next72: ['Update the safety plan with what you learned.', 'Choose a boundary the family can keep.', 'Prepare for the next likely escalation.'],
  },
};

const ES: Record<CrisisSituationKey, CrisisSituation> = {
  overdose: { ...EN.overdose, label: 'Posible sobredosis o envenenamiento', description: 'Puede estar inconsciente, no despertar o respirar de forma anormal.', action: ['Llama al 911 ahora y di que puede haber una sobredosis o envenenamiento.', 'Administra naloxona si está disponible y sigue las instrucciones del empaque.', 'Sigue las instrucciones del operador y quédate hasta que lleguen los servicios.'], say: '“Creo que puede ser una sobredosis. Voy a llamar al 911 ahora.”', dont: ['No dejes que “lo duerma”.', 'No retrases la ayuda por vergüenza o miedo a consecuencias legales.', 'No te pongas en riesgo manipulando sustancias desconocidas.'], next24: ['Anota lo que dijeron los servicios y adónde llevaron a tu ser querido.', 'Asegura medicamentos y sustancias cuando sea seguro y legal.', 'Elige un contacto familiar para compartir información verificada.'], next72: ['Coordina evaluación profesional y seguimiento de prevención.', 'Reemplaza la naloxona y confirma que la familia sepa dónde está.', 'Revisa límites y tratamiento antes del alta o regreso a casa.'] },
  selfHarm: { ...EN.selfHarm, label: 'Riesgo de suicidio o autolesión', description: 'Amenaza con hacerse daño, tiene un plan o temes que pueda actuar.', action: ['Llama o escribe al 988. Llama al 911 ante peligro inmediato, un intento o medios letales disponibles.', 'Quédate cerca solo si es seguro para ti.', 'Trae a otro adulto seguro y sigue las instrucciones de profesionales.'], say: '“Te tomo en serio. Me quedaré contigo mientras conseguimos ayuda profesional.”', dont: ['No prometas guardar el secreto.', 'No discutas si “lo dice en serio”.', 'No intentes quitar un arma si eso te pone en peligro.'], next24: ['Registra las instrucciones de seguridad de los profesionales.', 'Confirma quién supervisará y qué seguimiento está programado.', 'Asegura medios letales solo cuando pueda hacerse con seguridad.'], next72: ['Confirma que ocurrió el primer seguimiento clínico.', 'Escribe un plan familiar para nuevas amenazas.', 'Asegura que todos sepan cuándo llamar al 988 o 911.'] },
  violence: { ...EN.violence, label: 'Violencia, armas o amenazas', description: 'Alguien puede ser agredido, hay un arma o la situación está escalando.', action: ['Lleva a los niños y a ti a un lugar seguro.', 'Llama al 911 desde un lugar seguro.', 'Crea distancia y deja la confrontación a personal capacitado.'], say: '“No voy a discutir ni pelear. Me moveré a un lugar seguro y pediré ayuda.”', dont: ['No bloquees una salida ni sujetes físicamente.', 'No anuncies planes que aumenten el peligro.', 'No regreses hasta que las autoridades digan que es seguro.'], next24: ['Documenta amenazas, lesiones y datos de los servicios.', 'Organiza un lugar seguro para niños y adultos vulnerables.', 'Decide quién, si alguien, se comunicará.'], next72: ['Crea límites escritos para contacto y regreso.', 'Busca orientación legal o de violencia doméstica cuando corresponda.', 'No restaures la vivienda anterior sin revisar la seguridad.'] },
  driving: { ...EN.driving, label: 'Intoxicado/a e intentando manejar', description: 'Tiene acceso a un vehículo o puede poner al público en peligro.', action: ['No subas al auto ni te pares físicamente delante.', 'Llama al 911 si conduce o está por conducir intoxicado/a.', 'Da descripción, ubicación y dirección del vehículo si las conoces.'], say: '“No te daré las llaves ni viajaré contigo. Si conduces intoxicado/a, llamaré al 911.”', dont: ['No luches por las llaves si puede generar violencia.', 'No lo/la sigas en una persecución peligrosa.', 'No proporciones otro vehículo o dinero sin un plan seguro.'], next24: ['Asegura llaves de repuesto cuando sea seguro y legal.', 'Registra lo ocurrido sin exagerar.', 'Comunica el mismo límite a toda la familia.'], next72: ['Crea un límite escrito de transporte.', 'Revisa seguro, propiedad y opciones legales.', 'Ofrece transporte solo a destinos seguros para la recuperación.'] },
  missing: { ...EN.missing, label: 'Desaparecido/a o sin contacto', description: 'Nadie sabe dónde está o una desaparición repentina preocupa.', action: ['Revisa riesgos médicos, mensajes recientes y última ubicación verificada.', 'Contacta hospitales, autoridades o emergencias cuando las circunstancias lo justifiquen.', 'Usa un coordinador familiar para verificar la información.'], say: '“Nos preocupa tu seguridad. Responde con tu ubicación y dinos si necesitas ayuda médica.”', dont: ['No envíes dinero como prueba de seguridad.', 'No publiques detalles sensibles sin considerar seguridad y privacidad.', 'No tomes un mensaje no verificado como prueba de que está bien.'], next24: ['Crea una cronología de último contacto verificado.', 'Lista hospitales, agencias y personas contactadas.', 'Conserva mensajes e información relevante.'], next72: ['Revisa señales de advertencia.', 'Establece un plan futuro de contacto y desaparición.', 'Habla de evaluación profesional cuando reaparezca.'] },
  demands: { ...EN.demands, label: 'Exige dinero, vivienda, llaves o transporte', description: 'Presiona a la familia para rescatarlo/a o absorber consecuencias.', action: ['Pausa antes de responder y alínea la decisión con una persona.', 'Ofrece ayuda que apoye la recuperación sin efectivo, llaves ni vivienda insegura.', 'Termina la conversación si comienzan amenazas.'], say: '“Te amo. Apoyaré recuperación, comida o tratamiento directamente. No daré efectivo, llaves ni un rescate que apoye la adicción.”', dont: ['No negocies contra ti por incomodidad.', 'No hagas acuerdos secretos.', 'No amenaces una consecuencia que la familia no sostendrá.'], next24: ['Anota la solicitud y respuesta.', 'Confirma que todos usan el mismo límite.', 'Ofrece una opción concreta que apoye recuperación.'], next72: ['Revisa si el límite se sostuvo.', 'Reduce acceso fácil a dinero, vehículos o cuentas cuando corresponda.', 'Prepara la respuesta a la próxima solicitud.'] },
  treatment: { ...EN.treatment, label: 'Rechaza o abandona tratamiento', description: 'Rechaza ayuda, amenaza con irse o pide que la familia quite consecuencias.', action: ['Pregunta al proveedor qué ocurre y qué opciones quedan.', 'Mantén consistentes los límites de tratamiento y vivienda.', 'Prepara un plan seguro para un “sí” y un plan claro ante el rechazo.'], say: '“La decisión es tuya. Nuestro apoyo sigue disponible para recuperación, pero no facilitaremos que abandones tratamiento.”', dont: ['No repitas toda la historia.', 'No ofrezcas casa, dinero o transporte antes de alinear a la familia.', 'No confundas amar con eliminar toda consecuencia.'], next24: ['Confirma hechos con proveedores autorizados cuando el consentimiento lo permita.', 'Escribe el plan ante rechazo y regreso a casa.', 'Identifica una opción de tratamiento rápida.'], next72: ['Verifica que la transición realmente ocurrió.', 'Confirma transporte, medicamentos, vivienda y primera cita.', 'Escala brechas de atención en vez de asumir que una referencia basta.'] },
  relapseHome: { ...EN.relapseHome, label: 'Recaída o solicitud de volver a casa', description: 'La familia debe decidir qué apoyo es seguro y qué condiciones aplican.', action: ['Evalúa primero sobredosis, suicidio, violencia y peligro médico.', 'No decidas vivienda en medio de intimidación o intoxicación.', 'Expresa claramente las condiciones de ayuda orientada a recuperación.'], say: '“Te amo. Volver a casa requiere un plan seguro y de recuperación. Lo hablaremos cuando estés sobrio/a y la familia esté alineada.”', dont: ['No llames la recaída inofensiva o inevitable.', 'No expongas a niños a un regreso inseguro.', 'No aceptes promesas vagas sin plan concreto.'], next24: ['Documenta lo ocurrido y la ayuda ofrecida.', 'Alinea el hogar antes de hablar del regreso.', 'Identifica evaluación, desintoxicación o tratamiento.'], next72: ['Confirma el nivel de atención y la llegada real.', 'Establece límites escritos de hogar, contacto y dinero.', 'Programa revisión familiar y de prevención.'] },
  familyConflict: { ...EN.familyConflict, label: 'La familia está escalando o dividida', description: 'Hay discusiones, rescates independientes o mensajes contradictorios.', action: ['Detén la discusión y elige un coordinador temporal.', 'Acuerden lo que nadie hará esta noche.', 'Muevan la conversación a una llamada programada cuando estén más tranquilos.'], say: '“No tenemos que resolver todo esta noche. Mantendremos la seguridad, no haremos acuerdos secretos y hablaremos con una sola voz.”', dont: ['No metas a tu ser querido en la disputa familiar.', 'No avergüences a quien lucha por mantener un límite.', 'No tomes decisiones irreversibles en un chat enojado.'], next24: ['Escribe un límite compartido y nombra al comunicador.', 'Lista desacuerdos sin debatirlos.', 'Programa una conversación de alineación.'], next72: ['Asigna roles para la próxima crisis.', 'Decide cómo aprobar dinero, vivienda y tratamiento.', 'Pide orientación profesional si siguen bloqueados.'] },
  unsure: { ...EN.unsure, label: 'No estoy seguro/a—ayúdame a evaluar', description: 'Comienza con preguntas de peligro y luego elige el patrón más cercano.', action: ['Responde honestamente las preguntas de seguridad.', 'Si tu instinto dice que hay peligro inmediato, llama a emergencias.', 'Enfócate en la próxima acción segura, no en resolver toda la adicción.'], say: '“Quiero entender qué ocurre. Primero necesito saber si alguien está en peligro inmediato.”', dont: ['No minimices el peligro por incertidumbre.', 'No confrontes a solas para conseguir pruebas.', 'No dejes que el miedo fuerce una decisión inmediata de dinero o vivienda.'], next24: ['Escribe una cronología y preguntas sin respuesta.', 'Elige un coordinador familiar.', 'Busca orientación profesional.'], next72: ['Actualiza el plan de seguridad.', 'Elige un límite que la familia pueda sostener.', 'Prepárate para la próxima escalada probable.'] },
};

export type CrisisRiskLevel = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

export function assessCrisisRisk(immediateDanger: boolean, activeConcernCount: number): CrisisRiskLevel {
  if (immediateDanger) return 'RED';
  if (activeConcernCount >= 2) return 'ORANGE';
  if (activeConcernCount === 1) return 'YELLOW';
  return 'GREEN';
}

export const CRISIS_SITUATION_ORDER: CrisisSituationKey[] = ['overdose', 'selfHarm', 'violence', 'driving', 'missing', 'demands', 'treatment', 'relapseHome', 'familyConflict', 'unsure'];

export function getCrisisSituations(language: string): Record<CrisisSituationKey, CrisisSituation> {
  return language.toLowerCase().startsWith('es') ? ES : EN;
}
