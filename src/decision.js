const STATUSES = ['Commande_confirmee', 'En_preparation', 'Prepare', 'Livre'];

const E72H = 'Email_72h_commande_confirmee';
const PREP_OK = 'Email_commande_en_preparation_sans_retard';
const PREP_LATE = 'Email_commande_en_preparation_en_retard';
const E24H = 'Email_24h_commande_en_preparation';
const INTERNAL = 'Email_interne_post_retard_10j';

const TEMPLATES = {
  [E72H]: {
    subject: 'Votre commande aura un peu de retard',
    body: `Bonjour,

Nous revenons vers vous au sujet de votre commande {{order_number}}.

La livraison était initialement prévue avant le {{delivery_date_to}}, mais nous n’avons pas encore tout reçu de la part de nos fournisseurs.

Nous tenions à vous informer que nous continuons de suivre votre commande.
Nous faisons le maximum pour pouvoir vous livrer au plus vite, et nous reviendrons vers vous dès que nous aurons plus d’informations sur la date de livraison.

Merci pour votre patience,`,
  },
  [PREP_OK]: {
    subject: 'Votre commande arrive très vite !',
    body: `Bonjour,

Bonne nouvelle : votre commande {{order_number}} est maintenant en préparation.

Nous avons tout reçu de la part de nos fournisseurs. Nous faisons tout le nécessaire pour vous livrer au plus vite.

Vous devriez recevoir votre commande dans 3 jours.

Dès qu’elle sera remise au transporteur, vous recevrez un email avec le lien de suivi.

Merci pour votre patience,`,
  },
  [PREP_LATE]: {
    subject: 'Votre commande arrive bientôt !',
    body: `Bonjour,

Bonne nouvelle : nos équipes sont actuellement pleinement mobilisées pour finaliser la préparation de votre commande {{order_number}}, afin qu’elle puisse être expédiée dans les plus brefs délais.

La livraison était initialement prévue avant le {{delivery_date_to}}. Nous faisons le maximum pour que votre commande arrive au plus vite.

Vous recevrez automatiquement un email lorsque votre commande sera expédiée.

Il n’est pas nécessaire de relancer notre service suite à ce message : nous sommes directement informés de la situation et vous tiendrons au courant dès que possible.

Merci pour votre confiance.

Cordialement,`,
  },
  [E24H]: {
    subject: 'Votre commande arrive bientôt !',
    body: `Bonjour,

Nous avons constaté que la préparation de votre commande {{order_number}} n’est pas encore finalisée.

La livraison était initialement prévue le {{delivery_date_to}}. Elle sera probablement livrée avant 3 jours, mais nous tenions à vous informer de ce léger retard.

Dès lors que la commande sera expédiée, vous recevrez un email de la part de notre transporteur. Et vous pourrez suivre la commande avec un lien de suivi.

Merci pour votre patience,`,
  },
  [INTERNAL]: {
    subject: 'Ticket retard 10j — commande {{order_number}}',
    body: `Bonjour,

La commande {{order_number}} est en retard de plus de 10 jours (date limite initiale : {{delivery_date_to}}) et n’est toujours pas en préparation.

Statut actuel : {{status}}

Entreprise : {{company}}

Email client : {{email}}

Merci de traiter ce cas manuellement.`,
  },
};

const EMAIL_REGEX = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

function parisToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

function parseDate(value) {
  if (typeof value === 'number' && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function render(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name]);
}

function buildEmail(type, to, vars) {
  return {
    to,
    subject: render(TEMPLATES[type].subject, vars),
    body: render(TEMPLATES[type].body, vars),
    email_type: type,
    order_number: vars.order_number,
    dedup_key: `${vars.order_number}|${type}`,
  };
}

function decide({ orders, outbox, today, internalEmail }) {
  const sent = new Set();
  const contactedToday = new Set();
  for (const row of outbox) {
    const order = String(row.order_number ?? '').trim();
    if (!order || !row.email_type) continue;
    sent.add(`${order}|${row.email_type}`);
    if (row.run_date === today && row.email_type !== INTERNAL) contactedToday.add(order);
  }

  const occurrences = {};
  for (const row of orders) {
    const order = String(row.order_number ?? '').trim();
    if (order) occurrences[order] = (occurrences[order] || 0) + 1;
  }

  const emails = [];
  const errors = [];

  for (const row of orders) {
    const order = String(row.order_number ?? '').trim();
    const status = String(row.status ?? '').trim();
    const email = String(row.email ?? '').trim();
    const addError = (code, message) => errors.push({ order_number: order, row_number: row.row_number, code, message });

    if (!order && !status && !email) continue;
    if (!order) { addError('MISSING_ORDER_NUMBER', 'Numéro de commande vide'); continue; }
    if (occurrences[order] > 1) { addError('DUPLICATE_ORDER_NUMBER', 'Numéro de commande présent plusieurs fois'); continue; }
    if (!STATUSES.includes(status)) { addError('UNKNOWN_STATUS', `Statut inconnu : "${status}"`); continue; }
    if (status === 'Prepare' || status === 'Livre') continue;

    const deadline = parseDate(row.delivery_date_to);
    if (!deadline) { addError('INVALID_DELIVERY_DATE', `delivery_date_to vide ou invalide : "${row.delivery_date_to ?? ''}"`); continue; }

    const daysLeft = daysBetween(today, deadline);
    const has = (type) => sent.has(`${order}|${type}`);
    const vars = {
      order_number: order,
      delivery_date_to: deadline.split('-').reverse().join('/'),
      status,
      company: String(row.company ?? '').trim(),
      email,
    };

    let clientEmail = null;
    if (status === 'Commande_confirmee' && daysLeft <= 3 && !has(E72H)) {
      clientEmail = E72H;
    }
    if (status === 'En_preparation') {
      if (!has(PREP_OK) && !has(PREP_LATE)) clientEmail = has(E72H) ? PREP_LATE : PREP_OK;
      else if (daysLeft <= 1 && !has(E72H) && !has(E24H)) clientEmail = E24H;
    }

    if (clientEmail && !contactedToday.has(order)) {
      if (EMAIL_REGEX.test(email)) emails.push(buildEmail(clientEmail, email, vars));
      else addError('INVALID_EMAIL', `Email client vide ou invalide : "${email}"`);
    }

    if (status === 'Commande_confirmee' && daysLeft <= -10 && !has(INTERNAL)) {
      emails.push(buildEmail(INTERNAL, internalEmail, vars));
    }
  }

  return { emails, errors };
}

module.exports = { decide, parseDate, parisToday, daysBetween, TEMPLATES };
