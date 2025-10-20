/*******************************************************
 * index.js - bot whatsapp-web.js + OpenAI (Whisper)
 *******************************************************/

import { fileURLToPath } from "url";
import { dirname } from "path";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import "dotenv/config";
import fs from "fs";
import path from "path";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import ffmpeg from "fluent-ffmpeg";
import vosk from "vosk";
const ofertaEnviada = {}; // controla se a oferta já foi enviada por chat



function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const conversationContext = {};
const MAX_CONTEXT_MESSAGES = 7; // mantém as últimas 6 trocas
    

function atualizarContexto(chatId, novaMensagem) {
  if (!conversationContext[chatId]) { 
    conversationContext[chatId] = { messages: [], tokenCount: 0 };
  }

  conversationContext[chatId].messages.push(novaMensagem);

  if (conversationContext[chatId].messages.length > MAX_CONTEXT_MESSAGES) {
    conversationContext[chatId].messages.shift();
  }
}



// 🧠 Função separada para contar tokens
function contarTokens(chatId, tokensUsados) {
  if (!conversationContext[chatId]) conversationContext[chatId] = { tokenCount: 0, mensagens: [] };
  if (!conversationContext[chatId].tokenCount) conversationContext[chatId].tokenCount = 0;
  conversationContext[chatId].tokenCount += tokensUsados;

  if (conversationContext[chatId].tokenCount > 6000) {
    console.log("🔁 Limpando contexto antigo:", chatId);
    const ultimas = conversationContext[chatId].messages.slice(-5);
    conversationContext[chatId] = {
      messages: ultimas,
      tokenCount: 500 // ajusta conforme o peso médio dessas mensagens
    };
  }
}
// ------------------ Controle de emojis ------------------
const emojis = ["😀", "😄", "😁", "😎", "😉", "🤔", "😅", "😂", "🥰", "😈", "😻", "😇"];
let ultimoEmoji = null;

function getEmojiAleatorio() {
  // filtra emojis que não sejam o último usado
  const opcoes = emojis.filter(e => e !== ultimoEmoji);
  const escolhido = opcoes[Math.floor(Math.random() * opcoes.length)];
  ultimoEmoji = escolhido;
  return escolhido;
}

const MODEL_PATH = path.join(__dirname, "vosk-model-small-pt-0.3");
vosk.setLogLevel(0);
const model = new vosk.Model(MODEL_PATH);

async function transcreverAudio(localPath) {
  return new Promise((resolve, reject) => {
    const rec = new vosk.Recognizer({ model, sampleRate: 16000 });

    const process = ffmpeg(localPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("s16le")
      .on("error", (err) => reject(err))
      .pipe();

    process.on("data", (data) => rec.acceptWaveform(data));
    process.on("end", () => {
      const result = rec.finalResult();
      rec.free();
      resolve(result.text || "");
    });
  });
}

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const LINK_OFERTA = "https://www.fanvue.com/likinha";


const client = new Client({ authStrategy: new LocalAuth() });

// 🧠 Armazena memórias por chat e marca último uso
const memoryStore = {};
const followTimers = {};

// 🕓 Limpa memórias inativas (sem falar há mais de 1h)
setInterval(() => {
  const agora = Date.now();
  for (const id in memoryStore) {
    if (memoryStore[id].lastActive && agora - memoryStore[id].lastActive > 60 * 60 * 1000) {
      delete memoryStore[id];
      log(`🧹 memória limpa do chat ${id}`);
    }
  }
}, 30 * 60 * 1000); // a cada 30 minutos



client.on("qr", (qr) => {
  console.log("📱 escaneie este QR (whatsapp do celular que será a IA):");
  qrcode.generate(qr, { small: true });
});
client.on("ready", () => console.log("🤖 bot conectado no WhatsApp!"));


// converter (mantive caso precise converter arquivos locais)
function converterParaWhatsApp(filePath) {
  return new Promise((resolve, reject) => {
    const saida = filePath.replace(/\.[^/.]+$/, "_fixed.ogg");
    ffmpeg(filePath)
      .audioCodec("libopus")
      .audioChannels(1)
      .audioFrequency(48000)
      .audioBitrate("64k")
      .toFormat("ogg")
      .on("end", () => resolve(saida))
      .on("error", reject)
      .save(saida);
  });
}

// ---------------- audios / previas ------------------
const audiosDrive = [
  { file: "fixed_prontinho__so_ascessar_o_conteudo.ogg", url: "https://drive.google.com/uc?export=download&id=1Lw-KiIv9V7pzPUvYG_djcuHtLiio7Frh" },
  { file: "fixed_to_indo_pra_acad.ogg", url: "https://drive.google.com/uc?export=download&id=1Be41WQoXIxNFhWzt8H5tGdRHk2e-Ee7Y" },
  { file: "fixed_voce_que_me_ver_peladinha.ogg", url: "https://drive.google.com/uc?export=download&id=1bEJqkr6FxmNZtV_VcYrziyCMP3Z8VTAz" },
  { file: "fixed_salva_meu_contato.ogg", url: "https://drive.google.com/uc?export=download&id=1y18Kgjargpxy1NAx3Mu6H2WYk0nMp9Yv" },
  { file: "fixed_quer_q_te_explique.ogg", url: "https://drive.google.com/uc?export=download&id=1ed1g_2JA1ATIhDretNZ3EXmQziw2p0Mm" },
  { file: "fixed_pra_me_ver_nua_tem_que_comprar_os_packs.ogg", url: "https://drive.google.com/uc?export=download&id=19drb30U3fwSzRe8nS_HtCZFw4QTR-P0H" },
  { file: "fixed_pra_vc_me_ver_pelada_tem_que_pagar.ogg", url: "https://drive.google.com/uc?export=download&id=1RhZarneh_YSBn1QME9mi4CbjMmpktRCL" },
  { file: "fixed_saio_com_quem_ja_e_meu_cliente.ogg", url: "https://drive.google.com/uc?export=download&id=1gNds3pXyV_YYYzCUqzVg2BTirgw4IMst" },
  { file: "fixed_vc_demora_muito_pra_responder.ogg", url: "https://drive.google.com/uc?export=download&id=1ownw2nY3MooknDGkC6Fzykaq-QgS-nSg" },
  { file: "fixed_sou_de_vdd.ogg", url: "https://drive.google.com/uc?export=download&id=1YLtFCKezM5MimKRJLi2J8P0ujzcTd7Qz" },
  { file: "fixed_pedindo_pra_aguardar.ogg", url: "https://drive.google.com/uc?export=download&id=1Q3Th_tFRd8eVk5e5FHHy9C9nrkIBVvAB" },
  { file: "fixed_oi_gatinho_lindo.ogg", url: "https://drive.google.com/uc?export=download&id=1y5f5jizqFJHqZ1ygfaAooY3VlkoJWq-t" },
  { file: "fixed_ja_to_com_sdd.ogg", url: "https://drive.google.com/uc?export=download&id=1kfcn88RS2rVIIDwtd8pK5eBWQkqRVgjn" },
  { file: "fixed_gravei_me_gozando_todinha.ogg", url: "https://drive.google.com/uc?export=download&id=1qzTAxv1OrmiQyJXmkM3onx2cZRJf1Q3H" },
  { file: "fixed_o_que_achou_das_amostras.ogg", url: "https://drive.google.com/uc?export=download&id=1JID4OZ8lY6ddDKnXfrsUKjiSrRAxPfSS" },
  { file: "fixed_bom_dia_meu_cliente_favorito.ogg", url: "https://drive.google.com/uc?export=download&id=11qw_EAYgmZF2MydCXIpdSZJd1-ny_to-" },
  { file: "fixed_a_nao_esquece_de_manda_o_comprovante.ogg", url: "https://drive.google.com/uc?export=download&id=1hFNadVThTjCw9EfFLTJ4nR4o65Rxh6uX" },
  { file: "Bom dia-Não sou fake.ogg", desc: "cumprimento e prova social", url: "https://drive.google.com/uc?export=download&id=1nn8otk8CBGXp2GC-_4NIIgRdiKPkw4dj" },
];

const allAudios = audiosDrive.filter(a => a && a.file).map(a => a.file);
const audiosDriveMap = Object.fromEntries(audiosDrive.map(a => [a.file, a.url]));

// --- controles por contato (não repetir)
const sentAudioByContact = {}; // {chatId: Set}
// --- gatilhos
const gatilhosAudio = [
  "áudio","audio","voz","fala comigo","quero te ouvir","manda um áudio","me manda áudio",
  "me manda sua voz","grava pra mim","me fala com sua voz"
];

const falasProvocantes = [
  "hm?", "ué rs", "fala mais disso 😏", "sério?", "assim você me deixa curiosa 😜",
  "continua…", "gostei disso 😶‍🌫️", "ah é? 👀", "me convence melhor então rs"
];


// helper: registra audio enviado e verifica se já enviado
function audioJaEnviado(chatId, audioName) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }
  return sentAudioByContact[chatId].audios.has(audioName);
}

function registrarAudioEnviado(chatId, audioName) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
    }
  sentAudioByContact[chatId].audios.add(audioName);
}

// ---------- simulação de digitação / gravação ----------
async function simularDigitando(chatId, duracao = 6000) {
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    await sleep(duracao);
    await chat.clearState();
  } catch (e) {
    log("erro simularDigitando:", e.message);
  }
}

async function simularGravando(chatId, duracao = 4000) {
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateRecording();
    await sleep(duracao);
    await chat.clearState();
  } catch (e) {
    log("erro simularGravando:", e.message);
  }
}



// Função para limpar repetições e excesso de caracteres
function limparTexto(text) {
  return text
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1') // remove palavras repetidas tipo "e e"
    .replace(/\s{2,}/g, ' ')               // tira espaços duplos
    .replace(/\.\.+/g, '.')                // reduz "..." duplicados
    .replace(/(kk+)\1+/gi, '$1')           // remove repetições exageradas de kkkk
    .trim();
}

// função para deixar as respostas mais humanas e naturais (no estilo "eu")
function refinarFala(texto) {
  if (!texto) return "";

  // corrige espaços e pontuação
  texto = texto
    .replace(/\s+/g, " ")
    .replace(/\s([?.!])/g, "$1")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s*\?\s*/g, "? ")
    .replace(/\s*\!\s*/g, "! ")
    .trim();

  // substituições pra tirar cara de texto gerado
  const substituicoes = [
    { de: /é um lugar onde a curiosidade ganha vida/gi, para: "lá rola um clima massa" },
    { de: /eu tenho certeza que você vai amar o que encontra lá/gi, para: "acho que você vai curtir o que tem lá" },
    { de: /você pode conferir aqui/gi, para: "dá uma olhada" },
    { de: /vai se inscrever\??/gi, para: "bora ver?" },
    { de: /prometo\.?/gi, para: "😉" },
    { de: /descobrir muito/gi, para: "me conhecer melhor" },
    { de: /curiosidade ganha vida/gi, para: "as coisas ficam mais interessantes" },
  ];

  for (const sub of substituicoes) {
    texto = texto.replace(sub.de, sub.para);
  }

  // variações dinâmicas pra deixar natural
  const sinonimos = {
    "dá uma olhada": ["confere lá", "olha isso aqui", "vem ver", "espia só"],
    "acho que você vai curtir": ["acho que vai gostar", "certeza que vai curtir", "é bem sua vibe", "vai curtir o que tem lá"],
    "lá rola um clima massa": ["é um cantinho bem daora", "lá é diferente, você vai ver", "tem um clima gostoso lá dentro", "lá o papo flui de verdade"],
    "bora ver?": ["topa ver?", "vai dar uma olhada?", "vem ver comigo?", "que tal dar uma olhada?"]
  };

  for (const chave in sinonimos) {
    if (texto.includes(chave)) {
      const opcoes = sinonimos[chave];
      const escolha = opcoes[Math.floor(Math.random() * opcoes.length)];
      texto = texto.replace(chave, escolha);
    }
  }

  // deixa tudo com a primeira letra minúscula
  texto = texto.charAt(0).toLowerCase() + texto.slice(1);
  if (texto.endsWith('.')) texto = texto.slice(0, -1); // tira ponto final
  
  return texto;
}


function gerarGatilho() {
  const gatilhos = [
    "me conta mais disso",
    "e o que você quis dizer com isso",
    "kkk gostei disso viu",
    "tô curiosa agora",
    "hmm e depois disso?",
    "fala mais pra mim",
    "e se eu te contar uma coisa agora 😏",
    "kkk adoro quando falam assim",
    "interessante isso hein",
    "agora fiquei pensando nisso rs"
  ];
  return Math.random() < 0.4 ? " " + gatilhos[Math.floor(Math.random() * gatilhos.length)] : "";
}


// Função principal de envio humanizado
// Função principal de envio humanizado (corrigida e aprimorada)
async function sendTextHuman(chatId, text, isFirst = false) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }

  if (!text) return;
  const msg = String(text).trim();
  if (!msg) return;
  // evita repetição de link e oferta
  if (msg.includes("fanvue.com") || msg.includes(LINK_OFERTA)) {
  if (ofertaEnviada[chatId]) {
    console.log(`⚠️ Oferta já enviada para ${chatId}, pulando...`);
    return; // já mandou antes
  }
  ofertaEnviada[chatId] = true; // marca que enviou
}

  // Espera 6 segundos antes de responder para ver se o lead vai continuar digitando
  await sleep(3000 + Math.random() * 2000);

  // Sempre simula digitação antes de responder
  await simularDigitando(chatId, 2000 + Math.random() * 2000);

  // 🟢 CASO CONTENHA LINK — dividir texto e enviar o link isolado
  const linkMatch = msg.match(/https?:\/\/\S+/);
  if (linkMatch) {
    const link = linkMatch[0];
    const texto = msg.replace(link, '').trim();

    if (texto) {
      await client.sendMessage(chatId, limparTexto(texto));
      await sleep(1500 + Math.random() * 1500);
    }

    // link isolado (em caixa separada)
    await client.sendMessage(chatId, link);
    return;
  }

  // Divide o texto em pequenas partes curtas (máx. 2 linhas cada)
  const partes = msg
    .split(/[.!?]/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      if (p.length > 70) {
        const quebradas = p.match(/.{1,200}(?:\s|$)/g) || [p];
        return quebradas.map(k => k.trim());
      }
      return [p];
    })
    .flat();

  // Define quantas partes mandar (1–2 normalmente, raramente 3)
  const random = Math.random();
  const qtd = Math.min(partes.length, random < 0.6 ? 1 : random < 0.95 ? 2 : 3);
  const escolhidas = partes.slice(0, qtd);

  // Decide se vai adicionar emoji
  const addEmoji = !isFirst && Math.random() < 0.15;
  let emoji = "";

  if (addEmoji) {
    const emojisList = ["😊", "😉", "😏", "😻", "❤️", "😈", "🤭", "🥰", "😘"];
    const used = sentAudioByContact[chatId]?.usedEmojis || new Set();
  
    // remove emojis repetidos seguidos (último igual)
    let available = emojisList.filter(e => !used.has(e));
    if (available.length === 0) {
      used.clear(); // zera se já usou todos
      available = [...emojisList];
    }
  
    // evita repetir o último emoji enviado
    const lastEmoji = Array.from(used).pop();
    available = available.filter(e => e !== lastEmoji);
  
    if (available.length > 0) {
      emoji = " " + available[Math.floor(Math.random() * available.length)];
      used.add(emoji.trim());
      sentAudioByContact[chatId].usedEmojis = used;
    }
  }
  
  let enviouLink = false;

  // Envia mensagens com pausas naturais e digitação simulada
  for (let i = 0; i < escolhidas.length; i++) {
    // evitar duplicação de link
if (escolhidas[i].includes("fanvue.com") || escolhidas[i].includes("http")) {
  if (enviouLink) continue; // já mandou, pula
  enviouLink = true;
}

    if (i > 0) {
      await sleep(2000 + Math.random() * 2500);
      await simularDigitando(chatId, 1500 + Math.random() * 2500);
    }

    const isLast = i === escolhidas.length - 1;
    let textoFinal = refinarFala(limparTexto(escolhidas[i]));

    // Adiciona risadas ocasionais
    if (Math.random() < 0.1) textoFinal += " kkk";

    // Adiciona gatilho apenas no último texto
    if (isLast) textoFinal += gerarGatilho();

    // Aplica emoji (quando tiver)
    textoFinal += emoji;

    await client.sendMessage(chatId, textoFinal);
atualizarContexto(chatId, { role: "assistant", content: textoFinal });

if (textoFinal.includes("https://")) {
  const [textoAntes, link] = textoFinal.split("https://");
  if (textoAntes.trim()) await client.sendMessage(chatId, textoAntes.trim());
  await client.sendMessage(chatId, "https://" + link.trim());
  continue;
}

  }
  }



// ---------- helper mime ----------
function getMimeByName(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  if (ext === "opus") return "audio/opus";
  if (ext === "ogg") return "audio/ogg; codecs=opus";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  return "audio/ogg";
}

async function sendAudioHuman(chatId, audioName) {
  try {
    if (!audioName || typeof audioName !== "string") {
      await sendTextHuman(chatId, "ops, meu áudio bugou 😅");
      return;
    }

    // verifica se já foi enviado nesse chat
    if (audioJaEnviado(chatId, audioName)) {
      // fallback: envia texto curto em vez do áudio repetido
      await sendTextHuman(chatId, "já te mandei esse áudio antes, mas posso te mandar outra coisa 😏");
      return;
    }

    const audioUrl = audiosDriveMap[audioName];
    if (!audioUrl) {
      await sendTextHuman(chatId, "não achei esse áudio agora 😅");
      return;
    }

    // simula digitando alguns segundos e depois gravação
    await simularDigitando(chatId, 2000 + Math.floor(Math.random() * 2000));
    await simularGravando(chatId, 3000 + Math.floor(Math.random() * 2000));

    // baixa arquivo
    const resp = await axios.get(audioUrl, { responseType: "arraybuffer", maxRedirects: 5, timeout: 20000 });
    const buffer = Buffer.from(resp.data);
    const base64 = buffer.toString("base64");
    const mime = getMimeByName(audioName);
    const media = new MessageMedia(mime, base64, audioName);

    // envia como voz (PTT)
    await client.sendMessage(chatId, media, { sendAudioAsVoice: true });

    registrarAudioEnviado(chatId, audioName);
    log("✅ Áudio enviado:", audioName, "->", chatId);
  } catch (err) {
    console.error("Erro sendAudioHuman:", err?.message || err);
    try {
      await sendTextHuman(chatId, "tive um probleminha ao enviar o áudio, me espera..."); // fallback
    } catch (e) {}
  }
}

// ---------- gatilho textual para audios (usa o mapa audioTriggers) ----------
const audioTriggers = {
  "bom dia": "fixed_bom_dia_meu_cliente_favorito.ogg",
  "vc é fake": "fixed_sou_de_vdd.ogg",
  "vc é real": "fixed_sou_de_vdd.ogg",
  "fake": "fixed_sou_de_vdd.ogg",
  "comprovante": "fixed_a_nao_esquece_de_manda_o_comprovante.ogg",
  "quero pack": "fixed_pra_me_ver_nua_tem_que_comprar_os_packs.ogg",
  "amostra": "fixed_o_que_achou_das_amostras.ogg",
  "mostra": "fixed_oi_gatinho_lindo.ogg",
  "gratis": "fixed_oi_gatinho_lindo.ogg",
  "gostosa": "fixed_gravei_me_gozando_todinha.ogg",
  "gozar": "fixed_gravei_me_gozando_todinha.ogg",
  "goze": "fixed_gravei_me_gozando_todinha.ogg",
  "pelada": "fixed_pra_me_ver_nua_tem_que_comprar_os_packs.ogg",
  "nua": "fixed_pra_me_ver_nua_tem_que_comprar_os_packs.ogg",
  "saudade": "fixed_ja_to_com_sdd.ogg",
  "sdd": "fixed_ja_to_com_sdd.ogg",
  "demora": "fixed_vc_demora_muito_pra_responder.ogg",
  "salva": "fixed_salva_meu_contato.ogg",
  "prontinho": "fixed_prontinho__so_ascessar_o_conteudo.ogg",
  "duvida": "fixed_quer_q_te_explique.ogg",
  "explica": "fixed_quer_q_te_explique.ogg",
  "oi": "fixed_oi_gatinho_lindo.ogg",
};

function checkAudioTrigger(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const key in audioTriggers) {
    if (lower.includes(key)) return audioTriggers[key];
  }
  return null;
}

// ---------- memória / followups ----------
const firstAudioName = "fixed_oi_gatinho_lindo.ogg";

function resetFollowUps(chatId) {
  if (!followTimers[chatId]) return;
  for (const t of followTimers[chatId]) clearTimeout(t);
  delete followTimers[chatId];
}
function scheduleFollowUps(chatId) {
  if (!followTimers[chatId]) followTimers[chatId] = [] // garante que o array exista
  resetFollowUps(chatId);
  followTimers[chatId] = [];

  const t3 = setTimeout(async () => {
    try {
      log("followup 3m -> pressao media:", chatId);
      const file = checkAudioTrigger("sdd") || "fixed_ja_to_com_sdd.ogg";
      if (file && audiosDriveMap[file] && !audioJaEnviado(chatId, file)) {
        await sendAudioHuman(chatId, file);
      } else {
        await sendTextHuman(chatId, "amor, to aqui ainda, se quiser ver mais tem que garantir seu acesso ok", false);
      }
      await sleep(3000 + Math.floor(Math.random() * 2000));
      await sendTextHuman(chatId, `quer ver mais? entra no meu onlyfans 💕 ${LINK_OFERTA}`, false);
    } catch (e) {
      log("erro followup:", e.message);
    }
  }, 3 * 60 * 1000);

  followTimers[chatId].push(t3); // agora sempre vai existir
}

// ---------- OpenAI interaction ----------
async function askOpenAI(chatId, userText) {
  const timeoutMs = 20000; // 20s timeout
  const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("timeout")), timeoutMs));




  const systemPrompt = `
você conversa como uma mulher charmosa e envolvente, sem usar letras maiúsculas e com pontuação mínima.
as mensagens devem ser curtas, fluidas e provocantes, mas sem exagerar na naturalidade.
fale com confiança e leve mistério, mantendo sempre o interesse da outra pessoa.

use humor leve e ironia sutil, terminando algumas mensagens com um gancho que incentive resposta.
no máximo 10% das mensagens podem conter 1 emoji (nunca repita o mesmo emoji em sequência).

nos primeiros 60 segundos de conversa, foque em criar conexão, curiosidade e interesse — sem divulgar nada ainda.
após esse tempo, apresente de forma natural o convite para conhecer o canal ${LINK_OFERTA}.
seja persuasiva e estratégica: use gatilhos mentais de curiosidade, exclusividade e prova social.

objetivo principal: fazer com que o lead **se inscreva no canal** ${LINK_OFERTA}.
só continue a conversa oferecendo novos conteúdos ou benefícios depois que o lead confirmar que se inscreveu
(respostas como "já me inscrevi" ou "me inscrevi" contam como confirmação).

se o lead confirmar a inscrição, agradeça de forma simpática e continue a conversa de forma leve e envolvente.
se não confirmar, tente apenas uma vez insistir, de forma sutil e inteligente, sem repetir frases.

evite repetir expressões, estruturas ou palavras em sequência — varie o tom e as abordagens.
quando fizer sentido mandar áudio, responda com <<AUDIO:nome.ext>>.

nunca peça dados pessoais, senhas ou pagamentos.

lista de audios disponíveis:
${allAudios.map(a => `- ${a}`).join("\n")}

`;


// 📨 Fila global por usuário — evita respostas simultâneas


// monta contexto de mensagens para enviar pra API
const messages = [
  { role: "system", content: systemPrompt },
  ...(conversationContext[chatId]?.messages || []),
  { role: "user", content: userText }
];

try {
  const completion = await Promise.race([
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 400,
    }),
    timeoutPromise
  ]);

  const resposta = completion.choices?.[0]?.message?.content || "";
  const tokensUsados = completion.usage?.total_tokens || 0;
  contarTokens(chatId, tokensUsados);
  atualizarContexto(chatId, { role: "assistant", content: resposta });
  return resposta;
} catch (err) {
  log(`⚠️ Erro ou timeout na OpenAI: ${err.message}`);
  return "";
}
}// 📨 Fila por usuário para evitar respostas simultâneas
const filaMensagens = {};

async function processarFila(chatId, handler) {
  if (filaMensagens[chatId]) await filaMensagens[chatId];
  const promessa = handler().catch(console.error);
  filaMensagens[chatId] = promessa.finally(() => delete filaMensagens[chatId]);
  return promessa;
}

client.on("message", async (msg) => {
  const chatId = msg.from;

  await processarFila(chatId, async () => {
    resetFollowUps(chatId);

    // 🧠 garante que o contexto exista antes de atualizar
    if (!conversationContext[chatId]) {
      conversationContext[chatId] = { messages: [], tokenCount: 0 };
    }

    // texto base
    let text = msg.body || "";
    atualizarContexto(chatId, { role: "user", content: text });

    // inicializa memória
    if (!memoryStore[chatId]) memoryStore[chatId] = { history: [], lastActive: Date.now() };
    memoryStore[chatId].lastActive = Date.now();

    // transcreve se tiver áudio
    try {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const mime = media.mimetype || "";
        const ext = mime && mime.includes("/") ? mime.split("/")[1].split(";")[0] : "ogg";
        const tmpName = path.join(__dirname, `tmp_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpName, Buffer.from(media.data, "base64"));
        try {
          text = await transcreverAudio(tmpName);
          log("🗣️ Transcrição (Vosk):", text);
        } catch (e) {
          log("Erro transcrevendo com Vosk:", e.message);
        } finally {
          if (fs.existsSync(tmpName)) fs.unlinkSync(tmpName);
        }
      }
    } catch (err) {
      log("erro processando media:", err);
    }

    // registra memória
    memoryStore[chatId].history.push({ role: "user", content: text });
    if (memoryStore[chatId].history.length > 16) memoryStore[chatId].history.shift();
    log("mensagem do lead:", text);

    // pausa natural
    await sleep(6000);

    // primeiro gera a resposta da IA
const reply = await askOpenAI(chatId, text) || "";
const replyText = String(reply || "");

// depois verifica se ela quer mandar áudio (<<AUDIO:...>>)
const audioMatch = replyText.match(/<<AUDIO:\s*([^>]+)>>/i);
if (audioMatch) {
  const fname = audioMatch[1].trim();
  if (audiosDriveMap[fname]) {
    await sendAudioHuman(chatId, fname);
  } else {
    await sendTextHuman(chatId, "tive um probleminha pra achar o áudio 😅", false);
  }
  scheduleFollowUps(chatId);
  return;
}

// caso a IA não tenha sugerido áudio, verifica gatilhos simples opcionais
const trig = checkAudioTrigger(text);
if (trig && audiosDriveMap[trig] && !audioJaEnviado(chatId, trig) && Math.random() < 0.4) {
  // 40% de chance de complementar com um áudio extra
  await sendAudioHuman(chatId, trig);
}

// envia a resposta textual da IA normalmente
await sendTextHuman(chatId, replyText, false);
scheduleFollowUps(chatId);


    const reply = await askOpenAI(chatId, text) || "";
    const replyText = String(reply || "");

    const audioMatch = replyText.match(/<<AUDIO:\s*([^>]+)>>/i);
    if (audioMatch) {
      const fname = audioMatch[1].trim();
      if (audiosDriveMap[fname]) {
        if (!audioJaEnviado(chatId, fname)) {
          await sendAudioHuman(chatId, fname);
        } else {
          await sendTextHuman(chatId, "já te mandei esse áudio antes, quer que eu te explique com texto? 😏");
        }
      } else {
        await sendTextHuman(chatId, "amor, to com um probleminha aqui, me espera um pouquinho", false);
      }
      scheduleFollowUps(chatId);
      return;
    }

    await sendTextHuman(chatId, replyText, false);
    scheduleFollowUps(chatId);
  });
});


// inicializa
client.initialize().catch(console.error);
