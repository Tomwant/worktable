<script setup>
// 通用卡容器：variant = focus | bento | card
defineProps({ variant: { type: String, default: 'card' } })
</script>

<template>
  <article class="card" :class="['glass', 'spot', `v-${variant}`]">
    <slot />
  </article>
</template>