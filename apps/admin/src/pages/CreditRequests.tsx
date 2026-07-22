import { formatInstantDate, formatPiastres } from '@tpa/core';
import type { CreditRequest, Package, Piastres, Player } from '@tpa/types';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { approveCreditRequest, rejectCreditRequest } from '../data/creditRequests';
import { useAdminData, useCreditRequests } from '../data/queries';
import { proofSignedUrl } from '../lib/api';
import { PlayerDetailModal } from '../players/PlayerDetailModal';
import {
  Avatar,
  Badge,
  Button,
  ErrorView,
  Input,
  LoadingView,
  Modal,
  PageHeader,
  Table,
  TRAINING_LABEL,
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

interface Row {
  request: CreditRequest;
  player: Player | undefined;
  pkg: Package | undefined;
}

/**
 * Credit-requests approval queue (A4). Players report an out-of-band InstaPay/cash payment;
 * the admin reviews the proof and approves (minting real credits + recording revenue, with an
 * optional quantity/amount override when the payment didn't match) or rejects with a reason.
 * Pending first. Approve is the primary (money-out) action; reject is destructive.
 */
export function CreditRequests() {
  const data = useAdminData();
  const reqsQ = useCreditRequests();
  const [selected, setSelected] = useState<Player | null>(null);
  const [modal, setModal] = useState<{ kind: 'approve' | 'reject'; row: Row } | null>(null);

  const rows: Row[] = useMemo(() => {
    const byPlayer = new Map(data.players.map((p) => [p.id, p]));
    const byPkg = new Map(data.packages.map((p) => [p.id, p]));
    return [...(reqsQ.data ?? [])]
      .map((request) => ({ request, player: byPlayer.get(request.playerId), pkg: byPkg.get(request.packageId) }))
      .sort((a, b) => {
        // Pending first; then newest first.
        const ap = a.request.status === 'pending' ? 0 : 1;
        const bp = b.request.status === 'pending' ? 0 : 1;
        return ap !== bp ? ap - bp : b.request.createdAt.localeCompare(a.request.createdAt);
      });
  }, [reqsQ.data, data.players, data.packages]);

  if (data.isPending || reqsQ.isPending) return <LoadingView />;
  if (data.isError || reqsQ.isError) {
    return (
      <ErrorView
        onRetry={() => {
          data.refetch();
          reqsQ.refetch();
        }}
      />
    );
  }

  const pending = rows.filter((r) => r.request.status === 'pending').length;

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

      {rows.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={styles.empty}>No credit requests yet.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <Table columns={columns} rows={rows} keyOf={(r) => r.request.id} />
        </div>
      )}

      {modal?.kind === 'approve' ? <ApproveModal row={modal.row} onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'reject' ? <RejectModal row={modal.row} onClose={() => setModal(null)} /> : null}

      {selected ? (
        <PlayerDetailModal
          player={selected}
          batches={data.batches}
          purchases={data.purchases}
          bookings={data.bookings}
          slots={data.slots}
          coaches={data.coaches}
          packages={data.packages}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
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
          credit{quantity === 1 ? '' : 's'} and records <strong>{formatPiastres(amount as Piastres)}</strong> of revenue
          {overridden ? ' — adjusted from the package default.' : '.'}
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
