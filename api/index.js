// Handler serverless do Vercel. Importa o build já compilado (dist/), não o
// TypeScript fonte diretamente — assim os aliases "@/..." (já reescritos
// para caminhos relativos pelo tsc-alias durante `npm run build`) resolvem
// normalmente, sem depender de como o builder do Vercel trata TS/paths.
import { createApp } from "../dist/src/app.js";

export default createApp();
