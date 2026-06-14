export type Role =
  | 'werewolf'
  | 'wolf_king'
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter'
  | 'guard'
  | 'idiot'

export type Team = 'werewolf' | 'villager'

export type Phase =
  | 'setup'
  | 'night_guard'
  | 'night_werewolf'
  | 'night_seer'
  | 'night_witch'
  | 'day_announce'
  | 'day_discuss'
  | 'day_vote'
  | 'day_last_words'
  | 'hunter_shoot'
  | 'game_over'
  | 'review'

export type AiLevel = 'easy' | 'medium' | 'hard'

export interface Player {
  id: string
  name: string
  role: Role
  isHuman: boolean
  isAlive: boolean
  aiLevel?: AiLevel
  isRoleRevealed: boolean
  idiotUsed?: boolean
}

export interface NightAction {
  round: number
  actorId: string
  targetId: string | null
  actionType: 'kill' | 'check' | 'heal' | 'poison' | 'protect' | 'shoot'
}

export interface Speech {
  id: string
  playerId: string
  content: string
  timestamp: number
  round: number
  reasoning?: string
  isLastWords?: boolean
}

export interface Vote {
  voterId: string
  targetId: string
  round: number
}

export interface WolfPlan {
  round: number
  tactic: 'fake_claim' | 'deep_cover' | 'bus' | 'rush_vote' | 'misdirect'
  fakeClaimWolfId?: string | null
  pushTargetId?: string | null
  protectWolfId?: string | null
  busWolfId?: string | null
  talkingPointsByWolfId: Record<string, string>
  notes: string
}

export interface PublicClaim {
  id: string
  round: number
  claimantId: string
  claimType: 'seer' | 'witch' | 'hunter' | 'guard' | 'idiot'
  targetId?: string | null
  result?: 'werewolf' | 'villager' | 'unknown' | null
  rawSpeechId: string
  summary: string
}

export interface GameLog {
  id: string
  type: 'speech' | 'vote' | 'night_result' | 'death' | 'phase_change' | 'action'
  round: number
  phase: Phase
  data: Record<string, unknown>
  timestamp: number
}

export interface GameConfig {
  players: Array<{
    name: string
    isHuman: boolean
    aiLevel?: AiLevel
  }>
  roles: Role[]
}

export interface GameState {
  config: GameConfig
  players: Player[]
  phase: Phase
  round: number
  speeches: Speech[]
  votes: Vote[]
  nightActions: NightAction[]
  logs: GameLog[]
  winner: 'werewolves' | 'villagers' | null
  witchPotions: { heal: boolean; poison: boolean }
  guardLastProtect: string | null
  nightDeaths: string[]
  pendingHunter: string | null
  pendingShotSource: 'night' | 'vote' | null
  pendingLastWords: string | null
  pendingLastWordsSource: 'night' | 'vote' | null
  wolfPlan: WolfPlan | null
  wolfPlanRound: number
  publicClaims: PublicClaim[]
  currentSpeakerIndex: number
  currentVoterIndex: number
  votedOutPlayerId: string | null
}
