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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devsfleet_app') THEN
    GRANT EXECUTE ON FUNCTION public.next_document_number(UUID, VARCHAR) TO devsfleet_app;
  END IF;
END $$;

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

-- -----------------------------------------------------------------------------
-- E-invoice documents
--
-- The event log is append-only. A document may change status and be retried
-- while it is still being fixed (queued / rejected / failed), but once it has
-- gone to the network (submitting / submitted / delivered) the XML, its hash,
-- the snapshot it was built from and its identity are frozen: a sent tax
-- invoice is corrected with a credit note, never edited. Documents are never
-- deleted.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_einvoice_events_immutable ON public.einvoice_events;
CREATE TRIGGER trg_einvoice_events_immutable
    BEFORE UPDATE OR DELETE ON public.einvoice_events
    FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION public.guard_einvoice_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'e-invoice documents cannot be deleted'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.uuid IS DISTINCT FROM NEW.uuid
       OR OLD.sale_id IS DISTINCT FROM NEW.sale_id
       OR OLD.doc_type IS DISTINCT FROM NEW.doc_type
       OR OLD.document_number IS DISTINCT FROM NEW.document_number THEN
        RAISE EXCEPTION 'an e-invoice document''s identity cannot change'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status IN ('submitting', 'submitted', 'delivered')
       AND (OLD.xml IS DISTINCT FROM NEW.xml
            OR OLD.xml_sha256 IS DISTINCT FROM NEW.xml_sha256
            OR OLD.snapshot IS DISTINCT FROM NEW.snapshot) THEN
        RAISE EXCEPTION 'a sent e-invoice cannot be changed. Issue a credit note instead.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_einvoice_documents_guard ON public.einvoice_documents;
CREATE TRIGGER trg_einvoice_documents_guard
    BEFORE UPDATE OR DELETE ON public.einvoice_documents
    FOR EACH ROW EXECUTE FUNCTION public.guard_einvoice_document();

-- -----------------------------------------------------------------------------
-- Same-tenant references
--
-- A foreign key proves the referenced row EXISTS. It does not prove it belongs
-- to the same business, and Postgres checks foreign keys without row-level
-- security — so a write naming another tenant's unit, brand, branch or variant
-- is accepted as long as the id is real. Between 2026-10-01 and 10-09 a dev
-- connection that bypassed RLS did exactly that: 302 products took another
-- tenant's units, and one sale was booked against another tenant's branch.
--
-- So every foreign key from one tenant-scoped table to another gets a trigger
-- that refuses a parent from a different tenant. It is generated from the
-- catalogue, like RLS, so a new table is covered by the next migrate without
-- anyone remembering to add it.
--
-- SECURITY DEFINER so the lookup can see the parent's real owner. With
-- FORCE ROW LEVEL SECURITY a non-superuser owner is still filtered, and then a
-- parent from another tenant is simply invisible — which is treated as the
-- same refusal: the foreign key guarantees the row exists, so a row that
-- exists and cannot be seen belongs to someone else.
--
-- Not applied to references to `users`. Those name a person who acted — the
-- platform operator behind an impersonation, for one — and naming them leaks
-- nothing of either business.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_same_tenant_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    child_column  text := TG_ARGV[0];
    parent_table  text := TG_ARGV[1];
    parent_column text := TG_ARGV[2];
    is_set        boolean;
    found_row     boolean;
    parent_tenant uuid;
BEGIN
    IF NEW.tenant_id IS NULL THEN
        RETURN NEW;
    END IF;

    EXECUTE format('SELECT ($1).%I IS NOT NULL', child_column) INTO is_set USING NEW;
    IF NOT is_set THEN
        RETURN NEW;
    END IF;

    EXECUTE format(
        'SELECT true, p.tenant_id FROM public.%I p WHERE p.%I = ($1).%I',
        parent_table, parent_column, child_column
    ) INTO found_row, parent_tenant USING NEW;

    IF found_row IS NULL OR (parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id) THEN
        RAISE EXCEPTION
            '%.% points at a % row that belongs to a different business',
            TG_TABLE_NAME, child_column, parent_table
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END
$$;

DO $$
DECLARE
    old RECORD;
    fk  RECORD;
BEGIN
    -- Dropped and rebuilt every run, so a foreign key that has since been
    -- removed does not leave a trigger behind checking a column that moved.
    FOR old IN
        SELECT t.tgname, c.relname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND t.tgname LIKE 'trg_same_tenant_%'
    LOOP
        EXECUTE format('DROP TRIGGER %I ON public.%I', old.tgname, old.relname);
    END LOOP;

    FOR fk IN
        SELECT child.relname  AS child_table,
               ca.attname     AS child_column,
               parent.relname AS parent_table,
               pa.attname     AS parent_column
        FROM pg_constraint con
        JOIN pg_class child   ON child.oid = con.conrelid
        JOIN pg_class parent  ON parent.oid = con.confrelid
        JOIN pg_namespace n   ON n.oid = child.relnamespace
        JOIN pg_attribute ca  ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
        JOIN pg_attribute pa  ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
        WHERE con.contype = 'f'
          AND n.nspname = 'public'
          AND array_length(con.conkey, 1) = 1
          AND parent.relname <> 'users'
          AND EXISTS (SELECT 1 FROM pg_attribute x
                      WHERE x.attrelid = child.oid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
          AND EXISTS (SELECT 1 FROM pg_attribute x
                      WHERE x.attrelid = parent.oid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
          -- A tenant row pointing at itself or its own tenant column is not a cross-reference.
          AND ca.attname <> 'tenant_id'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.assert_same_tenant_ref(%L, %L, %L)',
            left('trg_same_tenant_' || fk.child_column, 63),
            fk.child_column, fk.child_table,
            fk.child_column, fk.parent_table, fk.parent_column
        );
    END LOOP;
END $$;
