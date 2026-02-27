// Core data types for the Central Bank Communication Intelligence Platform

export type Bank = 'FED' | 'ECB';

export type SourceTier = 'CORE_OFFICIAL' | 'DISTRIBUTED_OFFICIAL' | 'SECONDARY_DISCOVERY';

export type EventType =
  | 'OFFICIAL_DECISION'
  | 'PRESS_CONFERENCE'
  | 'QNA_TRANSCRIPT'
  | 'MINUTES_ACCOUNTS'
  | 'MEMBER_SPEECH'
  | 'MEMBER_TESTIMONY'
  | 'MEMBER_INTERVIEW'
  | 'STATEMENT'
  | 'REMARKS'
  | 'CALENDAR_ITEM'
  | 'UNKNOWN';

export type StanceLevel = 'very_hawkish' | 'hawkish' | 'slightly_hawkish' | 'neutral' | 'slightly_dovish' | 'dovish' | 'very_dovish';
export type DecisionType = 'hike' | 'hold' | 'cut';
export type DirectionSignal = 'bullish' | 'bearish' | 'neutral';

export interface CommunicationEvent {
  event_id: string;
  bank: Bank;
  source_tier: SourceTier;
  source_name: string;
  trust_score: number;
  url: string;
  title: string;
  event_type: EventType;
  event_ts: string;
  event_date: string;
  speaker: string | null;
  speaker_role: string | null;
  institution: string | null;
  clean_text: string;
  summary: string | null;
  linked_meeting_date: string | null;
  link_distance_days: number | null;
  is_core_policy_signal: boolean;
  signal_priority_score: number;
  metrics?: CommunicationMetrics;
}

export interface CommunicationMetrics {
  stance: number; // -1 (very dovish) to 1 (very hawkish)
  guidance_strength: number; // 0-1
  inflation_focus: number; // 0-1
  growth_focus: number; // 0-1
  uncertainty: number; // 0-1
  qt_signal: number; // 0-1
}

export interface BankSummary {
  bank: Bank;
  latest_official_title: string;
  latest_official_date: string;
  official_stance: number;
  stance_label: StanceLevel;
  guidance_strength: number;
  uncertainty: number;
  chair_signal: number;
  member_weighted_signal: number;
  divergence: number;
  recent_chatter_count: number;
  communication_pressure_7d: number;
  communication_pressure_30d: number;
}

export interface PredictionOutput {
  bank: Bank;
  next_decision: DecisionType;
  hike_probability: number;
  hold_probability: number;
  cut_probability: number;
  confidence: number;
  model_label: string;
}

export interface CurrencyPrediction {
  pair: string;
  direction: DirectionSignal;
  signal_strength: number;
  confidence: number;
}

export interface SpeakerProfile {
  id: string;
  name: string;
  role: string;
  institution: string;
  bank: Bank;
  photo_url?: string;
  average_tone: number;
  credibility_score: number;
  market_impact_score: number;
  recent_tone_change: number;
  vs_official_stance: number;
  communication_count_30d: number;
  latest_communication_date: string;
}

export interface MeetingCycle {
  meeting_id: string;
  bank: Bank;
  meeting_date: string;
  decision: string | null;
  pre_meeting_events: CommunicationEvent[];
  post_meeting_events: CommunicationEvent[];
  tone_evolution: { date: string; tone: number }[];
  foreshadowed: boolean | null;
}

export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface DivergenceData {
  date: string;
  official: number;
  member_weighted: number;
}
