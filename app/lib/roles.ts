import type { Role, Team } from './types'

export const ROLE_NAMES: Record<Role, string> = {
  werewolf: '狼人',
  wolf_king: '狼王',
  white_wolf_king: '白狼王',
  wolf_beauty: '狼美人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  idiot: '白痴',
}

export const ROLE_TEAMS: Record<Role, Team> = {
  werewolf: 'werewolf',
  wolf_king: 'werewolf',
  white_wolf_king: 'werewolf',
  wolf_beauty: 'werewolf',
  villager: 'villager',
  seer: 'villager',
  witch: 'villager',
  hunter: 'villager',
  guard: 'villager',
  idiot: 'villager',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  werewolf: '每晚与同伴一起选择击杀一名玩家',
  wolf_king: '狼人阵营，死亡时可以射杀一名玩家',
  white_wolf_king: '狼人阵营，白天可自爆并带走一名玩家',
  wolf_beauty: '狼人阵营，每晚魅惑一名非狼人；死亡时魅惑目标殉情',
  villager: '没有特殊技能，投票找出狼人',
  seer: '每晚可以查验一名玩家的阵营（好人/狼人）',
  witch: '拥有一瓶解药（救人）和一瓶毒药（杀人），各用一次',
  hunter: '死亡时（被杀或被投票）可以射杀一名玩家',
  guard: '每晚守护一名玩家，连续两晚不能守同一人',
  idiot: '第一次被投票出局时免死，但公开身份且失去投票权',
}

export const ROLE_EMOJIS: Record<Role, string> = {
  werewolf: '🐺',
  wolf_king: '👑',
  white_wolf_king: '💥',
  wolf_beauty: '🌹',
  villager: '🧑‍🌾',
  seer: '🔮',
  witch: '🧙‍♀️',
  hunter: '🏹',
  guard: '🛡️',
  idiot: '🃏',
}

export interface RolePreset {
  name: string
  playerCount: number
  roles: Role[]
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    name: '4人入门局',
    playerCount: 4,
    roles: ['werewolf', 'seer', 'witch', 'villager'],
  },
  {
    name: '5人快速局',
    playerCount: 5,
    roles: ['werewolf', 'seer', 'witch', 'hunter', 'villager'],
  },
  {
    name: '6人经典局',
    playerCount: 6,
    roles: ['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager'],
  },
  {
    name: '7人进阶局',
    playerCount: 7,
    roles: ['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager'],
  },
  {
    name: '8人标准局',
    playerCount: 8,
    roles: ['werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager'],
  },
  {
    name: '9人狼王局',
    playerCount: 9,
    roles: ['werewolf', 'werewolf', 'wolf_king', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager'],
  },
  {
    name: '9人白狼王局',
    playerCount: 9,
    roles: ['werewolf', 'werewolf', 'white_wolf_king', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager'],
  },
  {
    name: '10人豪华局',
    playerCount: 10,
    roles: [
      'werewolf', 'werewolf', 'wolf_king',
      'seer', 'witch', 'hunter', 'guard', 'idiot', 'villager', 'villager',
    ],
  },
  {
    name: '10人狼美人局',
    playerCount: 10,
    roles: [
      'werewolf', 'white_wolf_king', 'wolf_beauty',
      'seer', 'witch', 'hunter', 'guard', 'idiot', 'villager', 'villager',
    ],
  },
]

export function shuffleRoles(roles: Role[]): Role[] {
  const arr = [...roles]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function isWerewolf(role: Role): boolean {
  return ROLE_TEAMS[role] === 'werewolf'
}

// 神职：村民阵营里拥有技能的角色（预言家/女巫/猎人/守卫/白痴）
export function isDeity(role: Role): boolean {
  return ROLE_TEAMS[role] === 'villager' && role !== 'villager'
}

// 平民：无技能的普通村民
export function isCivilian(role: Role): boolean {
  return role === 'villager'
}
