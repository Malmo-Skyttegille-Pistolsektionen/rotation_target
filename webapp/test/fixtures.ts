/**
 * The shipped programs, as the app receives them — the same files the mock
 * server serves, so a test and the mock cannot disagree about what
 * "program 1" is.
 *
 * The casts are unavoidable: TypeScript widens `"show"` in a JSON import to
 * `string`, which no longer satisfies `Event["command"]`.
 */
import type { Program } from '../src/api/types';
import militarySnabbmatch from './data/programs/1.json';
import precision from './data/programs/20.json';
import faltTraning from './data/programs/40.json';

/** Militär Snabbmatch — mixed show/hide, most events carry `audio_ids`. */
export const PROGRAM_MILITARY_SNABBMATCH = militarySnabbmatch as unknown as Program;

/** Precision — no `command` anywhere, five-minute events. */
export const PROGRAM_PRECISION = precision as unknown as Program;

/** Fältträning — short 3 s show/hide cycles, no audio. */
export const PROGRAM_FALT_TRANING = faltTraning as unknown as Program;
