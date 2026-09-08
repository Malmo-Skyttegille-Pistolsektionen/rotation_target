import { describe, expect, it } from 'vitest';

import { aggregateBankState, restingState, simulateBanks } from '../src/lib/bank-state';
import type { Event, Program } from '../src/api/types';

function program(...series: Event[][]): Program {
  return {
    id: 41,
    title: 'Banks',
    description: '',
    readonly: false,
    series: series.map((events, index) => ({ name: `S${String(index + 1)}`, optional: false, events })),
  };
}

const states = (p: Program, n: number): string[][][] =>
  simulateBanks(p, n).map((series) => series.map((cell) => cell.state));

describe('simulateBanks', () => {
  it('starts from the resting state, every bank shown (D-31)', () => {
    expect(restingState(4)).toEqual(['shown', 'shown', 'shown', 'shown']);
    // A pause names nothing, so it leaves rest untouched.
    expect(states(program([{ duration: 1000 }]), 4)).toEqual([[['shown', 'shown', 'shown', 'shown']]]);
  });

  it('applies command to every bank the event does not name', () => {
    expect(states(program([{ duration: 1000, command: 'hide' }]), 3)).toEqual([[['hidden', 'hidden', 'hidden']]]);
  });

  it('lets a named bank override the baseline', () => {
    expect(states(program([{ duration: 1000, command: 'hide', banks: { B: 'show' } }]), 3)).toEqual([
      [['hidden', 'shown', 'hidden']],
    ]);
  });

  it('leaves a bank named by neither where it is', () => {
    const p = program([
      { duration: 1000, command: 'hide' },
      { duration: 1000, banks: { A: 'show' } },
    ]);
    expect(states(p, 2)).toEqual([
      [
        ['hidden', 'hidden'],
        ['shown', 'hidden'],
      ],
    ]);
  });

  it('carries the state across a series boundary, because completion moves nothing (D-31)', () => {
    const p = program([{ duration: 1000, command: 'hide' }], [{ duration: 1000 }]);
    expect(states(p, 2)).toEqual([[['hidden', 'hidden']], [['hidden', 'hidden']]]);
  });

  it('marks a bank addressed when the event drove it, even to the value it already had', () => {
    const p = program([
      { duration: 1000, command: 'show' },
      { duration: 1000, command: 'show', banks: { B: 'show' } },
      { duration: 1000, banks: { B: 'hide' } },
    ]);
    const sim = simulateBanks(p, 3);
    expect(sim[0][0].addressed).toEqual([true, true, true]);
    expect(sim[0][1].addressed).toEqual([true, true, true]);
    expect(sim[0][2].addressed).toEqual([false, true, false]);
  });

  it('ignores a letter beyond the banks the device has', () => {
    // The device refuses such a program at start; nothing here invents a bank
    // to hold the override.
    expect(states(program([{ duration: 1000, banks: { D: 'hide' } }]), 2)).toEqual([[['shown', 'shown']]]);
  });

  it('is exactly the single-bank answer when the device has one bank', () => {
    const p = program([{ duration: 1000, command: 'show' }, { duration: 1000, command: 'hide' }, { duration: 1000 }]);
    expect(states(p, 1)).toEqual([[['shown'], ['hidden'], ['hidden']]]);
  });
});

describe('aggregateBankState', () => {
  it('is the shared state when every bank agrees, and mixed when they do not', () => {
    expect(aggregateBankState(['shown', 'shown'])).toBe('shown');
    expect(aggregateBankState(['hidden', 'hidden'])).toBe('hidden');
    expect(aggregateBankState(['shown', 'hidden'])).toBe('mixed');
  });
});
