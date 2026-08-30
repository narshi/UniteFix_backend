import { useOperatorMe } from "@/lib/operator-auth";

/**
 * Operator Overview — Phase 0.
 *
 * Its job right now is to prove the boundary works end to end: an approved ISP
 * signs in, sees their own profile and coverage, and nothing else. The revenue
 * surfaces (plans, leads, customers, settlements) arrive in Phases 1-4.
 */
export default function OperatorOverview() {
  const { operator, isLoading, isError } = useOperatorMe();

  if (isLoading) {
    return <div className="p-8 text-[hsl(215,20%,65%)]">Loading your account…</div>;
  }

  if (isError || !operator) {
    return (
      <div className="p-8">
        <div className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-6 max-w-lg">
          <h2 className="text-lg font-bold text-white">Could not load your account</h2>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-2">
            Please try again in a moment. If this keeps happening, contact UniteFix support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white tracking-tight">{operator.companyName}</h1>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">
          Your UniteFix broadband partner account.
        </p>
      </header>

      <section className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(160,84%,45%)]">
          Account
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Sign-in username" value={operator.username} />
          <Field label="Contact person" value={operator.contactName} />
          <Field label="Email" value={operator.contactEmail} />
          <Field label="Phone" value={operator.contactPhone} />
          <Field label="Legal name" value={operator.legalName} />
          <Field label="GSTIN" value={operator.gstin} />
        </dl>
      </section>

      <section className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(160,84%,45%)]">
            Service area
          </h2>
          <span className="text-xs text-[hsl(215,20%,55%)]">
            {operator.pincodes.length} pincode{operator.pincodes.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="text-xs text-[hsl(215,20%,55%)] mt-2">
          Customers only see you if their pincode is on this list. Editing moves here in the next release —
          contact UniteFix to add or remove areas for now.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {operator.pincodes.length === 0 ? (
            <span className="text-sm text-[hsl(215,20%,55%)]">No pincodes assigned yet.</span>
          ) : (
            operator.pincodes.map((p) => (
              <span
                key={p}
                className="px-2.5 py-1 rounded-lg text-sm font-mono text-[hsl(210,20%,85%)] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]"
              >
                {p}
              </span>
            ))
          )}
        </div>
      </section>

      {operator.convenienceFee !== null && (
        <section className="glass-card border border-[rgba(255,255,255,0.08)] rounded-xl p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(160,84%,45%)]">
            Commercial terms
          </h2>
          <p className="text-sm text-[hsl(210,20%,80%)] mt-3">
            UniteFix adds a ₹{operator.convenienceFee} convenience fee at checkout. Your plan price reaches
            you in full.
          </p>
          <p className="text-xs text-[hsl(215,20%,55%)] mt-2">
            Agreed with UniteFix — contact us to renegotiate.
          </p>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[hsl(215,20%,55%)]">{label}</dt>
      <dd className="text-sm text-white mt-1 break-words">{value || "—"}</dd>
    </div>
  );
}
