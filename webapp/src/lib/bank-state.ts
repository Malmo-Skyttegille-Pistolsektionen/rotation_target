/**
 * What every target bank is doing at each event of a program. Pure maths, no state.
 *
 * Mirrored logic: the device resolves an event the same way, in
 * `enter_event` in `firmware/lib/rt_logic/executor.cpp`. Keep the two in
 * lock-step - a divergence shows up as a timeline that disagrees with the
 * steel, which is the failure nobody notices until someone is downrange.
 * `run-position.ts` mirrors `run_position.h` the same way.
 *
 * The resolution rule is stated once, on `banks` in
 * `contracts/program.schema.json`. What is only here: state carries across
 * events *and across series*, because completing a series leaves the targets
 * where the last event put them, and the rest state before anything runs is
 * shown (D-31).
 */
import { BANK_LETTERS } from './program-document';
import type { Program } from '../api/types';

export type BankState = 'shown' | 'hidden';

export interface EventBankState {
  /** Each bank's state after entering this event, index 0 being bank A. */
  state: BankState[];
  /**
   * Whether the event addressed that bank - by naming its letter, or by
   * carrying a `command` that applies to it. True even when the value it set
   * was the value the bank already had: what the card marks solid is an event
   * that drove the bank, not one that changed it.
   */
  addressed: boolean[];
}

/** The resting state D-31 fixes: every bank shown, before anything has run. */
export function restingState(bankCount: number): BankState[] {
  return Array.from({ length: bankCount }, () => 'shown');
}

/**
 * Every event of `program`, series by series, with the bank state it leaves
 * behind. `simulate(p, n)[s][e]` is the state after entering series `s`,
 * event `e`.
 */
export function simulateBanks(program: Program, bankCount: number): EventBankState[][] {
  const count = Math.max(1, Math.min(bankCount, BANK_LETTERS.length));
  let current = restingState(count);

  // Both fields are required by the contract and optional in practice: the
  // preview renders a draft mid-edit, and the run page renders whatever the
  // device handed back.
  return (program.series ?? []).map((series) =>
    (series.events ?? []).map((event) => {
      const state = [...current];
      const addressed = state.map(() => false);

      for (let bank = 0; bank < count; bank++) {
        const override = event.banks?.[BANK_LETTERS[bank]];
        const command = override ?? event.command;
        if (command === undefined) continue;
        state[bank] = command === 'show' ? 'shown' : 'hidden';
        addressed[bank] = true;
      }

      current = state;
      return { state, addressed };
    }),
  );
}

/**
 * How a card reads at a glance: `shown` or `hidden` when every bank agrees,
 * `mixed` when they do not. A mixed card carries neither tint - the Three
 * Signals Rule reserves green and red for "the target is shown" and "the
 * target is hidden", and neither is true of a card where both are.
 */
export function aggregateBankState(state: readonly BankState[]): BankState | 'mixed' {
  if (state.every((value) => value === 'shown')) return 'shown';
  if (state.every((value) => value === 'hidden')) return 'hidden';
  return 'mixed';
}

/**
 * How many banks the device drives, or `null` while nothing is known.
 *
 * The count comes from `stateUpdate.targetBanks`, so it is unknown until the
 * first SSE frame arrives - and "unknown" is not "one". Treating it as one
 * would tell an operator, for the second or two before the stream connects,
 * that a program they can perfectly well run needs a device they do not have.
 * Callers hold off on any refusal until this answers.
 */
export function deviceBankCount(state: { targetBanks?: Record<string, unknown> } | null | undefined): number | null {
  const banks = state?.targetBanks;
  if (banks === undefined) return null;
  return Math.max(1, Object.keys(banks).length);
}
