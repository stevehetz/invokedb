// A new ticket: POST /api/v1/create with the customer as a link cell (an array of row ids).
import { useState, type FormEvent } from 'react';
import { createTicket, errorMessage, PRIORITIES, type Priority } from '../api';
import { navigate } from '../router';
import { ErrorNote, useCustomers } from '../ui';

export function NewTicket() {
  const customers = useCustomers();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [customer, setCustomer] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = await createTicket({
        title: title.trim(),
        description: description.trim(),
        priority,
        customer
      });
      navigate(id ? `tickets/${id}` : '');
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <section className="narrow">
      <h1>New ticket</h1>
      <ErrorNote error={error} />
      <form className="form" onSubmit={submit}>
        <label>
          Title
          <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea
            value={description}
            maxLength={2000}
            rows={5}
            onChange={e => setDescription(e.target.value)}
          />
        </label>
        <label>
          Customer
          <select value={customer} onChange={e => setCustomer(e.target.value)} required>
            <option value="" disabled>
              Pick a customer…
            </option>
            {customers.map(c => (
              <option key={c._id} value={c._id}>
                {c.name} ({c.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={e => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={saving || !title.trim() || !customer}>
          {saving ? 'Saving…' : 'Create ticket'}
        </button>
      </form>
    </section>
  );
}
