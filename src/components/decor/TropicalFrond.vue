<script setup lang="ts">
// A stylized palm/tropical frond as pure vector — a fan of pointed
// leaves. Color comes from `currentColor`, so set text color + opacity
// on the parent (e.g. text-material-frond opacity-30). Decorative only.
</script>

<template>
  <svg
    viewBox="0 0 200 200"
    class="pointer-events-none select-none"
    fill="currentColor"
    aria-hidden="true"
  >
    <defs>
      <path id="frond-leaf" d="M0 0 C 22 -34 22 -100 0 -150 C -22 -100 -22 -34 0 0 Z" />
    </defs>
    <g transform="translate(100 198)">
      <use href="#frond-leaf" transform="rotate(-74) scale(0.88)" />
      <use href="#frond-leaf" transform="rotate(-47) scale(0.97)" />
      <use href="#frond-leaf" transform="rotate(-20)" />
      <use href="#frond-leaf" transform="rotate(6)" />
      <use href="#frond-leaf" transform="rotate(33) scale(0.97)" />
      <use href="#frond-leaf" transform="rotate(62) scale(0.88)" />
    </g>
  </svg>
</template>
