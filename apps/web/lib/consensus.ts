/**
 * Consensus (CLAUDE.md step 5). Pure: given k+ candidate transcripts, find the agreeing cluster.
 * Two corrections agree when their symmetric, diacritic-insensitive CER is ≤ AGREE_CER.
 */
import { agreementCer } from "./text";

export const K = 3;
export const AGREE_CER = 0.15;

export type Candidate = { id: string; text: string };
export type ConsensusResult =
  | { kind: "agreed"; consensusId: string; consensusText: string; accepted: string[]; rejected: string[] }
  | { kind: "disputed" };

export function findConsensus(cands: Candidate[]): ConsensusResult {
  const n = cands.length;
  const d = cands.map((a) => cands.map((b) => agreementCer(a.text, b.text)));

  // Each candidate's neighbourhood (itself + everyone within AGREE_CER). Biggest wins;
  // ties go to the tighter cluster (smaller total distance), then to the earlier submission.
  let best: { members: number[]; spread: number } | null = null;
  for (let i = 0; i < n; i++) {
    const members = cands.map((_, j) => j).filter((j) => d[i]![j]! <= AGREE_CER);
    const spread = members.reduce((s, j) => s + d[i]![j]!, 0);
    if (!best || members.length > best.members.length || (members.length === best.members.length && spread < best.spread)) {
      best = { members, spread };
    }
  }
  if (!best || best.members.length < 2) return { kind: "disputed" };

  // Medoid: the member closest to all other members.
  const cost = (i: number) => best!.members.reduce((s, j) => s + d[i]![j]!, 0);
  const medoid = best.members.reduce((m, i) => (cost(i) < cost(m) ? i : m), best.members[0]!);
  const inCluster = new Set(best.members);
  return {
    kind: "agreed",
    consensusId: cands[medoid]!.id,
    consensusText: cands[medoid]!.text,
    accepted: best.members.map((i) => cands[i]!.id),
    rejected: cands.filter((_, i) => !inCluster.has(i)).map((c) => c.id),
  };
}
