CREATE OR REPLACE FUNCTION canalis_ledger_flow_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO transaction_events (
    id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
    amount_atomic, cumulative_atomic, authorized_delta_atomic, channel_address,
    request_id, authorization_id, payment_reference, source_flow_id, metadata,
    created_at_unix
  )
  SELECT
    'authorization:' || NEW.id,
    NEW.task_id,
    NEW.provider_id,
    'authorization',
    'offchain',
    NEW.status,
    COALESCE(p.protocol, t.mode),
    COALESCE(c.network, 'application'),
    t.mint,
    GREATEST(NEW.quoted_amount_atomic, 0),
    GREATEST(NEW.next_cumulative_atomic, 0),
    CASE
      WHEN NEW.authorization_id IS NOT NULL AND NEW.status IN ('authorized', 'fulfilled', 'failed')
        THEN GREATEST(NEW.next_cumulative_atomic - NEW.previous_cumulative_atomic, 0)
      ELSE 0
    END,
    c.channel_address,
    NEW.request_id,
    NEW.authorization_id,
    NEW.payment_reference,
    NEW.id,
    jsonb_strip_nulls(jsonb_build_object(
      'rejectionCode', NEW.rejection_code,
      'rejectionMessage', NEW.rejection_message,
      'errorMessage', NEW.error_message,
      'previousCumulativeAtomic', NEW.previous_cumulative_atomic::text
    )),
    NEW.created_at_unix
  FROM tasks t
  LEFT JOIN providers p ON p.id = NEW.provider_id
  LEFT JOIN channels c ON c.task_id = NEW.task_id AND c.provider_id = NEW.provider_id
  WHERE t.id = NEW.task_id
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_canalis_ledger_flow_insert
AFTER INSERT ON flows
FOR EACH ROW EXECUTE FUNCTION canalis_ledger_flow_insert();

CREATE OR REPLACE FUNCTION canalis_ledger_receipt_insert()
RETURNS TRIGGER AS $$
DECLARE
  next_cumulative NUMERIC(78, 0);
BEGIN
  SELECT f.next_cumulative_atomic INTO next_cumulative
  FROM flows f WHERE f.id = NEW.flow_id;

  INSERT INTO transaction_events (
    id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
    amount_atomic, cumulative_atomic, channel_address, receipt_hash, request_id,
    authorization_id, payment_reference, source_flow_id, metadata, created_at_unix
  )
  SELECT
    'receipt:' || NEW.flow_id,
    NEW.task_id,
    NEW.provider_id,
    'receipt',
    'offchain',
    'fulfilled',
    NEW.protocol,
    COALESCE(c.network, 'application'),
    NEW.mint,
    GREATEST(NEW.price_atomic, 0),
    GREATEST(COALESCE(next_cumulative, 0), 0),
    c.channel_address,
    NEW.response_hash,
    NEW.request_id,
    NEW.authorization_id,
    NEW.payment_reference,
    NEW.flow_id,
    COALESCE(NEW.protocol_metadata, '{}'::jsonb),
    NEW.timestamp_unix
  FROM tasks t
  LEFT JOIN channels c ON c.task_id = NEW.task_id AND c.provider_id = NEW.provider_id
  WHERE t.id = NEW.task_id
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_canalis_ledger_receipt_insert
AFTER INSERT ON receipts
FOR EACH ROW EXECUTE FUNCTION canalis_ledger_receipt_insert();

CREATE OR REPLACE FUNCTION canalis_ledger_settlement_insert()
RETURNS TRIGGER AS $$
DECLARE
  previous_settled NUMERIC(78, 0);
BEGIN
  SELECT COALESCE(MAX(cumulative_atomic), 0)
  INTO previous_settled
  FROM transaction_events
  WHERE task_id = NEW.task_id
    AND provider_id = NEW.provider_id
    AND event_type = 'settlement';

  INSERT INTO transaction_events (
    id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
    amount_atomic, cumulative_atomic, settled_delta_atomic, channel_address,
    signature, metadata, created_at_unix
  )
  SELECT
    'settlement:' || NEW.task_id || ':' || NEW.provider_id || ':' || NEW.transaction_signature,
    NEW.task_id,
    NEW.provider_id,
    'settlement',
    'onchain',
    'confirmed',
    CASE WHEN t.mode IN ('x402', 'mpp') THEN t.mode ELSE COALESCE(p.protocol, t.mode) END,
    COALESCE(c.network, 'solana'),
    t.mint,
    NEW.cumulative_amount_atomic,
    NEW.cumulative_amount_atomic,
    GREATEST(NEW.cumulative_amount_atomic - previous_settled, 0),
    c.channel_address,
    NEW.transaction_signature,
    jsonb_build_object('previousSettledAtomic', previous_settled::text, 'cumulativeSettlement', true),
    EXTRACT(EPOCH FROM NEW.created_at)::bigint
  FROM tasks t
  LEFT JOIN providers p ON p.id = NEW.provider_id
  LEFT JOIN channels c ON c.task_id = NEW.task_id AND c.provider_id = NEW.provider_id
  WHERE t.id = NEW.task_id
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_canalis_ledger_settlement_insert
AFTER INSERT ON settlements
FOR EACH ROW EXECUTE FUNCTION canalis_ledger_settlement_insert();

CREATE OR REPLACE FUNCTION canalis_ledger_channel_update()
RETURNS TRIGGER AS $$
DECLARE
  effective_protocol TEXT;
  task_mint TEXT;
  recovered NUMERIC(78, 0);
  failure_key TEXT;
BEGIN
  SELECT
    CASE WHEN t.mode IN ('x402', 'mpp') THEN t.mode ELSE COALESCE(p.protocol, t.mode) END,
    t.mint
  INTO effective_protocol, task_mint
  FROM tasks t
  LEFT JOIN providers p ON p.id = NEW.provider_id
  WHERE t.id = NEW.task_id;

  IF NEW.open_transaction_signature IS NOT NULL
     AND NEW.open_transaction_signature IS DISTINCT FROM OLD.open_transaction_signature THEN
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
      amount_atomic, cumulative_atomic, channel_address, signature, metadata,
      created_at_unix
    ) VALUES (
      'channel_open:' || NEW.task_id || ':' || NEW.provider_id || ':' || NEW.open_transaction_signature,
      NEW.task_id, NEW.provider_id, 'channel_open', 'onchain', 'confirmed',
      effective_protocol, NEW.network, task_mint, NEW.ceiling_atomic,
      NEW.cumulative_authorized_atomic, NEW.channel_address, NEW.open_transaction_signature,
      jsonb_build_object('programAddress', NEW.program_address), NEW.updated_at_unix
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  IF NEW.distribution_transaction_signature IS NOT NULL
     AND NEW.distribution_transaction_signature IS DISTINCT FROM OLD.distribution_transaction_signature THEN
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
      amount_atomic, cumulative_atomic, channel_address, signature, metadata,
      created_at_unix
    ) VALUES (
      'distribution:' || NEW.task_id || ':' || NEW.provider_id || ':' || NEW.distribution_transaction_signature,
      NEW.task_id, NEW.provider_id, 'distribution', 'onchain',
      CASE WHEN NEW.status IN ('distributed', 'recovered') THEN 'confirmed' ELSE NEW.status END,
      effective_protocol, NEW.network, task_mint, NEW.cumulative_authorized_atomic,
      NEW.cumulative_authorized_atomic, NEW.channel_address, NEW.distribution_transaction_signature,
      COALESCE(NEW.recovery_state, '{}'::jsonb), NEW.updated_at_unix
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  IF NEW.refund_transaction_signature IS NOT NULL
     AND NEW.refund_transaction_signature IS DISTINCT FROM OLD.refund_transaction_signature THEN
    recovered := GREATEST(NEW.ceiling_atomic - NEW.cumulative_authorized_atomic, 0);
    IF NEW.recovery_state ? 'refundedAtomic'
       AND (NEW.recovery_state->>'refundedAtomic') ~ '^[0-9]+$' THEN
      recovered := (NEW.recovery_state->>'refundedAtomic')::numeric;
    END IF;
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
      amount_atomic, cumulative_atomic, recovered_atomic, channel_address, signature,
      metadata, created_at_unix
    ) VALUES (
      'recovery:' || NEW.task_id || ':' || NEW.provider_id || ':' || NEW.refund_transaction_signature,
      NEW.task_id, NEW.provider_id, 'recovery', 'onchain', 'confirmed', effective_protocol,
      NEW.network, task_mint, recovered, NEW.cumulative_authorized_atomic, recovered,
      NEW.channel_address, NEW.refund_transaction_signature,
      COALESCE(NEW.recovery_state, '{}'::jsonb), NEW.updated_at_unix
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  IF (NEW.status = 'failed' OR COALESCE(NEW.recovery_state->>'stage', '') = 'finalization-ambiguous')
     AND NOT (
       OLD.status = 'failed'
       OR COALESCE(OLD.recovery_state->>'stage', '') = 'finalization-ambiguous'
     ) THEN
    failure_key := COALESCE(NULLIF(NEW.recovery_state->>'operationId', ''), NEW.updated_at_unix::text);
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network, mint,
      amount_atomic, cumulative_atomic, channel_address, metadata, created_at_unix
    ) VALUES (
      'failure:' || NEW.task_id || ':' || NEW.provider_id || ':' || failure_key,
      NEW.task_id, NEW.provider_id, 'failure', 'onchain', 'failed', effective_protocol,
      NEW.network, task_mint, 0, NEW.cumulative_authorized_atomic, NEW.channel_address,
      COALESCE(NEW.recovery_state, '{}'::jsonb), NEW.updated_at_unix
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_canalis_ledger_channel_update
AFTER UPDATE ON channels
FOR EACH ROW EXECUTE FUNCTION canalis_ledger_channel_update();
