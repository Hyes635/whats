/*******************************************************
 * index.js - bot whatsapp-web.js + Ollama (modelo local)
 *******************************************************/

import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import path from "path";
import qrcode from "qrcode-terminal";
import axios from "axios";
import "dotenv/config";
import pkg from "whatsapp-web.js";
import ffmpeg from "fluent-ffmpeg";

const { Client, LocalAuth, MessageMedia } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------- CONFIG ----------------
const LINK_OFERTA = "https://www.fanvue.com/likinha"; // ajuste aqui
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
// -----------------------------------------

// Controle global
const ofertaEnviada = {}; // controla se a oferta já foi enviada por chat
const userAskedForLink = {}; // true se o usuário pediu o link manualmente
const conversationContext = {}; // histórico usado no prompt para o modelo
const MAX_CONTEXT_MESSAGES = 7;
const memoryStore = {};
const followTimers = {};
const sentAudioByContact = {}; // { chatId: { audios: Set, usedEmojis: Set } }
const emojiHistory = {}; // historico de emoji por chat
const audiosDrive = [
  { file: "fixed_prontinho__so_ascessar_o_conteudo.ogg", url: "https://drive.google.com/uc?export=download&id=1Lw-KiIv9V7pzPUvYG_djcuHtLiio7Frh" },
  { file: "fixed_to_indo_pra_acad.ogg", url: "https://drive.google.com/uc?export=download&id=1Be41WQoXIxNFhWzt8H5tGdRHk2e-Ee7Y" },
  { file: "fixed_oi_gatinho_lindo.ogg", url: "https://drive.google.com/uc?export=download&id=1y5f5jizqFJHqZ1ygfaAooY3VlkoJWq-t" },
  { file: "fixed_ja_to_com_sdd.ogg", url: "https://drive.google.com/uc?export=download&id=1kfcn88RS2rVIIDwtd8pK5eBWQkqRVgjn" },
  { file: "fixed_sou_de_vdd.ogg", url: "https://drive.google.com/uc?export=download&id=1YLtFCKezM5MimKRJLi2J8P0ujzcTd7Qz" },
  { file: "fixed_prontinho__so_ascessar_o_conteudo.ogg", url: "https://drive.google.com/uc?export=download&id=1Lw-KiIv9V7pzPUvYG_djcuHtLiio7Frh" },
  // adicione o restante conforme necessário
];
const allAudios = audiosDrive.filter(a => a && a.file).map(a => a.file);
const audiosDriveMap = Object.fromEntries(audiosDrive.map(a => [a.file, a.url]));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------- contexto ----------------
function atualizarContexto(chatId, novaMensagem) {
  if (!conversationContext[chatId]) {
    conversationContext[chatId] = { tokenCount: 0, mensagens: [] };
  }

  if (Array.isArray(conversationContext[chatId])) {
    conversationContext[chatId] = { tokenCount: 0, mensagens: conversationContext[chatId] };
  }

  conversationContext[chatId].mensagens.push(novaMensagem);

  if (conversationContext[chatId].mensagens.length > MAX_CONTEXT_MESSAGES) {
    conversationContext[chatId].mensagens.shift();
  }
}

function contarTokens(chatId, tokensUsados) {
  if (!conversationContext[chatId]) conversationContext[chatId] = { tokenCount: 0, mensagens: [] };
  if (!conversationContext[chatId].tokenCount) conversationContext[chatId].tokenCount = 0;
  conversationContext[chatId].tokenCount += tokensUsados;

  if (conversationContext[chatId].tokenCount > 7000) {
    log(`🧹 limpando contexto antigo do chat ${chatId}`);
    conversationContext[chatId].mensagens = conversationContext[chatId].mensagens.slice(-5);
    conversationContext[chatId].tokenCount = 0;
  }
}

// ---------------- emojis ----------------
const emojiList = ["😊", "😉", "😏", "😻", "❤️", "😈", "🤭", "🥰", "😘"];

function getEmojiControlado(chatId) {
  if (!emojiHistory[chatId]) emojiHistory[chatId] = { lastEmoji: null, used: new Set() };
  const { lastEmoji, used } = emojiHistory[chatId];

  // chance de 5%
  if (Math.random() > 0.05) return "";

  if (used.size >= emojiList.length - 2) used.clear();

  const disponiveis = emojiList.filter(e => e !== lastEmoji && !used.has(e));
  if (disponiveis.length === 0) {
    used.clear();
    disponiveis.push(...emojiList.filter(e => e !== lastEmoji));
  }
  const escolhido = disponiveis[Math.floor(Math.random() * disponiveis.length)];
  used.add(escolhido);
  emojiHistory[chatId].lastEmoji = escolhido;

  return " " + escolhido;
}

// ---------------- transcrição (placeholder) ----------------
// Aqui eu deixei como placeholder (retorna ""). Se você tiver
// Whisper local ou outro STT, integre aqui.
async function transcreverAudio(localPath) {
  log("transcrição não configurada (placeholder), arquivo:", localPath);
  return "";
}

// ---------------- WhatsApp client ----------------
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }
});

client.on("qr", qr => {
  console.log("📱 Escaneie o QR code:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  log("🤖 bot conectado no WhatsApp!");
});

// ---------------- converter audio ----------------
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

// ---------------- audios / envios ----------------
function audioJaEnviado(chatId, audioName) {
  return sentAudioByContact[chatId]?.audios?.has(audioName);
}
function registrarAudioEnviado(chatId, audioName) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }
  sentAudioByContact[chatId].audios.add(audioName);
}

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

    if (audioJaEnviado(chatId, audioName)) {
      const reply = await askLocalModel(chatId, "continua a conversa normalmente") || "";
      await sendTextHuman(chatId, reply, false);
      return;
    }

    const audioUrl = audiosDriveMap[audioName];
    if (!audioUrl) {
      await sendTextHuman(chatId, "não achei esse áudio agora 😅");
      return;
    }

    // simula digitando e gravando
    await simularDigitando(chatId, 2000 + Math.floor(Math.random() * 2000));
    await simularGravando(chatId, 3000 + Math.floor(Math.random() * 2000));

    const resp = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 20000, maxRedirects: 5 });
    const buffer = Buffer.from(resp.data);
    const base64 = buffer.toString("base64");
    const mime = getMimeByName(audioName);
    const media = new MessageMedia(mime, base64, audioName);

    await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    registrarAudioEnviado(chatId, audioName);
    log("✅ Áudio enviado:", audioName, "->", chatId);
  } catch (err) {
    console.error("Erro sendAudioHuman:", err?.message || err);
    try { await sendTextHuman(chatId, "tive um probleminha ao enviar o áudio, me espera..."); } catch (e) {}
  }
}

// ---------------- simulação typing/recording ----------------
async function simularDigitando(chatId, duracao = 6000) {
  const chat = await client.getChatById(chatId).catch(() => null);
  if (!chat) return;
  try {
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

// ---------------- limpeza texto / refinamento ----------------
function limparTexto(text) {
  return text
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\.+/g, '.')
    .replace(/(kk+)\1+/gi, '$1')
    .trim();
}

function refinarFala(texto) {
  if (!texto) return "";
  texto = texto
    .replace(/\s+/g, " ")
    .replace(/\s([?.!])/g, "$1")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s*\?\s*/g, "? ")
    .replace(/\s*\!\s*/g, "! ")
    .trim();

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

  texto = texto.charAt(0).toLowerCase() + texto.slice(1);
  if (texto.endsWith('.')) texto = texto.slice(0, -1);

  texto = texto.replace(/(https?:\/\/[^\s.,!?]+)/g, "$1");
  texto = texto.replace(/([.,!?])\s*(https?:\/\/[^\s]+)/g, " $2");
  texto = texto.replace(/(https?:\/\/[^\s]+)[.,!?]+$/g, "$1");
  return texto;
}

// ---------------- gatilhos e helpers ----------------
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

// ---------------- follow-ups ----------------
function resetFollowUps(chatId) {
  if (!followTimers[chatId]) return;
  for (const t of followTimers[chatId]) clearTimeout(t);
  delete followTimers[chatId];
}

function scheduleFollowUps(chatId) {
  resetFollowUps(chatId);
  followTimers[chatId] = [];

  if (userAskedForLink[chatId] || ofertaEnviada[chatId]) return;

  const t3 = setTimeout(async () => {
    try {
      if (ofertaEnviada[chatId]) return;
      log("followup 3m -> pressao media:", chatId);
      ofertaEnviada[chatId] = true;

      const file = checkAudioTrigger("sdd") || "fixed_ja_to_com_sdd.ogg";
      if (file && audiosDriveMap[file] && !audioJaEnviado(chatId, file)) {
        await sendAudioHuman(chatId, file);
      } else {
        await sendTextHuman(chatId, "amor, to aqui ainda, se quiser ver mais tem que garantir seu acesso ok", false);
      }

      await sleep(3000 + Math.random() * 2000);
      await sendTextHuman(chatId, `quer ver mais? entra no meu canal ${LINK_OFERTA} 😏`, false);
      await sleep(3000 + Math.random() * 2000);
      await sendTextHuman(chatId, "lá tem tudo que não posso mostrar aqui ", false);
    } catch (e) {
      log("erro followup:", e.message);
    }
  }, 3 * 60 * 1000);

  followTimers[chatId].push(t3);
}

// ---------------- integração Ollama (modelo local) ----------------
async function askLocalModel(chatId, userText) {
  try {
    const systemPrompt = `
você é uma mulher charmosa, confiante e envolvente, com um jeito natural de conversar, se chama Bianca Lika e tem 21 anos e você mora em Curitiba.
fala sempre em minúsculas, com frases curtas e leves, parecendo uma conversa real no WhatsApp.

⚙️ nunca repita emojis ou expressões próximas em mensagens seguidas.
adicione emoji em no máximo 1 de cada 8 mensagens.
❌ nunca use "rs" nem repita emojis.
❌ nunca diga "já te falei", "já te mandei isso", "me conta mais disso", "o que você quis dizer com isso".
✅ varie as respostas, use humor, curiosidade e um toque de provocação.

🎯 seu objetivo é conduzir a conversa até a oferta de forma natural, como se fosse uma consequência da química.
nos primeiros 2 ou 3 turnos, apenas crie conexão — flerte, puxe papo, demonstre curiosidade.
só depois disso, introduza o link ${LINK_OFERTA} com naturalidade.

🎙️ quando fizer sentido mandar áudio, use o formato <<AUDIO:nome.ext>> para indicar.

contexto audios:
${allAudios.map(a => `- ${a}`).join("\n")}
`.trim();

    const messages = [
      { role: "system", content: systemPrompt },
      ...(conversationContext[chatId]?.mensagens || []),
      { role: "user", content: userText }
    ];

    // Requisição para Ollama local
    const resp = await axios.post(OLLAMA_URL, {
      model: "llama3",
      messages,
      stream: false
    }, { timeout: 120000 });

    // Vários formatos possíveis de resposta do Ollama; tenta extrair
    const resposta = resp.data?.message?.content || resp.data?.response || resp.data?.result || "";
    const tokensUsados = Math.max(1, Math.floor(resposta.length / 4));
    contarTokens(chatId, tokensUsados);
    atualizarContexto(chatId, { role: "assistant", content: resposta });

    return resposta || "";
  } catch (err) {
    console.error("⚠️ Erro no modelo local:", err?.message || err);
    return "tive um probleminha aqui, mas já volto tá? 😅";
  }
}

// ---------------- envio humanizado texto ----------------
async function sendTextHuman(chatId, text, isFirst = false) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }

  if (!text) return;
  let msg = String(text).trim();
  if (!msg) return;

  // frases proibidas a remover
  const proibidas = [
    "já te mandei isso amor",
    "lá eu mostro mais de mim",
    "já te falei",
    "já disse",
    "te expliquei antes",
    "me conta mais disso",
    "rs",
    "agora fiquei pensando nisso"
  ];

  for (const frase of proibidas) {
    const pattern = frase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const regex = new RegExp(pattern + "[\\s.,!?🤭😏😈😻😅😂🥰💋💦❤️]*", "gi");
    msg = msg.replace(regex, "");
  }

  msg = msg.replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "").replace(/\s+([.,!?])/g, "$1").trim();
  if (!msg) return;

  await simularDigitando(chatId, 1000 + Math.random() * 3000);

  const partes = msg.includes("http") ? [msg] : msg.split(/[.!?]/).map(p => p.trim()).filter(p => p.length > 0);

  const random = Math.random();
  const qtd = Math.min(partes.length, random < 0.4 ? 1 : random < 0.8 ? 2 : 3);
  const escolhidas = partes.slice(0, qtd);

  // chance pequena de emoji (10%)
  const addEmoji = !isFirst && Math.random() < 0.1;
  let emoji = "";

  if (addEmoji) {
    const emojisList = ["😊", "😉", "😏", "😻", "❤️", "😈", "🤭"];
    const used = sentAudioByContact[chatId]?.usedEmojis || new Set();
    if (used.size >= emojisList.length) used.clear();

    const available = emojisList.filter(e => !used.has(e));
    if (available.length > 0) {
      emoji = " " + available[Math.floor(Math.random() * available.length)];
      used.add(emoji.trim());
      sentAudioByContact[chatId] = { ...(sentAudioByContact[chatId] || {}), usedEmojis: used };
    }
  }

  for (let i = 0; i < escolhidas.length; i++) {
    const textoFinal = escolhidas[i] + emoji;
    await client.sendMessage(chatId, textoFinal);
    if (i < escolhidas.length - 1 && !msg.includes("http")) {
      await sleep(1500 + Math.random() * 1500);
      await simularDigitando(chatId, 2000 + Math.random() * 2000);
    }
  }
}

// ---------------- fila por usuário ----------------
const filaMensagens = {};

async function processarFila(chatId, handler) {
  if (filaMensagens[chatId]) await filaMensagens[chatId];
  const promessa = handler().catch(console.error);
  filaMensagens[chatId] = promessa.finally(() => delete filaMensagens[chatId]);
  return promessa;
}

const lastMessageTime = {};

// ---------------- evento message ----------------
client.on("message", async (msg) => {
  const chatId = msg.from;
  const agora = Date.now();
  let text = msg.body?.trim() || "";

  if (msg.fromMe) return;

  if (!userAskedForLink[chatId]) userAskedForLink[chatId] = false;
  if (!ofertaEnviada[chatId]) ofertaEnviada[chatId] = false;

  const explicitLinkRegex = /\b(perfil|link|fanvue|onde posso ver|onde vejo|qual seu perfil|me manda o link|me manda link|me passa o link|como vejo|onde fica|me manda o perfil)\b/i;
  const pediuLink = explicitLinkRegex.test(text);

  if (pediuLink && !ofertaEnviada[chatId]) {
    markUserAskedLink(chatId);
    await sendTextHuman(chatId, `bom, você pode conferir tudo lá no meu perfil 😉`, false);
    await sleep(2500 + Math.random() * 1500);
    await sendTextHuman(chatId, `é só acessar ${LINK_OFERTA}`, false);
    ofertaEnviada[chatId] = true;
    scheduleFollowUps(chatId);
    return;
  }

  // anti-flood
  const MIN_INTERVAL = 2000;
  if (lastMessageTime[chatId] && agora - lastMessageTime[chatId] < MIN_INTERVAL) {
    await sleep(1000);
  }
  lastMessageTime[chatId] = agora;

  await processarFila(chatId, async () => {
    resetFollowUps(chatId);

    atualizarContexto(chatId, { role: "user", content: text });
    if (!memoryStore[chatId]) memoryStore[chatId] = { history: [], lastActive: Date.now() };
    memoryStore[chatId].lastActive = Date.now();

    // Transcrição de áudio (se houver)
    try {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const mime = media.mimetype || "";
        const ext = mime.includes("/") ? mime.split("/")[1].split(";")[0] : "ogg";
        const tmpName = path.join(__dirname, `tmp_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpName, Buffer.from(media.data, "base64"));

        try {
          const textoTranscrito = await transcreverAudio(tmpName);
          if (textoTranscrito && textoTranscrito.trim()) {
            text = textoTranscrito;
            log("🗣️ Transcrição:", textoTranscrito);
          }
        } catch (e) {
          log("Erro transcrevendo:", e.message);
        } finally {
          if (fs.existsSync(tmpName)) fs.unlinkSync(tmpName);
        }
      }
    } catch (err) {
      log("erro processando media:", err);
    }

    memoryStore[chatId].history.push({ role: "user", content: text });
    if (memoryStore[chatId].history.length > 16) memoryStore[chatId].history.shift();

    log("mensagem do lead:", text);
    await sleep(2500 + Math.random() * 1500);

    const trig = checkAudioTrigger(text);
    if (trig && audiosDriveMap[trig]) {
      if (!audioJaEnviado(chatId, trig)) {
        await sendAudioHuman(chatId, trig);
      } else {
        const reply = await askLocalModel(chatId, text) || "";
        await sendTextHuman(chatId, reply, false);
      }

      if (!ofertaEnviada[chatId] && !userAskedForLink[chatId] && conversationContext[chatId]?.mensagens?.length >= 6) {
        await sendTextHuman(chatId, `quer ver mais? entra no meu canal ${LINK_OFERTA} 😏`, false);
        ofertaEnviada[chatId] = true;
      }

      scheduleFollowUps(chatId);
      return;
    }

    const reply = await askLocalModel(chatId, text) || "";
    const replyText = String(reply || "");

    // Checa se modelo pediu para enviar áudio
    const audioMatch = replyText.match(/<<AUDIO:\s*([^>]+)>>/i);
    if (audioMatch) {
      const fname = audioMatch[1].trim();
      if (audiosDriveMap[fname]) {
        if (!audioJaEnviado(chatId, fname)) {
          await sendAudioHuman(chatId, fname);
        } else {
          const fallback = await askLocalModel(chatId, "continua a conversa normalmente") || "";
          await sendTextHuman(chatId, fallback, false);
        }
      } else {
        await sendTextHuman(chatId, "amor, to com um probleminha aqui, me espera um pouquinho", false);
      }
      scheduleFollowUps(chatId);
      return;
    }

    await sendTextHuman(chatId, replyText, false);
    if (!userAskedForLink[chatId]) {
      scheduleFollowUps(chatId);
    }
  });
});

// marca o usuário que pediu link (pra evitar followup depois)
function markUserAskedLink(chatId) {
  userAskedForLink[chatId] = true;
  setTimeout(() => {
    delete userAskedForLink[chatId];
  }, 6 * 60 * 60 * 1000); // limpa depois de 6 horas
}

// inicializa
client.initialize().catch(console.error);
