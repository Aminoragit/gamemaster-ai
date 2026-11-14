"use client";

import type { BossSheet } from "@/lib/types";

/**
 * Boss control panel (BUILD_SPEC.md §7.4) — shown instead of the normal
 * action input on the boss player's turn during a player-controlled boss
 * encounter. Skeleton: ability cards, menace meter, taunt (hybrid
 * on-device line), and the boss's private objective.
 */
export interface BossControlsProps {
  boss: BossSheet;
  isMyTurn: boolean;
  onAbility: (abilityId: string) => void;
  onTaunt: () => void;
}

export default function BossControls({ boss, isMyTurn, onAbility, onTaunt }: BossControlsProps) {
  const signatureReady = boss.menace >= 100;
  return (
    <section className="rounded-xl border border-red-500/30 bg-red-950/30 p-4">
      <header className="mb-1 flex items-baseline justify-between">
        <h2 className="font-semibold text-red-200">
          👹 You are the Boss — {boss.name}, {boss.title}
        </h2>
        <span className="text-sm text-red-200/70">
          HP {boss.hp}/{boss.maxHp}
        </span>
      </header>
      <p className="mb-3 text-xs text-red-200/70">
        Your objective: wipe the party — or stall them until the encounter timer runs out.
        Menace {boss.menace}/100{signatureReady ? " — signature move unlocked!" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {boss.abilities.map((a) => (
          <button
            key={a.id}
            disabled={!isMyTurn || a.cooldownLeft > 0}
            onClick={() => onAbility(a.id)}
            className="rounded-lg bg-red-900/60 px-3 py-2 text-sm text-red-100 hover:bg-red-800 disabled:opacity-40"
            title={a.description}
          >
            {a.name}
            {a.cooldownLeft > 0 ? ` (${a.cooldownLeft})` : ""}
          </button>
        ))}
        <button
          disabled={!isMyTurn || !signatureReady}
          onClick={() => onAbility(boss.signatureMove.id)}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
          title={boss.signatureMove.description}
        >
          ★ {boss.signatureMove.name}
        </button>
        <button
          onClick={onTaunt}
          className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
        >
          Taunt ⚡
        </button>
      </div>
    </section>
  );
}
