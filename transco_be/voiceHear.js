// What a customer said in a voice message → text, for WhatsApp voice notes
// (server.js) and the website / My Transco 🎤 button (webChatRoutes.js).
//
// Gemini first: it hears Singlish (Sinhala with English cargo words) far
// better than Whisper — in the 2026-11-05 test it got 8/8 notes right,
// Whisper 3.5/8 (Sinhala notes came back as Tamil/Malayalam or gibberish).
// Groq Whisper is the backup when Gemini is down or not set up.
//
// hearAudio({ data: Buffer, mimeType }) → { text, unsure }. "unsure" = it
// couldn't make it out, so the bot asks the customer to type it instead of
// answering a guess.

const axios = require('axios');

// Words Whisper should expect, so they're spelled our way ("Tea Chest",
// not "tea chess"). Kept short: Whisper only reads the first ~220 tokens.
const VOICE_HINT =
  'Transco Cargo, Tea Chest, Gift Box, Wine Box, Quarter CBM box, TV, BL number, booking, drop-off, ' +
  'Seven Hills, Sydney, Sri Lanka, India, sea freight, air freight, door delivery, Colombo, Gampaha, ' +
  'Kandy, Negombo, Ja-Ela, Kurunegala, Galle, Matara, Jaffna, Dehiwala, Wattala, Kadawatha.';
const VOICE_LANGUAGES = ['english', 'sinhala', 'tamil'];

const GEMINI_VOICE_PROMPT =
  'This is a voice message from a customer of Transco Cargo, a Sydney company that ships boxes ' +
  '(Tea Chest, Gift Box, Wine Box, Quarter CBM box, TV) to Sri Lanka and India. Customers speak Sinhala, ' +
  'Tamil, English, or a mix (Sinhala or Tamil with English words like box, tea chest, BL, pickup, door delivery, price).\n' +
  'Write down exactly what was said: Sinhala in Sinhala script, Tamil in Tamil script, English words in English. ' +
  'Write numbers as digits (BL numbers are 6 digits). Do not translate, answer or add anything. ' +
  'Note: "mata" in Sinhala means "to me", not the town Matara.\n' +
  'Reply with JSON only: {"transcript": "...", "confidence": "high|medium|low"}. ' +
  'If there is no speech or you cannot make it out, use an empty transcript and "low".';

async function geminiHear(audio) {
  const model = process.env.GEMINI_VOICE_MODEL || 'gemini-2.5-flash';
  const r = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      contents: [{ role: 'user', parts: [
        { text: GEMINI_VOICE_PROMPT },
        { inline_data: { mime_type: audio.mimeType.split(';')[0], data: audio.data.toString('base64') } }
      ] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    },
    { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, timeout: 30000 }
  );
  const raw = (r.data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const parsed = JSON.parse(raw);
  const text = String(parsed.transcript || '').trim();
  return { text, unsure: text.length < 2 || parsed.confidence === 'low' };
}

const EXT = { 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };

async function whisper(audio, language) {
  const type = audio.mimeType.split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([audio.data], { type: audio.mimeType }), `voice.${EXT[type] || 'ogg'}`);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  form.append('prompt', VOICE_HINT);
  if (language) form.append('language', language);
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form
  });
  if (!response.ok) {
    throw new Error(`Groq transcription failed: ${response.status} ${await response.text()}`);
  }
  const result = await response.json();
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const avg = (k) => (segments.length ? segments.reduce((s, x) => s + (Number(x[k]) || 0), 0) / segments.length : null);
  return {
    text: String(result.text || '').trim(),
    language: String(result.language || language || '').toLowerCase(),
    logprob: avg('avg_logprob'),
    noSpeech: avg('no_speech_prob')
  };
}

async function whisperHear(audio) {
  // Let Whisper detect the language. If it lands on something our
  // customers don't speak (it often mistakes Sinhala for Hindi), try again
  // as Sinhala and as Tamil and keep the one it's more confident about.
  let best = await whisper(audio);
  if (!VOICE_LANGUAGES.includes(best.language)) {
    const retries = await Promise.all(['si', 'ta'].map(l => whisper(audio, l).catch(() => null)));
    for (const r of retries) if (r && r.text && (r.logprob ?? -9) > (best.logprob ?? -9)) best = r;
  }
  const unsure = best.text.length < 2 ||
    (best.noSpeech !== null && best.noSpeech > 0.6) ||
    (best.logprob !== null && best.logprob < -1);
  return { text: best.text, unsure };
}

async function hearAudio(audio) {
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    throw new Error('Neither GEMINI_API_KEY nor GROQ_API_KEY is configured');
  }
  if (process.env.GEMINI_API_KEY) {
    try {
      return await geminiHear(audio);
    } catch (err) {
      console.error('Gemini voice failed, using Whisper:', err.response?.data?.error?.message || err.message);
      if (!process.env.GROQ_API_KEY) throw err;
    }
  }
  return whisperHear(audio);
}

module.exports = { hearAudio };
