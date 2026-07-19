import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import App from "./App.vue";
import router from "./router";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      // Bewusst ein NIE aktiver Selektor: PrimeVue bleibt immer im Light-Theme.
      // Die App hat ein eigenes Dark-Mode-System (data-theme auf <html> +
      // --color-*-Variablen). Würde PrimeVue via [data-theme="dark"] mitdunkeln,
      // sickerte seine globale (helle) Textfarbe in hart-hell gestylte Bereiche
      // (z.B. die weiße Login-Karte) → unlesbar. PrimeVue-Komponenten werden
      // stattdessen bei Bedarf gezielt über :deep()/CSS-Variablen angepasst.
      darkModeSelector: ".pv-force-dark-never",
    },
  },
});
app.mount("#app");
