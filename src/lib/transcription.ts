import { env } from "@/config/env.js";

// Transcrição de áudio recebido pelo bot do WhatsApp (mensagem de voz) —
// acessibilidade pra quem tem dificuldade de escrever mas consegue mandar
// áudio. A Claude API não recebe áudio diretamente (só texto/imagem/PDF),
// então precisa de um passo de speech-to-text antes. Groq roda o Whisper na
// própria infra deles (mesmo modelo, mesma qualidade do Whisper da OpenAI)
// com cota gratuita de 2.000 requisições/dia e 8h de áudio/dia — cobre o
// volume real de uma barbearia sem custo. Ver GROQ_API_KEY em
// src/config/env.ts.
export const transcriptionConfigured = !!env.GROQ_API_KEY;

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// whisper-large-v3-turbo: mais rápido e mais barato que o whisper-large-v3
// "cheio" (ver pricing do Groq), qualidade equivalente pra fala em
// português — não tem motivo pra usar o modelo maior aqui.
const MODEL = "whisper-large-v3-turbo";

// null = transcrição indisponível/falhou (sem GROQ_API_KEY configurada, ou
// erro de rede/API) — quem chama decide o que fazer (hoje: cai no mesmo
// aviso fixo que já existia pra qualquer mídia não suportada). String vazia
// (trim) também vira null — a Meta às vezes manda áudio silencioso/corrompido
// e o Whisper devolve texto vazio, que não faz sentido mandar pra IA como
// se fosse uma pergunta real.
export async function transcribeAudio(buffer: Buffer, mimeType: string, fileName = "audio.ogg"): Promise<string | null> {
  if (!transcriptionConfigured) return null;

  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), fileName);
    form.append("model", MODEL);
    // Sem "language" fixo: o WhatsApp já manda o áudio no idioma que o
    // cliente falou (quase sempre português aqui), e o Whisper detecta
    // sozinho — forçar "pt" só atrapalharia o raro cliente que manda áudio
    // em outro idioma.

    const res = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[TRANSCRIPTION] Falha ao transcrever áudio via Groq (${res.status}): ${body}`);
      return null;
    }
    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    return text || null;
  } catch (err) {
    console.error("[TRANSCRIPTION] Erro ao transcrever áudio:", (err as Error).message);
    return null;
  }
}
