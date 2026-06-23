/**
 * Program — editable loyalty rules (UI-SPEC §4.10).
 *
 * Edits ProgramConfig: reward threshold (pointsPerReward), reward description,
 * points per purchase, the multi-add cap (maxPointsPerTransaction), and card
 * inactivity days. Saving is a program change, so it requires STEP-UP re-auth
 * (UX-SPEC §6): the admin re-enters their PIN before `config.update(actor, …)`
 * commits. The authenticated `actor` is always passed to the mutation.
 */

import { useEffect, useState } from 'react';
import { Banner, Button, Eyebrow, Field, useToast } from '../../kit';
import { useServices } from '../../common/ServicesContext';
import type { Actor } from '../../../services/types';
import type { ProgramConfig } from '../../../domain/models';
import { StepUpSheet } from './StepUpSheet';

interface FormState {
  pointsPerReward: string;
  rewardDescription: string;
  pointsPerPurchase: string;
  maxPointsPerTransaction: string;
  cardInactivityDays: string;
}

function toForm(config: ProgramConfig): FormState {
  return {
    pointsPerReward: String(config.pointsPerReward),
    rewardDescription: config.rewardDescription,
    pointsPerPurchase: String(config.pointsPerPurchase),
    maxPointsPerTransaction: String(config.maxPointsPerTransaction),
    cardInactivityDays: String(config.cardInactivityDays),
  };
}

function toPatch(form: FormState): Partial<ProgramConfig> {
  return {
    pointsPerReward: Number(form.pointsPerReward),
    rewardDescription: form.rewardDescription,
    pointsPerPurchase: Number(form.pointsPerPurchase),
    maxPointsPerTransaction: Number(form.maxPointsPerTransaction),
    cardInactivityDays: Number(form.cardInactivityDays),
  };
}

export function ProgramSection({ actor }: { actor: Actor }) {
  const services = useServices();
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    services.config
      .get()
      .then((config) => {
        if (!cancelled) setForm(toForm(config));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const commit = async () => {
    if (!form) return;
    try {
      const saved = await services.config.update(actor, toPatch(form));
      setForm(toForm(saved));
      setStepUpOpen(false);
      toast.show('Program updated.', { tone: 'success' });
    } catch {
      setStepUpOpen(false);
      toast.show('Couldn’t save the program. Try again.', { tone: 'warning' });
    }
  };

  return (
    <section className="admin-section" aria-labelledby="admin-program-h">
      <Eyebrow>Rules</Eyebrow>
      <h2 id="admin-program-h" className="admin-section__title">
        Program
      </h2>
      {loadError && <Banner tone="warning">Couldn’t load the program. Refresh to try again.</Banner>}
      {form && (
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            setStepUpOpen(true);
          }}
        >
          <Field
            label="Reward earned at"
            hint="Number of coffees that earn one free reward."
            type="number"
            min={1}
            inputMode="numeric"
            value={form.pointsPerReward}
            onChange={set('pointsPerReward')}
          />
          <Field
            label="Reward description"
            hint="What the customer earns, e.g. “Free regular coffee”."
            type="text"
            value={form.rewardDescription}
            onChange={set('rewardDescription')}
          />
          <Field
            label="Points per purchase"
            hint="Coffees added by a single tap by default."
            type="number"
            min={1}
            inputMode="numeric"
            value={form.pointsPerPurchase}
            onChange={set('pointsPerPurchase')}
          />
          <Field
            label="Most coffees per add"
            hint="The multi-add cap. Keep this low — it’s an anti-fraud guard."
            type="number"
            min={1}
            inputMode="numeric"
            value={form.maxPointsPerTransaction}
            onChange={set('maxPointsPerTransaction')}
          />
          <Field
            label="Card inactivity (days)"
            hint="Days before an unused card is considered inactive. 0 turns this off."
            type="number"
            min={0}
            inputMode="numeric"
            value={form.cardInactivityDays}
            onChange={set('cardInactivityDays')}
          />
          <div className="admin-form__actions">
            <Button variant="forest" type="submit">
              Save program
            </Button>
            <span className="admin-form__hint">You’ll confirm with your PIN.</span>
          </div>
        </form>
      )}

      <StepUpSheet
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onConfirm={commit}
        title="Confirm program change"
        message="Re-enter your PIN to update the loyalty program."
      />
    </section>
  );
}
