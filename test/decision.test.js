const test = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('../src/decision');

const order = (fields = {}) => ({
  order_number: 'CMD-1',
  company: 'ACME',
  email: 'client@acme.fr',
  status: 'Commande_confirmee',
  delivery_date_to: '2026-12-10',
  ...fields,
});

const types = (orders, today, outbox = []) =>
  decide({ orders, outbox, today, internalEmail: 'ops@example.com' }).emails.map((e) => e.email_type);

const sent = (type) => ({ order_number: 'CMD-1', email_type: type, run_date: '2026-12-01' });

test('72h à J-3', () => {
  assert.deepEqual(types([order()], '2026-12-06'), []);
  assert.deepEqual(types([order()], '2026-12-07'), ['Email_72h_commande_confirmee']);
});

test('préparation avec ou sans retard', () => {
  const prep = order({ status: 'En_preparation' });
  assert.deepEqual(types([prep], '2026-12-02'), ['Email_commande_en_preparation_sans_retard']);
  assert.deepEqual(types([prep], '2026-12-08', [sent('Email_72h_commande_confirmee')]), ['Email_commande_en_preparation_en_retard']);
});

test('24h à J-1, pas si le 72h est déjà parti', () => {
  const prep = order({ status: 'En_preparation' });
  assert.deepEqual(types([prep], '2026-12-09', [sent('Email_commande_en_preparation_sans_retard')]), ['Email_24h_commande_en_preparation']);
  assert.deepEqual(types([prep], '2026-12-09', [sent('Email_72h_commande_confirmee'), sent('Email_commande_en_preparation_en_retard')]), []);
});

test('interne à J+10', () => {
  assert.deepEqual(types([order()], '2026-12-20', [sent('Email_72h_commande_confirmee')]), ['Email_interne_post_retard_10j']);
});

test('pas de doublon si on relance le même jour', () => {
  const first = decide({ orders: [order()], outbox: [], today: '2026-12-07', internalEmail: 'ops@example.com' });
  const outbox = first.emails.map((e) => ({ ...e, run_date: '2026-12-07' }));
  assert.deepEqual(types([order()], '2026-12-07', outbox), []);
});

test('erreurs de données', () => {
  const codes = decide({
    orders: [order({ order_number: '' }), order({ order_number: 'CMD-2', status: 'Annulee' }), order({ order_number: 'CMD-3', delivery_date_to: '' }), order({ order_number: 'CMD-4', email: '' })],
    outbox: [],
    today: '2026-12-07',
    internalEmail: 'ops@example.com',
  }).errors.map((e) => e.code);
  assert.deepEqual(codes, ['MISSING_ORDER_NUMBER', 'UNKNOWN_STATUS', 'INVALID_DELIVERY_DATE', 'INVALID_EMAIL']);
});
