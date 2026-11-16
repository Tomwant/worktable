<script setup>
import { toast } from '../stores/index.js'
</script>

<template>
  <transition name="toast"><div v-if="toast" class="toast">{{ toast }}</div></transition>
</template>