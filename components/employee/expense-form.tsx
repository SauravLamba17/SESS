"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import {
  submitExpenseClaim,
  EXPENSE_CATEGORIES,
  type ExpenseFormState,
} from "@/app/employee/expenses/actions";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

function todayStr(): string {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${n.getFullYear()}-${m}-${d}`;
}

const LABEL: Record<string, string> = {
  TRAVEL: "Travel",
  FOOD: "Food",
  ACCOMMODATION: "Accommodation",
  COMMUNICATION: "Communication",
  MISCELLANEOUS: "Miscellaneous",
};

export function ExpenseForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [state, setState] = useState<ExpenseFormState | null>(null);
  const [success, setSuccess] = useState(false);

  const max = todayStr();

  // Client-side mirror of the server rules — the server remains authoritative.
  function clientValidate(): ExpenseFormState["fieldErrors"] {
    const errs: ExpenseFormState["fieldErrors"] = {};
    if (!category) errs.category = "Choose a category.";
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount.trim()))
      errs.amount = "Enter an amount like 1250 or 1250.75.";
    else if (Number(amount) <= 0) errs.amount = "Amount must be greater than zero.";
    if (!date) errs.date = "Enter a valid date.";
    else if (date > max) errs.date = "Date cannot be in the future.";
    if (!description.trim()) errs.description = "A description is required.";
    if (receiptUrl.trim() && !/^https?:\/\/\S+$/i.test(receiptUrl.trim()))
      errs.receiptUrl = "Receipt link must be a http(s) URL.";
    return errs;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    const errs = clientValidate();
    if (errs && Object.keys(errs).length > 0) {
      setState({ ok: false, fieldErrors: errs });
      return;
    }
    startTransition(async () => {
      const res = await submitExpenseClaim({
        category,
        amount: amount.trim(),
        date,
        description,
        receiptUrl,
      });
      setState(res);
      if (res.ok) {
        setSuccess(true);
        setCategory("");
        setAmount("");
        setDate("");
        setDescription("");
        setReceiptUrl("");
        router.refresh();
      }
    });
  }

  const fe = state?.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="category" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
            aria-invalid={!!fe.category}
          >
            <option value="">Select…</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LABEL[c]}
              </option>
            ))}
          </select>
          {fe.category && <p className="mt-1 text-xs text-danger">{fe.category}</p>}
        </div>

        <div>
          <label htmlFor="amount" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Amount (INR)
          </label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1250.00"
            className={`${inputClass} font-mono`}
            aria-invalid={!!fe.amount}
          />
          {fe.amount && <p className="mt-1 text-xs text-danger">{fe.amount}</p>}
        </div>

        <div>
          <label htmlFor="date" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Date of expense
          </label>
          <input
            id="date"
            type="date"
            max={max}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
            aria-invalid={!!fe.date}
          />
          {fe.date && <p className="mt-1 text-xs text-danger">{fe.date}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="description" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
          Description
        </label>
        <textarea
          id="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this expense for?"
          className={inputClass}
          aria-invalid={!!fe.description}
        />
        {fe.description && <p className="mt-1 text-xs text-danger">{fe.description}</p>}
      </div>

      <div>
        <label htmlFor="receiptUrl" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
          Receipt link <span className="normal-case text-text-muted">(optional)</span>
        </label>
        <input
          id="receiptUrl"
          type="url"
          value={receiptUrl}
          onChange={(e) => setReceiptUrl(e.target.value)}
          placeholder="https://…"
          className={inputClass}
          aria-invalid={!!fe.receiptUrl}
        />
        {fe.receiptUrl && <p className="mt-1 text-xs text-danger">{fe.receiptUrl}</p>}
      </div>

      {state && !state.ok && state.error && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <StatusDot state="danger" />
          <span>{state.error}</span>
        </div>
      )}

      {success && (
        <div
          className="flex items-center gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-sm text-good"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={16} />
          <span>Claim submitted — pending manager approval.</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
      >
        {pending && <Loader2 size={16} className="animate-spin" />}
        {pending ? "Submitting…" : "Submit claim"}
      </button>
    </form>
  );
}
