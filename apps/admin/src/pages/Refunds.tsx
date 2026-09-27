import { formatInstantDate, formatPiastres } from '@tpa/core';
import type { Piastres } from '@tpa/types';
import { AlertTriangle, ChevronDown, ChevronRight, Undo2 } from 'lucide-react';
import { useState } from 'react';

import type { RefundRow } from '../lib/api';
import { daysOutstanding, markPurchaseRefunded, outstandingTotal, REFUND_ERROR } from '../data/refunds';
import { useRefunds } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import type { Column } from '../ui';
import { Button, ErrorView, LoadingView, Modal, PageHeader, Table } from '../ui';
import styles from './Refunds.module.css';

/** A refund is "getting old" after a week — enough to colour, not enough to alarm. */
const STALE_DAYS = 7;

/**
 * Refunds — money Paymob captured that could not be turned into credits (068).
 *
 * ── why its own page, and not a Dashboard section ──
 * The Dashboard is a read-only instrument panel: every number on it is a fact
 * about the business, and nothing on it commits anything. This is a WORK QUEUE
 * with a write attached, and it needs a sidebar badge — a badge has to point at a
 * destination, and "scroll down the Dashboard" is not one. It is also the same
 * shape as Credit requests (a queue, a count, one action per row), so giving it
 * the same shape of screen means the owner already knows how to use it.
 *
 * It should almost always be empty. That is the point: the badge is the whole
 * interface most days, and an empty page is a good answer.
 */
export function Refunds() {
  const { now } = useSession();
  const outstanding = useRefunds(false);
  const [marking, setMarking] = useState<RefundRow | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  if (outstanding.isPending) return <LoadingView />;
  if (outstanding.isError) return <ErrorView onRetry={() => outstanding.refetch()} />;

  const rows = outstanding.data ?? [];
  const total = outstandingTotal(rows) as Piastres;

  const columns: Column<RefundRow>[] = [
    {
      key: 'player',
      header: 'Player',
      render: (r) => (
        <div className={styles.playerCell}>
          <span className={styles.playerName}>{r.player?.name ?? 'Unknown player'}</span>
          {/* The phone is here on purpose: refunding in Paymob is a manual job and
              the owner usually wants to tell the player it's done. */}
          <span className={styles.playerSub}>{r.player?.phone ?? '—'}</span>
        </div>
      ),
    },
    { key: 'package', header: 'Package', render: (r) => <span className={styles.muted}>{r.pkg?.name ?? '—'}</span> },
    { key: 'amount', header: 'Amount', render: (r) => <span className={styles.amount}>{formatPiastres(r.purchase.amount)}</span> },
    {
      key: 'when',
      header: 'Charged',
      render: (r) => {
        const days = daysOutstanding(r.purchase, now);
        return (
          <div className={styles.playerCell}>
            <span className={styles.muted}>
              {r.purchase.refundRequiredAt ? formatInstantDate(r.purchase.refundRequiredAt) : '—'}
            </span>
            <span className={styles.age} data-stale={days >= STALE_DAYS}>
              {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'txn',
      header: 'Paymob transaction',
      render: (r) => <span className={styles.txn}>{r.purchase.gatewayTransactionId ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="sm" icon={Undo2} onClick={() => setMarking(r)}>
          Mark refunded
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Refunds"
        subtitle="Payments the card gateway took that couldn’t be turned into credits — today only a second free trial. Refund each one in Paymob, then record it here."
      />

      {rows.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={styles.empty}>Nothing to refund — every payment turned into credits.</p>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryValue}>{formatPiastres(total)}</span>
            <span className={styles.summaryLabel}>
              owed back across {rows.length} payment{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className={styles.tableWrap}>
            <Table rows={rows} columns={columns} keyOf={(r) => r.purchase.id} />
          </div>
        </>
      )}

      <div className={styles.section}>
        <button type="button" className={styles.sectionToggle} onClick={() => setShowSettled((v) => !v)}>
          {showSettled ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          Recently refunded
        </button>
        {showSettled ? <SettledList /> : null}
      </div>

      {marking ? <MarkRefundedModal row={marking} onClose={() => setMarking(null)} /> : null}
    </div>
  );
}

/** Collapsed by default — it is a receipt, not a task. */
function SettledList() {
  const settled = useRefunds(true);
  if (settled.isPending) return <LoadingView />;
  if (settled.isError) return <ErrorView onRetry={() => settled.refetch()} />;
  const rows = settled.data ?? [];
  if (rows.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <p className={styles.empty}>No refunds recorded yet.</p>
      </div>
    );
  }
  const columns: Column<RefundRow>[] = [
    { key: 'player', header: 'Player', render: (r) => r.player?.name ?? 'Unknown player' },
    { key: 'amount', header: 'Amount', render: (r) => <span className={styles.amount}>{formatPiastres(r.purchase.amount)}</span> },
    {
      key: 'refunded',
      header: 'Refunded',
      render: (r) => (
        <span className={styles.muted}>{r.purchase.refundedAt ? formatInstantDate(r.purchase.refundedAt) : '—'}</span>
      ),
    },
    { key: 'txn', header: 'Paymob transaction', render: (r) => <span className={styles.txn}>{r.purchase.gatewayTransactionId ?? '—'}</span> },
  ];
  return (
    <div className={styles.tableWrap}>
      <Table rows={rows} columns={columns} keyOf={(r) => r.purchase.id} />
    </div>
  );
}

/**
 * Records a refund that has ALREADY happened in Paymob. The note is required by
 * the RPC and the copy says why: without the Paymob reference this row is an
 * assertion nobody can check later.
 */
function MarkRefundedModal({ row, onClose }: { row: RefundRow; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    setError(null);
    setBusy(true);
    const res = await markPurchaseRefunded(row.purchase.id, note);
    setBusy(false);
    if (res.ok) onClose();
    else setError(REFUND_ERROR[res.reason]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Refunds"
      title="Record this refund"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={Undo2} onClick={() => void onSave()} disabled={note.trim() === '' || busy}>
            {busy ? 'Recording…' : 'Record refund'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.confirmLead}>
          {formatPiastres(row.purchase.amount)} to {row.player?.name ?? 'this player'}. This doesn’t move any
          money — refund it in Paymob first, then record it here so it leaves the list.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="refund-note">
            Paymob refund reference (required)
          </label>
          <textarea
            id="refund-note"
            className={styles.textarea}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. refund #48213 processed 27 Sep"
          />
        </div>
        {error ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
