<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Notes

This is a Chinese Werewolf game built with Next.js 16, React 19, TypeScript, and Tailwind CSS. The app supports one primary human player playing with AI players, including setup, role assignment, night actions, day discussion, public sequential voting, game-over reveal, and AI-powered review.

## Important Commands

- `npm run dev` starts the development server.
- `npm run build` runs the production build.
- `npm run start` serves a production build.

Before changing Next.js-specific APIs, routing, metadata, fonts, server actions, route handlers, or config, read the relevant local Next.js docs under `node_modules/next/dist/docs/`.

## Environment

AI features call an OpenAI-compatible provider through server route handlers. Supported providers live in `app/lib/aiProvider.ts`.

- DeepSeek: `DEEPSEEK_API_KEY`
- Qwen/DashScope: `AI_PROVIDER=qwen`, `DASHSCOPE_API_KEY`, optional `AI_MODEL`, optional `AI_ANALYZE_MODEL`

Do not expose API keys to client components. Keep provider calls inside `app/api/**/route.ts`. Qwen calls explicitly disable thinking mode through `applyProviderTuning()` because the game uses non-streaming JSON responses.

## Main Architecture

- `app/page.tsx` is the setup entry: landing screen, player setup, role setup, then redirects to `/game?config=...`.
- `app/game/page.tsx` loads the encoded game config from search params and renders the game board or review screen.
- `app/hooks/useGame.ts` owns client-side game state transitions and is the ONLY place async AI orchestration lives. Engine functions stay pure/sync; the hook calls them and weaves in LLM calls. A `processingRef` guard prevents concurrent AI triggers.
- `app/lib/gameEngine.ts` contains pure game mechanics: `initGame`, `nextNightPhase`, `processNightEnd`, `processVote`, `processLastWordsEnd`, `processHunterShoot`, and `checkWinCondition`. No side effects, no LLM calls.
- `app/lib/types.ts` defines shared game types.
- `app/lib/roles.ts` defines role names, teams, descriptions, emojis, presets, and role helpers (`isWerewolf`, `isDeity`, `isCivilian`).
- `app/lib/aiPlayer.ts` builds each player's private perspective (`buildPlayerPerspective`) and calls `/api/ai` for every AI decision: `generateAiSpeech`, `generateAiVote`, `decideNightAction` (guard/seer), `decideWerewolfKill`, `decideWitchAction`, `decideWolfBeautyCharm`, `decideWhiteWolfKingExplosion`, `decideShotTarget` (hunter/wolf king), `generateWolfPlan` (night), and `generateLastWords`. JSON decisions go through `callAiJsonWithTrace`/`callAiJson` (one retry) + `matchPlayerByName` fuzzy matching, and every decision has a non-LLM fallback so a failed/empty call never stalls the game.
- `app/lib/strategy.ts` computes deterministic per-round strategy (`computeRoundStrategy`) before speech generation. It is pure and zero-LLM; use it for hard Werewolf logic such as seer claim timing, wolf-plan role assignments, witch/hunter defensive claims, wolf beauty hiding, and white wolf king pressure behavior.
- `app/lib/reviewHelpers.ts` builds readable round timelines and full transcripts for post-game analysis.
- `app/components/game/**` contains phase UI, player cards, speech bubbles, and the main board.
- `app/components/setup/**` contains player and role setup UI.
- `app/components/review/GameReview.tsx` displays final identities, timeline, and AI coach analysis.

## AI Agent Design

The AI players are not a single free-form chatbot. Treat each AI as a role-aware agent with a fixed decision chain:

1. **Private perspective**: `buildPlayerPerspective()` constructs exactly what this player can know. It includes public speeches, public claims, votes, deaths, and only the private information available to this role. Do not leak hidden roles, wolf teammates, seer checks, witch medicine, guard targets, or wolf beauty charm targets to players who cannot know them.
2. **Hard strategy layer**: `computeRoundStrategy()` derives deterministic intent from the current state. This should handle rules that should not depend on LLM taste: seer must keep a prior claim, seer must counterclaim in single-seer boards, wolves follow `wolfPlan`, wolf beauty usually hides, white wolf king is a high-risk pressure role, witch/hunter can reveal under forced pressure.
3. **Prompted expression layer**: `generateAiSpeech()` injects the strategy into the speech prompt. The LLM decides wording, but the strategy sets the job: claim, hide, push a target, defend, counterclaim, or consolidate.
4. **Structured action layer**: votes and night actions return JSON, then code matches the target by player name. Invalid or empty output falls back to deterministic heuristics.
5. **Trace layer**: AI speeches, votes, night actions, shots, self-explosions, and last words should preserve `llmTrace` where available. Review UI uses this to show the prompt and raw response for debugging.

### AI behavior principles

- Separate **decision/intent** from **expression**. Prefer adding hard strategy in `strategy.ts` before adding more prompt text.
- Do not add extra LLM calls unless the behavior cannot be expressed as a pure state-derived rule. Speed matters because day speech and voting are sequential.
- Every LLM path must have a fallback. A failed model call must produce a legal action or a deliberate no-op, never a stuck phase.
- Every public claim should be structured through `PublicClaim`. Seer checks are `result: werewolf/villager`; witch antidote information is **not** a seer gold result and should use `result: unknown` plus `witchAction`.
- Wolves may know wolf teammates and their night plan. Non-wolves must reason only from public behavior unless their role gives private facts.
- Wolves should never publicly admit their true identity or real teammates unless a special rule explicitly requires it. Public wolf speech should sound like plausible good-player reasoning.
- Avoid fake mechanics in prompts or speech. This app currently has no sheriff, badge flow, election, or badge handoff.

### Rule layer vs. LLM reasoning layer

When fixing AI misbehavior, always ask: **should this be a hard rule in code, or should the LLM reason its way to the right answer?** Getting this wrong is the most common source of over-engineering.

**Put in code (rule layer) when ALL of the following are true:**
1. The constraint is derived from **private information** that must not appear in the prompt (e.g., seer's verified gold/wolf list, guard's last-protected target, wolf teammate identities). The LLM cannot use information it was never given.
2. The action is **always wrong regardless of context** — there are no edge cases where it would be correct (e.g., seer voting their own gold water, wolf publicly admitting identity, fabricating a night action target).
3. The check is **purely mechanical** with zero situational judgment (e.g., guard repeat-protection check, vote candidate eligibility).

**Leave to LLM reasoning when:**
1. The conclusion requires **synthesizing multiple pieces of public information** — cross-verification patterns, contradiction detection, claim credibility weighting. Enumerating these patterns in code produces brittle rules that miss equivalent cases.
2. The answer **depends on situational weight** — there is no single correct answer, only a more or less defensible one (e.g., whether to follow the current vote pile, whether a late-position role claim is suspicious enough to vote for).
3. The right fix is to pass **facts** into the prompt and let the LLM judge. For example, "this player claimed seer in speaking position 7 of 9" is a fact; "this player is suspicious because of their late claim" is a judgment — the code should provide the former, not hard-code the latter.

**Anti-pattern to avoid:** writing a hard-coded function that detects one specific pattern (e.g., seer + witch whose poison target matches the seer's kill result) and injects a conclusion into the prompt. This fixes the reported case but misses all equivalent patterns and creates an ever-growing list of special cases. Instead, inject the underlying facts (night deaths, claim round, speaking position) and let the structured LLM analysis (`analysis` field in speech and vote JSON) reason across all patterns at once.

**The test question:** "Could a competent player, given exactly the same information this AI has, definitively know this action is wrong — or does it require judgment?" If definitively wrong → rule. If requires judgment → LLM reasoning with facts injected.

### Current AI roles

- **Villager**: no private information; analyzes speeches, claims, vote patterns, and deaths.
- **Seer**: uses private checks; strategy forces consistent claiming and counterclaim behavior.
- **Witch**: knows knife target and own medicine use; antidote creates "silver water", not a confirmed good result.
- **Hunter**: can shoot after eligible death; should not randomly shoot without enough confidence.
- **Guard**: knows own protection history; cannot protect the same player two nights in a row.
- **Idiot**: may survive first vote-out by revealing, then loses voting power.
- **Werewolf/Wolf King/White Wolf King/Wolf Beauty**: know wolf teammates. Wolf plan coordinates fake claim, deep cover, bus, rush vote, and misdirection.
- **White Wolf King**: can self-explode during day discussion and take one target. It should not explode just because a seer appears; it should evaluate pressure, checked status, and high-value targets.
- **Wolf Beauty**: charms one non-wolf at night; when she dies, latest living charmed target dies by lovers death. She usually plays deep cover.

## Game Rules Implemented

Roles currently supported:

- Werewolf
- Wolf King
- White Wolf King
- Wolf Beauty
- Villager
- Seer
- Witch
- Hunter
- Guard
- Idiot

Night order:

1. Guard
2. Werewolf
3. Wolf Beauty, only if present
4. Seer
5. Witch

The engine uses a side-elimination win rule:

- Villagers win when all werewolves are eliminated.
- Werewolves win when all deity roles are eliminated, or all civilian villagers are eliminated.

Keep AI prompts consistent with the engine rules. If win conditions change, update both `gameEngine.ts` and AI instructions in `aiPlayer.ts`.

## State And Phase Notes

The main phases are:

- `setup`
- `night_guard`
- `night_werewolf`
- `night_wolf_beauty`
- `night_seer`
- `night_witch`
- `day_announce`
- `day_discuss`
- `day_vote`
- `day_last_words` (voted-out player's final words)
- `hunter_shoot`
- `game_over`
- `review`

Round numbering: night R and day R share the same `round`. `round` only increments when entering the next night — done inside `processVote` (tie/idiot paths), `processLastWordsEnd`, and `processHunterShoot` (vote-sourced shot). Do not increment elsewhere.

`GameState` is stored in the browser through React state. There is no database or persistence layer.

AI night actions are optimized in `useGame.ts`: if the human player has no night role, `resolvePureAiNight` resolves the whole AI night with batched calls (guard/wolf/seer in parallel, witch last because it depends on the kill result).

AI speeches are sequential because later speakers must see earlier speeches (`triggerAiSpeeches` carries a `localState`).

AI voting is **sequential public voting** (`triggerAiVotes`): AIs vote one at a time and each later voter sees the running tally, enabling follow-on/consolidation votes. If the human is eligible to vote, AI voting waits until the human votes first (driven by the `day_vote` effect in `GameBoard.tsx`). Votes are appended one-by-one via `setState` so the tally animates. Do NOT revert this to parallel/hidden voting — it intentionally models real vote-pile dynamics.

### Debugging stuck AI

`useGame.ts` exposes `aiDebug`, and `GameBoard.tsx` shows a development-only diagnostic bar with current phase, current actor, AI activity, and recent action. If the game appears stuck, first check whether it is waiting for a human turn, waiting for a model call, or stopped by a caught AI error. Night AI errors must resolve the outer promise and release `processingRef`; do not reintroduce an unhandled async branch that can leave `aiThinking` true forever.

### Last words (`day_last_words`)

Voted-out players get last words. Night-death last words are also supported through `pendingLastWordsSource === 'night'` when the engine queues them. Hunter/wolf-king death may trigger `hunter_shoot` depending on source and rules. AI last words are auto-generated and shown with a "继续" button; a human's last words use a textarea (can be skipped). Last words are stored as a `Speech` with `isLastWords: true` and become public history that other AIs reason over next round.

### Wolf night planning

Real games forbid daytime wolf coordination, so the wolf team plan is generated **at night** (`maybeGenerateWolfPlan` in `useGame.ts`, right after the kill is locked and before `processNightEnd` reveals deaths). It is only generated when **all wolves are AI** (if a human is a wolf, that human is the captain and AI teammates improvise individually). The plan is stored in `wolfPlan`/`wolfPlanRound` and injected into each AI wolf's day speech as a *reference, not a script* — the prompt explicitly tells wolves to improvise if the dawn result/discussion diverges from the plan. Because it is built before deaths are revealed and from the wolf's own perspective, it never leaks information the wolves could not have at night.

## Current Product Assumptions

- The UI allows up to three human players during setup, but most game interaction logic currently treats the first human player as the active human. Be careful before claiming full multi-human support.
- `app/api/ai-speak/route.ts` and `app/api/ai-vote/route.ts` appear to be older specialized endpoints. The current AI player path primarily uses `app/api/ai/route.ts`.
- The default README is still the create-next-app template and does not document the actual game.
- `app/layout.tsx` uses `next/font/google` for Geist fonts. Production builds can fail in network-restricted environments if Google Fonts cannot be fetched.

## Coding Guidelines

- Prefer keeping game rules in `app/lib/gameEngine.ts` and UI behavior in components/hooks.
- Keep AI hidden-information boundaries strict. AI prompts should only include that player perspective plus public information.
- Do not leak other players' hidden roles or night actions into AI prompts unless the current player could know them.
- Keep route handlers responsible for provider calls and client code responsible for gameplay interaction.
- Preserve Chinese UI copy unless the requested change explicitly asks for another language.
- When modifying shared types in `app/lib/types.ts`, update all affected components, engine helpers, and AI helpers together.
- When changing game rules, add or update focused tests if a test framework is introduced later. At minimum, manually verify affected phase transitions.

## Verification

After meaningful changes, run:

- `npm run build`

If the build fails only because `next/font/google` cannot fetch Geist fonts, report that separately from TypeScript or application errors.
