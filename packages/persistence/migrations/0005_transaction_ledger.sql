CREATE TABLE transaction_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'authorization', 'receipt', 'channel_open', 'settlement',
    'distribution', 'recovery', 'failure'
  )),
  layer TEXT NOT NULL CHECK (layer IN ('offchain', 'onchain')),
  status TEXT NOT NULL,
  protocol TEXT NOT NULL,
  network TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount_atomic NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (amount_atomic >= 0),
  cumulative_atomic NUMERIC(78, 0) CHECK (cumulative_atomic IS NULL OR cumulative_atomic >= 0),
  authorized_delta_atomic NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (authorized_delta_atomic >= 0),
  settled_delta_atomic NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (settled_delta_atomic >= 0),
  recovered_atomic NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (recovered_atomic >= 0),
  channel_address TEXT,
  receipt_hash TEXT,
  signature TEXT,
  request_id TEXT,
  authorization_id TEXT,
  payment_reference TEXT,
  source_flow_id TEXT REFERENCES flows(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at_unix BIGINT NOT NULL
);

CREATE INDEX idx_transaction_events_task_created ON transaction_events(task_id, created_at_unix DESC);
CREATE INDEX idx_transaction_events_provider_created ON transaction_events(provider_id, created_at_unix DESC);
CREATE INDEX idx_transaction_events_type_created ON transaction_events(event_type, created_at_unix DESC);
CREATE INDEX idx_transaction_events_signature ON transaction_events(signature) WHERE signature IS NOT NULL;
CREATE INDEX idx_transaction_events_receipt_hash ON transaction_events(receipt_hash) WHERE receipt_hash IS NOT NULL;
CREATE INDEX idx_transaction_events_channel ON transaction_events(channel_address) WHERE channel_address IS NOT NULL;
CREATE INDEX idx_transaction_events_protocol_network ON transaction_events(protocol, network);

-- Backfill every historical route authorization. A failed provider call that was
-- already authorized still consumes the approved amount, matching Canalis' core
-- accounting rule that downstream failure does not roll spend backwards.
INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, authorized_delta_atomic, channel_address,
  request_id, authorization_id, payment_reference, source_flow_id, metadata,
  created_at_unix
)
SELECT
  'authorization:' || f.id,
  f.task_id,
  f.provider_id,
  'authorization',
  'offchain',
  f.status,
  COALESCE(r.protocol, p.protocol, t.mode),
  COALESCE(c.network, 'application'),
  t.mint,
  GREATEST(f.quoted_amount_atomic, 0),
  GREATEST(f.next_cumulative_atomic, 0),
  CASE
    WHEN f.authorization_id IS NOT NULL AND f.status IN ('authorized', 'fulfilled', 'failed')
      THEN GREATEST(f.next_cumulative_atomic - f.previous_cumulative_atomic, 0)
    ELSE 0
  END,
  c.channel_address,
  f.request_id,
  f.authorization_id,
  f.payment_reference,
  f.id,
  jsonb_strip_nulls(jsonb_build_object(
    'rejectionCode', f.rejection_code,
    'rejectionMessage', f.rejection_message,
    'errorMessage', f.error_message,
    'previousCumulativeAtomic', f.previous_cumulative_atomic::text
  )),
  f.created_at_unix
FROM flows f
JOIN tasks t ON t.id = f.task_id
LEFT JOIN receipts r ON r.flow_id = f.id
LEFT JOIN providers p ON p.id = f.provider_id
LEFT JOIN channels c ON c.task_id = f.task_id AND c.provider_id = f.provider_id
ON CONFLICT (id) DO NOTHING;

-- Receipts are separate proof events but intentionally carry no authorized
-- accounting delta so exporting authorization + receipt rows cannot double count.
INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, channel_address, receipt_hash, request_id,
  authorization_id, payment_reference, source_flow_id, metadata, created_at_unix
)
SELECT
  'receipt:' || r.flow_id,
  r.task_id,
  r.provider_id,
  'receipt',
  'offchain',
  'fulfilled',
  r.protocol,
  COALESCE(c.network, 'application'),
  r.mint,
  GREATEST(r.price_atomic, 0),
  GREATEST(f.next_cumulative_atomic, 0),
  c.channel_address,
  r.response_hash,
  r.request_id,
  r.authorization_id,
  r.payment_reference,
  r.flow_id,
  COALESCE(r.protocol_metadata, '{}'::jsonb),
  r.timestamp_unix
FROM receipts r
JOIN flows f ON f.id = r.flow_id
LEFT JOIN channels c ON c.task_id = r.task_id AND c.provider_id = r.provider_id
ON CONFLICT (id) DO NOTHING;

-- Existing channel opens did not previously keep a dedicated open timestamp.
-- Use the reservation creation time for the one-time backfill; all future writes
-- append the exact mutation timestamp through the persistence layer.
INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, channel_address, signature, metadata,
  created_at_unix
)
SELECT
  'channel_open:' || c.task_id || ':' || c.provider_id || ':' || c.open_transaction_signature,
  c.task_id,
  c.provider_id,
  'channel_open',
  'onchain',
  'confirmed',
  COALESCE(p.protocol, t.mode),
  c.network,
  t.mint,
  c.ceiling_atomic,
  c.cumulative_authorized_atomic,
  c.channel_address,
  c.open_transaction_signature,
  jsonb_build_object('backfilled', true, 'programAddress', c.program_address),
  c.created_at_unix
FROM channels c
JOIN tasks t ON t.id = c.task_id
LEFT JOIN providers p ON p.id = c.provider_id
WHERE c.open_transaction_signature IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Settlement rows are cumulative. Only the positive increase over the previous
-- cumulative settlement contributes to settled_delta_atomic; retry signatures
-- at the same cumulative value remain visible but add zero accounting impact.
WITH ordered_settlements AS (
  SELECT
    s.*,
    COALESCE(
      LAG(s.cumulative_amount_atomic) OVER (
        PARTITION BY s.task_id, s.provider_id ORDER BY s.created_at, s.transaction_signature
      ),
      0
    ) AS previous_settled_atomic
  FROM settlements s
)
INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, settled_delta_atomic, channel_address,
  signature, metadata, created_at_unix
)
SELECT
  'settlement:' || s.task_id || ':' || s.provider_id || ':' || s.transaction_signature,
  s.task_id,
  s.provider_id,
  'settlement',
  'onchain',
  'confirmed',
  COALESCE(p.protocol, t.mode),
  COALESCE(c.network, 'solana'),
  t.mint,
  s.cumulative_amount_atomic,
  s.cumulative_amount_atomic,
  GREATEST(s.cumulative_amount_atomic - s.previous_settled_atomic, 0),
  c.channel_address,
  s.transaction_signature,
  jsonb_build_object('previousSettledAtomic', s.previous_settled_atomic::text),
  EXTRACT(EPOCH FROM s.created_at)::bigint
FROM ordered_settlements s
JOIN tasks t ON t.id = s.task_id
LEFT JOIN providers p ON p.id = s.provider_id
LEFT JOIN channels c ON c.task_id = s.task_id AND c.provider_id = s.provider_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, channel_address, signature, metadata,
  created_at_unix
)
SELECT
  'distribution:' || c.task_id || ':' || c.provider_id || ':' || c.distribution_transaction_signature,
  c.task_id,
  c.provider_id,
  'distribution',
  'onchain',
  CASE WHEN c.status IN ('distributed', 'recovered') THEN 'confirmed' ELSE c.status END,
  COALESCE(p.protocol, t.mode),
  c.network,
  t.mint,
  c.cumulative_authorized_atomic,
  c.cumulative_authorized_atomic,
  c.channel_address,
  c.distribution_transaction_signature,
  COALESCE(c.recovery_state, '{}'::jsonb),
  c.updated_at_unix
FROM channels c
JOIN tasks t ON t.id = c.task_id
LEFT JOIN providers p ON p.id = c.provider_id
WHERE c.distribution_transaction_signature IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, recovered_atomic, channel_address, signature,
  metadata, created_at_unix
)
SELECT
  'recovery:' || c.task_id || ':' || c.provider_id || ':' || c.refund_transaction_signature,
  c.task_id,
  c.provider_id,
  'recovery',
  'onchain',
  'confirmed',
  COALESCE(p.protocol, t.mode),
  c.network,
  t.mint,
  CASE
    WHEN c.recovery_state ? 'refundedAtomic'
      AND (c.recovery_state->>'refundedAtomic') ~ '^[0-9]+$'
      THEN (c.recovery_state->>'refundedAtomic')::numeric
    ELSE GREATEST(c.ceiling_atomic - c.cumulative_authorized_atomic, 0)
  END,
  c.cumulative_authorized_atomic,
  CASE
    WHEN c.recovery_state ? 'refundedAtomic'
      AND (c.recovery_state->>'refundedAtomic') ~ '^[0-9]+$'
      THEN (c.recovery_state->>'refundedAtomic')::numeric
    ELSE GREATEST(c.ceiling_atomic - c.cumulative_authorized_atomic, 0)
  END,
  c.channel_address,
  c.refund_transaction_signature,
  COALESCE(c.recovery_state, '{}'::jsonb),
  c.updated_at_unix
FROM channels c
JOIN tasks t ON t.id = c.task_id
LEFT JOIN providers p ON p.id = c.provider_id
WHERE c.refund_transaction_signature IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO transaction_events (
  id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
  amount_atomic, cumulative_atomic, channel_address, metadata, created_at_unix
)
SELECT
  'failure:' || c.task_id || ':' || c.provider_id || ':' || c.updated_at_unix::text,
  c.task_id,
  c.provider_id,
  'failure',
  'onchain',
  'failed',
  COALESCE(p.protocol, t.mode),
  c.network,
  t.mint,
  0,
  c.cumulative_authorized_atomic,
  c.channel_address,
  COALESCE(c.recovery_state, '{}'::jsonb),
  c.updated_at_unix
FROM channels c
JOIN tasks t ON t.id = c.task_id
LEFT JOIN providers p ON p.id = c.provider_id
WHERE c.status = 'failed'
   OR COALESCE(c.recovery_state->>'stage', '') = 'finalization-ambiguous'
ON CONFLICT (id) DO NOTHING;
