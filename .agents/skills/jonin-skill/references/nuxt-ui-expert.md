# Nuxt 3 UI Expert Directives

CRITICAL: Do NOT invent your own layout or CSS. You MUST copy the exact component code blocks provided below line-for-line to achieve the Konoha Design System perfectly in ONE SHOT.

## 1. assets/css/main.css
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Roboto:wght@100;300;400;500;700;900&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-bg:      #F8F8F8;
  --color-white:   #FFFFFF;
  --color-black:   #000000;
  --color-accent:  #C89B77;
  --color-muted:   #666666;
  --color-border:  #E5E5E5;
  --font-primary:  'DM Sans', sans-serif;
  --font-body:     'Roboto', sans-serif;
}
body { background-color: var(--color-bg); color: var(--color-black); font-family: var(--font-body); }
.konoha-product-card { transition: transform 0.35s ease, box-shadow 0.35s ease; transform-style: preserve-3d; }
.konoha-product-card:hover { transform: perspective(1000px) rotateX(4deg) rotateY(-4deg) scale3d(1.02, 1.02, 1); box-shadow: 0 24px 60px rgba(0,0,0,0.12); }
.theme-popup-panel { position: absolute; bottom: calc(100% + 12px); left: 0; z-index: 1001; }
```

## 2. components/ThemeSwitcher.vue
```vue
<template>
  <div class="fixed bottom-[80px] lg:bottom-6 left-6 z-[1000]">
    <button @click="isOpen = !isOpen" class="w-12 h-12 rounded-full shadow-lg border-2 border-white text-white hover:scale-110 transition-transform flex items-center justify-center" :style="{ background: currentTheme.bg }"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 0-6.88 2.77C3.39 6.5 2 10.12 2 14a10 10 0 0 0 10 10 10 10 0 0 0 10-10 10 10 0 0 0-10-12z"></path><circle cx="7.5" cy="10.5" r="1.5"></circle><circle cx="10.5" cy="6.5" r="1.5"></circle><circle cx="15.5" cy="8.5" r="1.5"></circle><circle cx="17.5" cy="13.5" r="1.5"></circle></svg></button>
    <div v-if="isOpen" class="theme-popup-panel w-64 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200 p-4">
      <p class="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 font-primary">Select Theme</p>
      <div class="grid grid-cols-5 gap-3">
        <button v-for="theme in THEMES" :key="theme.id" @click="selectTheme(theme.id)" :class="['w-8 h-8 rounded-full border-2 transition-all', activeTheme === theme.id ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-110']" :style="{ background: theme.bg }" :title="theme.name"></button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue';
const THEMES = [
  { id: 'crimson-amber', name: 'Crimson Amber', bg: 'linear-gradient(135deg, #ef4444, #f59e0b)' },
  { id: 'ocean-cyan', name: 'Ocean Cyan', bg: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }
];
const isOpen = ref(false);
const activeTheme = ref('crimson-amber');
onMounted(() => {
  const saved = localStorage.getItem('konoha-theme');
  if (saved) { activeTheme.value = saved; document.documentElement.setAttribute('data-theme', saved); }
});
const selectTheme = (id) => {
  activeTheme.value = id; document.documentElement.setAttribute('data-theme', id);
  localStorage.setItem('konoha-theme', id); isOpen.value = false;
};
const currentTheme = computed(() => THEMES.find(t => t.id === activeTheme.value) || THEMES[0]);
</script>
```

## 3. components/MobileBottomDock.vue
```vue
<template>
  <nav class="lg:hidden fixed bottom-0 left-0 right-0 z-[999] bg-white/95 backdrop-blur-xl border-t border-[var(--color-border)] px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] flex items-center justify-between">
    <NuxtLink to="/" class="flex flex-col items-center gap-1 text-[var(--color-accent)]"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg><div class="w-1 h-1 rounded-full bg-[var(--color-accent)]"></div></NuxtLink>
    <NuxtLink to="/shop" class="flex flex-col items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-black)]"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg></NuxtLink>
    <NuxtLink to="/wishlist" class="flex flex-col items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-black)]"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg></NuxtLink>
    <NuxtLink to="/cart" class="flex flex-col items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-black)] relative"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg><span class="absolute -top-1 -right-1 w-3 h-3 bg-[var(--color-accent)] rounded-full"></span></NuxtLink>
    <NuxtLink to="/account" class="flex flex-col items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-black)]"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></NuxtLink>
  </nav>
</template>
```
