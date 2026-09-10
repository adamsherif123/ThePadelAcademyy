import { formatInstantDate, formatPiastres } from '@tpa/core';
import type { CreditRequest, Piastres, Player } from '@tpa/types';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { approveCreditRequest, rejectCreditRequest } from '../data/creditRequests';
import { useAdminData, useCreditRequestsPage, useCreditRequestStatusCounts } from '../data/queries';
import {
  proofSignedUrl,
  type CreditRequestRow,
  type CreditRequestStatusFilter,
} from '../lib/api';
import { PlayerDetailModal } from '../players/PlayerDetailModal';
import { PaidToggle } from '../purchases/PaidToggle';
import {
  Avatar,
  Badge,
  Button,
  ErrorView,
  Input,
  LoadingView,
  Modal,
  PageHeader,
  Select,
  Table,
  TRAINING_LABEL,
  useIsMobile,
  type Column,
} from '../ui';
import styles from './CreditRequests.module.css';

const METHOD_LABEL: Record<CreditRequest['paymentMethod'], string> = { instapay: 'InstaPay', cash: 'Cash' };
const GENERIC = 'Something went wrong. Please try again.';
const APPROVE_ERROR: Record<string, string> = {
  not_admin: 'You’re not signed in as an admin.',
  request_missing: 'This request no longer exists.',
  not_pending: 'This request was already resolved.',
  invalid_quantity: 'Enter a credit quantity of at least 1.',
  invalid_amount: 'Enter an amount of at least 1 EGP.',
  network: GENERIC,
};
const REJECT_ERROR: Record<string, string> = {
  not_admin: 'You’re not signed in as an admin.',
  request_missing: 'This request no longer exists.',
  not_pending: 'This request was already resolved.',
  reason_required: 'A reason is required.',
  network: GENERIC,
};

// The row shape is now produced by the paginated query (player + package embedded),
// so it's defined once in the API layer rather than re-declared here.
type Row = CreditRequestRow;

const PAGE_SIZE = 10;

type StatusFilter = CreditRequestStatusFilter;

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Declined' },
  { value: 'all', label: 'All requests' },
];

/**
 * Credit-requests approval queue (A4). Players report an out-of-band InstaPay/cash payment;
 * the admin reviews the proof and approves (minting real credits and recording a purchase that
 * becomes revenue once the admin marks it paid, with an
 * optional quantity/amount override when the payment didn't match) or rejects with a reason.
 * Pending first. Approve is the primary (money-out) action; reject is destructive.
 */
export function CreditRequests() {
  const isMobile = useIsMobile();
  // The unpaginated list previously sorted PENDING FIRST so the actionable requests were
  // always on top. That property cannot survive pagination (an old pending request would
  // sit on page 5 behind resolved ones), and PostgREST can't order by a computed
  // "is pending" expression. So the queue's job moved from the sort to the FILTER: it
  // opens on Pending, which is what this page exists for, and history is one dropdown
  // away. Within a filter, newest first — consistent with Bookings.
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Player | null>(null);
  const [modal, setModal] = useState<{ kind: 'approve' | 'reject'; row: Row } | null>(null);

  // A new filter is a different result set — page 3 of the old one is meaningless
  // against it. Adjusted during render so the stale page never flashes through a fetch.
  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    setPage(0);
  }

  const reqsPage = useCreditRequestsPage({ page, pageSize: PAGE_SIZE, status });
  const counts = useCreditRequestStatusCounts();
  // PlayerDetailModal shows a player's FULL history — that still needs the monolith.
  const modalData = useAdminData();

  const rows = reqsPage.data?.rows ?? [];
  const total = reqsPage.data?.total ?? 0;
  const rangeFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeTo = page * PAGE_SIZE + rows.length;
  const hasPrev = page > 0;
  const hasNext = rangeTo < total;

  if (reqsPage.isPending || counts.isPending || modalData.isPending) return <LoadingView />;
  if (reqsPage.isError || counts.isError || modalData.isError) {
    return (
      <ErrorView
        onRetry={() => {
          reqsPage.refetch();
          counts.refetch();
          modalData.refetch();
        }}
      />
    );
  }

  // Whole-table, never the current page — so "N awaiting review" stays true while
  // you're looking at the Approved filter on page 3.
  const pending = counts.data?.pending ?? 0;

  const columns: Column<Row>[] = [
    {
      key: 'player',
      header: 'Player',
      render: (r) => (
        <button type="button" className={styles.playerCell} onClick={() => r.player && setSelected(r.player)}>
          <Avatar name={r.player?.name ?? 'Player'} size={32} />
          <span className={styles.playerText}>
            <span className={styles.playerName}>{r.player?.name ?? 'Unknown player'}</span>
            <span className={styles.playerSub}>
              {r.player?.email ?? r.player?.phone ?? '—'}
              {r.player?.trainedBefore === false
                ? ' · says new to TPA'
                : r.player?.trainedBefore === true
                  ? ' · says trained before'
                  : ''}
            </span>
          </span>
        </button>
      ),
    },
    {
      key: 'package',
      header: 'Package',
      render: (r) => (
        <span className={styles.pkgCell}>
          {r.pkg ? `${r.pkg.name} · ${r.pkg.sessionCount} sessions` : <span className={styles.muted}>—</span>}
          {r.request.isTrial ? <Badge tone="info">Trial · once per player</Badge> : null}
        </span>
      ),
    },
    { key: 'price', header: 'Price', render: (r) => <span className={styles.muted}>{r.pkg ? formatPiastres(r.pkg.price) : '—'}</span> },
    { key: 'method', header: 'Method', render: (r) => METHOD_LABEL[r.request.paymentMethod] },
    { key: 'submitted', header: 'Submitted', render: (r) => <span className={styles.muted}>{formatInstantDate(r.request.createdAt)}</span> },
    { key: 'proof', header: 'Proof', render: (r) => <ProofLink path={r.request.proofPath} /> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.request.status === 'pending' ? (
          <div className={styles.actions}>
            <Button variant="secondary" icon={X} onClick={() => setModal({ kind: 'reject', row: r })}>
              Reject
            </Button>
            <Button icon={Check} onClick={() => setModal({ kind: 'approve', row: r })}>
              Approve
            </Button>
          </div>
        ) : r.request.status === 'approved' && r.purchase ? (
          <div className={styles.resolved}>
            <Badge tone="success">Approved</Badge>
            <PaidToggle purchaseId={r.purchase.id} paid={r.purchase.paid} />
          </div>
        ) : (
          <Badge tone={r.request.status === 'approved' ? 'success' : 'danger'}>
            {r.request.status === 'approved' ? 'Approved' : 'Declined'}
          </Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Credit requests"
        subtitle={`Players reporting InstaPay or cash payments for approval. ${pending} awaiting review.`}
      />

      <div className={styles.filters}>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>

      {rows.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={styles.empty}>
            {status === 'pending'
              ? 'Nothing awaiting review — you’re all caught up.'
              : status === 'all'
                ? 'No credit requests yet.'
                : 'No requests with this status.'}
          </p>
        </div>
      ) : isMobile ? (
        <div className={styles.cards}>
          {rows.map((r) => (
            <RequestCard
              key={r.request.id}
              row={r}
              onPlayer={() => r.player && setSelected(r.player)}
              onApprove={() => setModal({ kind: 'approve', row: r })}
              onReject={() => setModal({ kind: 'reject', row: r })}
            />
          ))}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <Table columns={columns} rows={rows} keyOf={(r) => r.request.id} />
        </div>
      )}

      <div className={styles.pagination}>
        <span className={styles.pageInfo}>
          {total === 0 ? 'No requests' : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
          {reqsPage.isFetching ? <Loader2 size={14} className="tpa-spin" aria-hidden /> : null}
        </span>
        <div className={styles.pageControls}>
          <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="secondary" size="sm" icon={ChevronRight} disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {modal?.kind === 'approve' ? <ApproveModal row={modal.row} onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'reject' ? <RejectModal row={modal.row} onClose={() => setModal(null)} /> : null}

      {selected ? (
        <PlayerDetailModal
          player={selected}
          batches={modalData.batches}
          purchases={modalData.purchases}
          bookings={modalData.bookings}
          slots={modalData.slots}
          coaches={modalData.coaches}
          packages={modalData.packages}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One credit request as a phone card — the flow most likely done ON a phone: a transfer
 * lands on WhatsApp and the admin resolves it on the spot.
 *
 * Approve/Reject are full-width stacked buttons at the bottom of the card, Approve first
 * as the primary and far more common outcome. They open the SAME ApproveModal /
 * RejectModal the desktop table opens — the override, proof preview and reason flows are
 * not reimplemented for mobile, only reached differently. A resolved request shows its
 * badge where the buttons would be, so the card never renders dead controls.
 */
function RequestCard({
  row,
  onPlayer,
  onApprove,
  onReject,
}: {
  row: Row;
  onPlayer: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { request, player, pkg, purchase } = row;
  const pending = request.status === 'pending';
  return (
    <article className={styles.card}>
      <button type="button" className={styles.cardHead} onClick={onPlayer} disabled={!player}>
        <Avatar name={player?.name ?? 'Player'} size={36} />
        <span className={styles.cardHeadText}>
          <span className={styles.cardName}>{player?.name ?? 'Unknown player'}</span>
          <span className={styles.cardSub}>{player?.email ?? player?.phone ?? '—'}</span>
        </span>
      </button>

      <dl className={styles.cardGrid}>
        <dt className={styles.cardLabel}>Package</dt>
        <dd className={styles.cardValue}>
          {pkg ? `${pkg.name} · ${pkg.sessionCount} sessions` : '—'}
          {request.isTrial ? (
            <span className={styles.cardBadge}>
              <Badge tone="info">Trial · once per player</Badge>
            </span>
          ) : null}
        </dd>

        <dt className={styles.cardLabel}>Price</dt>
        <dd className={styles.cardValue}>{pkg ? formatPiastres(pkg.price) : '—'}</dd>

        <dt className={styles.cardLabel}>Method</dt>
        <dd className={styles.cardValue}>{METHOD_LABEL[request.paymentMethod]}</dd>

        <dt className={styles.cardLabel}>Submitted</dt>
        <dd className={styles.cardValue}>{formatInstantDate(request.createdAt)}</dd>

        <dt className={styles.cardLabel}>Proof</dt>
        <dd className={styles.cardValue}>
          <ProofLink path={request.proofPath} />
        </dd>
      </dl>

      <div className={styles.cardActions}>
        {pending ? (
          <>
            <Button className={styles.cardBtn} icon={Check} onClick={onApprove}>
              Approve
            </Button>
            <Button className={styles.cardBtn} variant="secondary" icon={X} onClick={onReject}>
              Reject
            </Button>
          </>
        ) : request.status === 'approved' && purchase ? (
          <div className={styles.resolved}>
            <Badge tone="success">Approved</Badge>
            <PaidToggle purchaseId={purchase.id} paid={purchase.paid} />
          </div>
        ) : (
          <Badge tone={request.status === 'approved' ? 'success' : 'danger'}>
            {request.status === 'approved' ? 'Approved' : 'Declined'}
          </Badge>
        )}
      </div>
    </article>
  );
}

/** Opens a signed URL for a private proof in a new tab (the bucket isn't public). */
function ProofLink({ path }: { path: string | null }) {
  const [busy, setBusy] = useState(false);
  if (!path) return <span className={styles.muted}>None</span>;
  const open = async () => {
    setBusy(true);
    try {
      const url = await proofSignedUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch {
      // Non-fatal — the admin can retry; the approve modal also shows the proof inline.
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={styles.proofLink} onClick={() => void open()} disabled={busy}>
      {busy ? 'Opening…' : 'View'}
    </button>
  );
}

/** Inline proof preview (signed URL) inside the approve modal. */
function ProofPreview({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    proofSignedUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!path) return <p className={styles.noProof}>No screenshot attached (a cash request may have none).</p>;
  if (failed) return <p className={styles.noProof}>Couldn’t load the screenshot.</p>;
  if (!url) return <p className={styles.noProof}>Loading screenshot…</p>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.proofImgWrap}>
      <img src={url} alt="Payment proof" className={styles.proofImg} />
    </a>
  );
}

function ApproveModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const { pkg, request, player } = row;
  const [quantity, setQuantity] = useState(pkg?.sessionCount ?? 1);
  const [amount, setAmount] = useState<number>(pkg?.price ?? 0); // piastres
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overridden = pkg ? quantity !== pkg.sessionCount || amount !== pkg.price : false;
  const canSave = quantity >= 1 && amount >= 1 && !saving;

  const onApprove = async () => {
    setSaving(true);
    setError(null);
    // Only send overrides that DIFFER from the package defaults; else null → the RPC uses the package.
    const q = pkg && quantity === pkg.sessionCount ? null : quantity;
    const a = pkg && amount === pkg.price ? null : amount;
    const res = await approveCreditRequest(request.id, q, a);
    setSaving(false);
    if (res.ok) onClose();
    else setError(APPROVE_ERROR[res.reason] ?? GENERIC);
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={player?.name ?? 'Player'}
      title="Approve credit request"
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Check} onClick={() => void onApprove()} disabled={!canSave}>
            {`Approve & grant ${quantity} credit${quantity === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <ProofPreview path={request.proofPath} />
        <p className={styles.summary}>
          {player?.name ?? 'This player'} reported a <strong>{METHOD_LABEL[request.paymentMethod]}</strong> payment for{' '}
          <strong>{pkg?.name ?? 'a package'}</strong>
          {pkg ? ` (${pkg.sessionCount} sessions, ${formatPiastres(pkg.price)}).` : '.'}
        </p>
        <div className={styles.grid}>
          <Input label="Credits to grant" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          <Input
            label="Amount received (EGP)"
            type="number"
            min={1}
            step="0.01"
            value={amount / 100}
            onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))}
          />
        </div>
        <p className={styles.confirm}>
          This grants <strong>{quantity}</strong> {pkg ? `${TRAINING_LABEL[pkg.trainingType]} ` : ''}
          credit{quantity === 1 ? '' : 's'} right away and records a <strong>{formatPiastres(amount as Piastres)}</strong>{' '}
          purchase{overridden ? ' — adjusted from the package default' : ''}. It counts toward revenue once you mark
          it paid.
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </Modal>
  );
}

function RejectModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = reason.trim() !== '' && !saving;

  const onReject = async () => {
    setSaving(true);
    setError(null);
    const res = await rejectCreditRequest(row.request.id, reason.trim());
    setSaving(false);
    if (res.ok) onClose();
    else setError(REJECT_ERROR[res.reason] ?? GENERIC);
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={row.player?.name ?? 'Player'}
      title="Reject credit request"
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" icon={X} onClick={() => void onReject()} disabled={!canSave}>
            Reject request
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.summary}>The player will see this reason and can submit a new request. Nothing is credited.</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reject-reason">
            Reason (required)
          </label>
          <textarea
            id="reject-reason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. No transfer received against this reference — please recheck and resubmit."
          />
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </Modal>
  );
}
