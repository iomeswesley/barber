import type { Vertical } from "./types.js";
import { odonto } from "./odonto.js";
import { barbearia } from "./barbearia.js";

const VERTICALS: Record<string, Vertical> = { odonto, barbearia };

// Carregado uma vez no boot a partir de VERTICAL (env.ts já valida que é
// "odonto" ou "barbearia" antes de chegar aqui — ver src/config/env.ts).
// Cada deploy Vercel (odonto/barbearia, e futuros verticais) roda o mesmo
// código só com essa variável e o DATABASE_URL diferentes.
export function loadVertical(id: string): Vertical {
  const vertical = VERTICALS[id];
  if (!vertical) {
    throw new Error(`Vertical "${id}" desconhecido. Verticais disponíveis: ${Object.keys(VERTICALS).join(", ")}`);
  }
  return vertical;
}

export type { Vertical };
