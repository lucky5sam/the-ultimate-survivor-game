<script setup lang="ts">
// The full league rules body, shared between the team-creation wizard (Step 2)
// and the read-only rules modal on the team page. Renders the rules content only
// — the surrounding heading, acknowledgment checkbox, or modal chrome belong to
// the caller. Owns its own scoring-list modal so the "View scoring" link works
// everywhere it's shown.
import { ref } from 'vue'
import SeasonScoringModal from './SeasonScoringModal.vue'

// `scoringZIndex` stacks the nested scoring modal above the rules when the rules
// are themselves shown inside a modal (the team-page case).
defineProps<{ seasonId: string; scoringZIndex?: number }>()

const showScoringModal = ref(false)
</script>

<template>
  <div class="space-y-6 text-sm leading-relaxed text-text-subtle">
    <p>
      This is a for-fun fantasy game built around <em>Survivor</em>. It's a made-up game with made-up
      rules, run by Sam as the <strong>Commissioner and sole proprietor</strong> of the league. Where
      the rules are unclear or something unexpected comes up,
      <strong class="text-text-default"
        >all decisions are finalized by the Commissioner based on his best judgment.</strong
      >
      Play hard, have fun, and don't take it too seriously.
    </p>

    <div
      class="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-subtle p-3 text-text-default"
    >
      <span aria-hidden="true">⏰</span>
      <p>
        <strong>Weekly deadline:</strong> your roster and bounty pick lock every
        <strong>Wednesday at 8:00 PM ET</strong> (episode airtime). Get your changes in before then.
      </p>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">Your Team</h3>
      <ul class="list-disc space-y-1 pl-5">
        <li>Draft a team of <strong>4 Survivor contestants</strong>.</li>
        <li>
          Designate <strong>1 of your 4 as your MVP</strong> — your MVP scores at a
          <strong>1.5× multiplier</strong>; your other 3 score at 1×.
        </li>
        <li>
          You can edit your team and MVP as much as you like for Episodes 1 and 2 at no cost. Starting with Episode 3, penalties apply.
        </li>
        <li>
          Rosters lock at the beginning of each episode and remain locked until scoring has been finalized.
        </li>  
      </ul>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">How Scoring Works</h3>
      <p class="mb-2">Your total score is:</p>
      <p
        class="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-center font-semibold text-text-default"
      >
        Action Points + Bounty Points − Swap Penalties
      </p>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">Action Points</h3>
      <ul class="list-disc space-y-1 pl-5">
        <li>
          Contestants earn points for in-game actions — winning immunity, finding an idol, and more.
          The Commissioner logs these after each episode airs.
        </li>
        <li>Your MVP earns 1.5× on all action points; your other three earn 1×.</li>
      </ul>
      <button
        type="button"
        class="link mt-2 inline-flex items-center gap-1.5 font-semibold text-text-accent hover:text-interactive-accent-hover"
        @click="showScoringModal = true"
      >
        <i class="fa-solid fa-list-ol"></i>
        View the full scoring list for this season
      </button>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">Bounty Picks</h3>
      <ul class="list-disc space-y-1 pl-5">
        <li>
          Each week, pick <strong>one contestant you think will get voted out</strong> — your bounty.
        </li>
        <li>
          A correct pick earns <strong>5 points pre-merge</strong>, <strong>10 post-merge</strong>,
          and <strong>15 for the finale</strong>.
        </li>
        <li>
          Your pick locks <strong>Wednesday at 8:00 PM ET</strong>. Until then you can change it
          freely, and only you can see your own un-locked pick. Your pick carries over week to week
          until you change it.
        </li>
      </ul>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">Swaps</h3>
      <ul class="list-disc space-y-1 pl-5">
        <li>
          <strong>Contestant swap:</strong> drop a contestant and pick up another still in the game.
          <strong>Role change:</strong> move your MVP to a different contestant.
        </li>
        <li>
          <strong>Free swaps through Episode 2</strong> — change your roster or MVP as much as you
          like for Episodes 1 and 2 at no cost. Starting with <strong>Episode 3</strong>, penalties
          apply.
        </li>
        <li>
          After the grace period, each swap costs <strong>−15 (MVP)</strong>,
          <strong>−10 (regular contestant)</strong>, or <strong>−5 (role change)</strong>.
        </li>
        <li>
          You get a maximum of <strong>10 swaps per season</strong>. Only paid swaps (Episode 3
          onward) count toward this limit — free swaps during the grace period don't count against
          it.
        </li>
        <li>
          Later in the season swaps <strong>lock permanently</strong>. Once the swap deadline passes,
          your roster and MVP are set for the rest of the season — watch your team page for the
          cutoff.
        </li>
      </ul>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">Eliminations</h3>
      <ul class="list-disc space-y-1 pl-5">
        <li>
          When one of your contestants is voted out, they stay on your roster and
          <strong>score 0 from that point forward</strong> — but you
          <strong>keep every point they earned</strong> before elimination.
        </li>
        <li>
          You may swap an eliminated contestant out for someone still in the game (subject to the
          swap penalty above).
        </li>
      </ul>
    </div>

    <div>
      <h3 class="mb-1 text-base font-bold text-text-default">Fair Play — No Spoilers</h3>
      <ul class="list-disc space-y-1 pl-5">
        <li>
          This game runs on <em>not</em> knowing what happens next. Using spoilers to inform your
          bounty picks, swaps, or roster is <strong>strictly prohibited.</strong>
        </li>
        <li>
          That includes — but is not limited to — <strong>betting and prediction markets</strong>,
          <strong>Reddit threads</strong>, spoiler wikis, leaked cast or boot lists, and any other
          site or source that reveals results before they air.
        </li>
        <li>
          Play only on what has aired.
          <strong class="text-text-default"
            >Cheating with spoilers can result in dismissal from the season, at the sole discretion
            of the Commissioner.</strong
          >
        </li>
      </ul>
    </div>

    <p>
      The Commissioner runs this league by hand and aims to get everything right, but is human. For
      any dispute, ambiguity, or situation the rules don't cover,
      <strong class="text-text-default">the Commissioner makes the final call.</strong> Rules may be
      adjusted between seasons. Thanks for playing! 🔥
    </p>

    <SeasonScoringModal
      :show="showScoringModal"
      :season-id="seasonId"
      :modal-z-index="scoringZIndex"
      @close="showScoringModal = false"
    />
  </div>
</template>
