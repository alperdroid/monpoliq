import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { currentMembers, isFomcVoter, ECB_VOTING_GROUP_1, ROSTER_VERIFIED } from '@/data/committee-roster';
import { cn } from '@/lib/utils';
import { SignalBadge } from '@/components/analytics/SignalBadge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Vote, Users, Crown, Star, Network, Grid3X3 } from 'lucide-react';
import { FragmentationHeatmap } from '@/components/committee/FragmentationHeatmap';
import { DissentTimeline } from '@/components/committee/DissentTimeline';
import { CommitteeNetworkGraph } from '@/components/committee/CommitteeNetworkGraph';
import { getCachedSentimentItems, type SentimentItem } from '@/lib/api/sentiment';

interface CommitteeMember {
  id: string;
  name: string;
  bank: string;
  role: string;
  institution: string;
  is_permanent_voter: boolean;
  voting_years: number[];
  is_core_board: boolean;
  term_start: string | null;
  term_end: string | null;
  notes: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

/** Current members, Board/Executive Board first, with FOMC voting years around the current year. */
function rosterMembers(): CommitteeMember[] {
  const years = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2];
  const order: Record<string, number> = { 'fed-board': 0, 'fed-bank': 1, 'ecb-board': 0, 'ecb-ncb': 1 };
  return currentMembers()
    .map(m => {
      return {
        id: m.name,
        name: m.name,
        bank: m.bank,
        role: m.role,
        institution: m.institution,
        is_permanent_voter: m.body === 'fed-board' || m.fedBank === 'New York',
        voting_years: years.filter(y => isFomcVoter(m, y)),
        is_core_board: m.body === 'fed-board' || m.body === 'ecb-board',
        term_start: m.since ?? null,
        term_end: m.termEnd ?? null,
        notes: m.note ?? null,
        _order: order[m.body],
      };
    })
    .sort((a, b) => a.bank.localeCompare(b.bank) || a._order - b._order || Number(b.is_permanent_voter) - Number(a.is_permanent_voter));
}

function isVoterInYear(member: CommitteeMember, year: number): boolean {
  if (member.is_permanent_voter) return true;
  return (member.voting_years || []).includes(year);
}

const Committee = () => {
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<number>(CURRENT_YEAR);

  // Current members from the verified roster (src/data/committee-roster.ts)
  const isLoading = false;
  const members = useMemo(() => rosterMembers(), []);

  const { data: allItems = [] } = useQuery({
    queryKey: ['all-sentiment-items'],
    queryFn: () => getCachedSentimentItems(),
  });

  const { fedMembers, ecbMembers } = useMemo(() => {
    const fed = members.filter(m => m.bank === 'FED');
    const ecb = members.filter(m => m.bank === 'ECB');
    return { fedMembers: fed, ecbMembers: ecb };
  }, [members]);

  const filteredFed = useMemo(() => {
    if (bankFilter === 'ECB') return [];
    return fedMembers;
  }, [fedMembers, bankFilter]);

  const filteredEcb = useMemo(() => {
    if (bankFilter === 'FED') return [];
    return ecbMembers;
  }, [ecbMembers, bankFilter]);

  const fedVoterCount = filteredFed.filter(m => isVoterInYear(m, yearFilter)).length;
  const fedNonVoterCount = filteredFed.length - fedVoterCount;
  const ecbCoreCount = filteredEcb.filter(m => m.is_core_board).length;
  const ecbGovernorCount = filteredEcb.filter(m => !m.is_core_board).length;

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Inside the Committee</h1>
        <span className="text-xs text-muted-foreground font-mono">
          {isLoading ? 'Loading…' : `${members.length} members · verified ${ROSTER_VERIFIED}`}
        </span>
      </div>

      <Tabs defaultValue="composition" className="space-y-4">
        <TabsList>
          <TabsTrigger value="composition" className="text-xs">Composition</TabsTrigger>
          <TabsTrigger value="fragmentation" className="text-xs">Fragmentation</TabsTrigger>
          <TabsTrigger value="dissents" className="text-xs">Dissent History</TabsTrigger>
          <TabsTrigger value="network" className="text-xs">Network Graph</TabsTrigger>
        </TabsList>

        <TabsContent value="fragmentation">
          <div className="rounded-lg border border-border bg-card p-4">
            <FragmentationHeatmap allItems={allItems as any} />
          </div>
        </TabsContent>

        <TabsContent value="dissents">
          <DissentTimeline />
        </TabsContent>

        <TabsContent value="network">
          <div className="grid lg:grid-cols-2 gap-4">
            {(bankFilter === 'all' || bankFilter === 'FED') && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">Federal Reserve Alignment</h3>
                </div>
                <p className="text-[9px] text-muted-foreground -mt-1">Node size = comms volume • Color = hawk/dove lean • Edge = messaging similarity</p>
                <CommitteeNetworkGraph allItems={allItems as any} bankFilter="FED" />
              </div>
            )}
            {(bankFilter === 'all' || bankFilter === 'ECB') && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-prediction" />
                  <h3 className="text-sm font-semibold">ECB Alignment</h3>
                </div>
                <p className="text-[9px] text-muted-foreground -mt-1">Node size = comms volume • Color = hawk/dove lean • Edge = messaging similarity</p>
                <CommitteeNetworkGraph allItems={allItems as any} bankFilter="ECB" />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="composition" className="space-y-6">

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={bankFilter} onValueChange={setBankFilter}>
          <SelectTrigger className="w-28 h-8 text-xs bg-surface"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Banks</SelectItem>
            <SelectItem value="FED">Fed</SelectItem>
            <SelectItem value="ECB">ECB</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(yearFilter)} onValueChange={v => setYearFilter(Number(v))}>
          <SelectTrigger className="w-24 h-8 text-xs bg-surface"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[2025, 2026, 2027].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* FED Section */}
      {bankFilter !== 'ECB' && filteredFed.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Federal Reserve — {yearFilter}</h2>
            <div className="flex gap-2">
              <span className="text-[10px] font-mono bg-data-positive/10 text-data-positive px-2 py-0.5 rounded-full">
                {fedVoterCount} voters
              </span>
              <span className="text-[10px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                {fedNonVoterCount} non-voters
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-12 gap-2 p-3 bg-surface text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-3">Institution</div>
              <div className="col-span-1 text-center">Status</div>
              <div className="col-span-3">Notes</div>
            </div>
            {filteredFed.map(member => {
              const isVoter = isVoterInYear(member, yearFilter);
              return (
                <div key={member.id} className={cn(
                  'grid grid-cols-12 gap-2 p-3 border-b border-border last:border-0 text-xs items-center transition-colors',
                  isVoter ? 'bg-card' : 'bg-muted/30 opacity-70',
                )}>
                  <div className="col-span-3 flex items-center gap-2">
                    {member.is_core_board ? (
                      <Crown className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    ) : (
                      <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="font-medium truncate">{member.name}</span>
                  </div>
                  <div className="col-span-2 text-muted-foreground truncate">{member.role}</div>
                  <div className="col-span-3 text-muted-foreground truncate text-[11px]">{member.institution}</div>
                  <div className="col-span-1 flex justify-center">
                    {isVoter ? (
                      <span className="flex items-center gap-1 text-[9px] font-semibold text-data-positive bg-data-positive/10 px-1.5 py-0.5 rounded-full">
                        <Vote className="w-3 h-3" /> VOTE
                      </span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">ALT</span>
                    )}
                  </div>
                  <div className="col-span-3 text-[10px] text-muted-foreground truncate">{member.notes || '—'}</div>
                </div>
              );
            })}
          </div>

          {/* Rotation explainer */}
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-semibold">FOMC Voting Rotation</h3>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The FOMC has 12 voting members: 7 Board of Governors + NY Fed President (permanent) + 4 rotating Reserve Bank presidents.
              The 11 other presidents rotate in four groups: Chicago and Cleveland alternate every year, the other nine vote every third year. Non-voters still attend,
              participate in discussions, and influence the committee's thinking.
            </p>
          </div>
        </div>
      )}

      {/* ECB Section */}
      {bankFilter !== 'FED' && filteredEcb.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">European Central Bank — {yearFilter}</h2>
            <div className="flex gap-2">
              <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {ecbCoreCount} Executive Board
              </span>
              <span className="text-[10px] font-mono bg-chart-4/10 text-chart-4 px-2 py-0.5 rounded-full">
                {ecbGovernorCount} NCB Governors
              </span>
            </div>
          </div>

          {/* Executive Board */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-3 bg-primary/5 border-b border-border">
              <div className="flex items-center gap-2">
                <Star className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">Executive Board — Always Vote</span>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 p-3 bg-surface text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-3">Term</div>
              <div className="col-span-4">Notes</div>
            </div>
            {filteredEcb.filter(m => m.is_core_board).map(member => (
              <div key={member.id} className="grid grid-cols-12 gap-2 p-3 border-b border-border last:border-0 text-xs items-center">
                <div className="col-span-3 flex items-center gap-2">
                  <Crown className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="font-medium">{member.name}</span>
                </div>
                <div className="col-span-2 text-muted-foreground">{member.role}</div>
                <div className="col-span-3 text-[10px] text-muted-foreground font-mono">
                  {member.term_start ? new Date(member.term_start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '?'}
                  {' → '}
                  {member.term_end ? new Date(member.term_end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                </div>
                <div className="col-span-4 text-[10px] text-muted-foreground">{member.notes || '—'}</div>
              </div>
            ))}
          </div>

          {/* National Central Bank Governors */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-3 bg-chart-4/5 border-b border-border">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-chart-4" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-chart-4">National Central Bank Governors — Rotating Votes</span>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 p-3 bg-surface text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
              <div className="col-span-3">Name</div>
              <div className="col-span-3">Institution</div>
              <div className="col-span-2">Group</div>
              <div className="col-span-4">Notes</div>
            </div>
            {filteredEcb.filter(m => !m.is_core_board).map(member => {
              const isGroup1 = ECB_VOTING_GROUP_1.includes(member.institution);
              return (
                <div key={member.id} className="grid grid-cols-12 gap-2 p-3 border-b border-border last:border-0 text-xs items-center">
                  <div className="col-span-3 font-medium truncate">{member.name}</div>
                  <div className="col-span-3 text-[10px] text-muted-foreground truncate">{member.institution}</div>
                  <div className="col-span-2">
                    {isGroup1 ? (
                      <span className="text-[9px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                        Group 1 (4/5)
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-chart-4 bg-chart-4/10 px-1.5 py-0.5 rounded-full">
                        Group 2 (11/16)
                      </span>
                    )}
                  </div>
                  <div className="col-span-4 text-[10px] text-muted-foreground truncate">{member.notes || '—'}</div>
                </div>
              );
            })}
          </div>

          {/* ECB Rotation explainer */}
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-chart-4" />
              <h3 className="text-xs font-semibold">ECB Governing Council Rotation</h3>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The ECB Governing Council has 27 members: 6 Executive Board (always vote) + 21 NCB Governors (rotating; Bulgaria joined in 2026).
              <strong> Group 1</strong> (5 largest economies: DE, FR, IT, ES, NL) shares 4 votes — each governor votes ~80% of meetings.
              <strong> Group 2</strong> (remaining 16 governors) shares 11 votes — each governor votes ~69% of meetings.
              All governors attend and participate regardless of voting status.
            </p>
          </div>
        </div>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Committee;
