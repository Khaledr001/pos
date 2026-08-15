-- =============================================================================
-- TRIGGERS
--
-- Re-run after every migration (scripts/migrate.ts does this automatically).
-- Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at
--
-- Maintained in the database, not the application, because the POS sync engine
-- pages through changes ordered by updated_at. A bulk price update run as raw
-- SQL, or a manual fix during support, would otherwise never reach the
-- terminals — the row would change and no device would learn about it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Guard against a no-op UPDATE bumping the timestamp and causing the whole
    -- catalogue to re-sync after a migration that rewrites every row.
    IF row_to_json(NEW)::text IS DISTINCT FROM row_to_json(OLD)::text THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END
$$;

DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'updated_at'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I',
            tbl.table_name
        );
        EXECUTE format(
            'CREATE TRIGGER trg_set_updated_at
               BEFORE UPDATE ON public.%I
               FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
            tbl.table_name
        );
    END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Gapless document numbering
--
-- Not a Postgres SEQUENCE: sequences are non-transactional, so a rolled-back
-- sale would permanently burn INV-2026-000042 and leave a hole in the invoice
-- series. Tax authorities ask about holes.
--
-- This locks one counter row, so numbering serialises within a single
-- (tenant, branch, kind, year) — at retail counter throughput that is not a
-- real constraint, and it is the price of a gapless series.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_document_number(
    p_tenant_id UUID,
    p_key       VARCHAR
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_value BIGINT;
BEGIN
    INSERT INTO public.document_sequences (tenant_id, key, current_value)
    VALUES (p_tenant_id, p_key, 1)
    ON CONFLICT (tenant_id, key)
    DO UPDATE SET current_value = document_sequences.current_value + 1,
                  updated_at    = now()
    RETURNING current_value INTO v_value;

    RETURN v_value;
END
$$;

GRANT EXECUTE ON FUNCTION public.next_document_number(UUID, VARCHAR) TO devsfleet_app;

-- -----------------------------------------------------------------------------
-- Immutability guards
--
-- A completed sale and a stock ledger entry are financial records. Blocking
-- UPDATE and DELETE at the database level means an ORM bug, a careless script
-- or a support session cannot quietly rewrite history — corrections have to go
-- through a return, a void, or a compensating adjustment, all of which leave a
-- trail.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'ledger rows are immutable: % on %.% is not allowed. Write a compensating entry instead.',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END
$$;

DROP TRIGGER IF EXISTS trg_inventory_tx_immutable ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_tx_immutable
    BEFORE UPDATE OR DELETE ON public.inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_price_history_immutable ON public.price_history;
CREATE TRIGGER trg_price_history_immutable
    BEFORE UPDATE OR DELETE ON public.price_history
    FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON public.audit_log;
CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();
