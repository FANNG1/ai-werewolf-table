<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Notes

This is a Chinese Werewolf game built with Next.js 16, React 19, TypeScript, and Tailwind CSS. The app supports one primary human player playing with AI players, including setup, role assignment, night actions, day discussion, voting, game-over reveal, and AI-powered review.

## Important Commands

- `npm run dev` starts the development server.
- `npm run build` runs the production build.
- `npm run start` serves a production build.

Before changing Next.js-specific APIs, routing, metadata, fonts, server actions, route handlers, or config, read the relevant local Next.js docs under `node_modules/next/dist/docs/`.

## Environment

AI features call DeepSeek through server route handlers. The app expects:

- `DEEPSEEK_API_KEY` in `.env.local`

Do not expose API keys to client components. Keep provider calls inside `app/api/**/route.ts`.

## Main Architecture

- `app/page.tsx` is the setup entry: landing screen, player setup, role setup, then redirects to `/game?config=...`.
- `app/game/page.tsx` loads the encoded game config from search params and renders the game board or review screen.
- `app/hooks/useGame.ts` owns client-side game state transitions and is the ONLY place async AI orchestration lives. Engine functions stay pure/sync; the hook calls them and weaves in LLM calls. A `processingRef` guard prevents concurrent AI triggers.
- `app/lib/gameEngine.ts` contains pure game mechanics: `initGame`, `nextNightPhase`, `processNightEnd`, `processVote`, `processLastWordsEnd`, `processHunterShoot`, and `checkWinCondition`. No side effects, no LLM calls.
- `app/lib/types.ts` defines shared game types.
- `app/lib/roles.ts` defines role names, teams, descriptions, emojis, presets, and role helpers (`isWerewolf`, `isDeity`, `isCivilian`).
- `app/lib/aiPlayer.ts` builds each player's private perspective (`buildPlayerPerspective`) and calls `/api/ai` for every AI decision: `generateAiSpeech`, `generateAiVote`, `decideNightAction` (guard/seer), `decideWerewolfKill`, `decideWitchAction`, `decideShotTarget` (hunter/wolf king), `generateWolfPlan` (night), and `generateLastWords`. JSON decisions go through `callAiJson` (one retry) + `matchPlayerByName` fuzzy matching, and every decision has a non-LLM fallback so a failed/empty call never stalls the game.
- `app/lib/reviewHelpers.ts` builds readable round timelines and full transcripts for post-game analysis.
- `app/components/game/**` contains phase UI, player cards, speech bubbles, and the main board.
- `app/components/setup/**` contains player and role setup UI.
- `app/components/review/GameReview.tsx` displays final identities, timeline, and AI coach analysis.

## Game Rules Implemented

Roles currently supported:

- Werewolf
- Wolf King
- Villager
- Seer
- Witch
- Hunter
- Guard
- Idiot

Night order:

1. Guard
2. Werewolf
3. Seer
4. Witch

The engine uses a side-elimination win rule:

- Villagers win when all werewolves are eliminated.
- Werewolves win when all deity roles are eliminated, or all civilian villagers are eliminated.

Keep AI prompts consistent with the engine rules. If win conditions change, update both `gameEngine.ts` and AI instructions in `aiPlayer.ts`.

## State And Phase Notes

The main phases are:

- `setup`
- `night_guard`
- `night_werewolf`
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

### Last words (`day_last_words`)

Only **voted-out** players get last words; night-killed players get none (matches common rules; hunter/wolf-king night death instead triggers `hunter_shoot`). Flow: `processVote` → `day_last_words` → (`hunter_shoot` if the dead player is hunter/wolf king) → next night, all sequenced through `processLastWordsEnd`. AI last words are auto-generated and shown with a "继续" button; a human's last words use a textarea (can be skipped). Last words are stored as a `Speech` with `isLastWords: true` and become public history that other AIs reason over next round.

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
