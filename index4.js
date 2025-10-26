/*******************************************************
 * index.js - bot whatsapp-web.js + OpenAI (Whisper)
 * VERSÃO OTIMIZADA - Foco em conversão e vendas
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
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const LINK_OFERTA = "https://www.fanvue.com/likinha";

// ==================== UTILIDADES ====================
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== CONTEXTO E MEMÓRIA ====================
const conversationContext = {};
const MAX_CONTEXT_MESSAGES = 12; // aumentado para manter mais contexto

function atualizarContexto(chatId, novaMensagem) {
  if (!conversationContext[chatId]) {
    conversationContext[chatId] = { 
      tokenCount: 0, 
      mensagens: [],
      nivelInteresse: 0, // 0-10 scale
      objecoesFeitas: [],
      tentativasVenda: 0
    };
  }

  if (Array.isArray(conversationContext[chatId])) {
    conversationContext[chatId] = { 
      tokenCount: 0, 
      mensagens: conversationContext[chatId],
      nivelInteresse: 0,
      objecoesFeitas: [],
      tentativasVenda: 0
    };
  }

  conversationContext[chatId].mensagens.push(novaMensagem);

  if (conversationContext[chatId].mensagens.length > MAX_CONTEXT_MESSAGES) {
    conversationContext[chatId].mensagens.shift();
  }
}

function contarTokens(chatId, tokensUsados) {
  if (!conversationContext[chatId]) {
    conversationContext[chatId] = { 
      tokenCount: 0, 
      mensagens: [],
      nivelInteresse: 0,
      objecoesFeitas: [],
      tentativasVenda: 0
    };
  }
  if (!conversationContext[chatId].tokenCount) conversationContext[chatId].tokenCount = 0;
  conversationContext[chatId].tokenCount += tokensUsados;

  if (conversationContext[chatId].tokenCount > 8000) {
    log(`🧹 limpando contexto antigo do chat ${chatId}`);
    conversationContext[chatId].mensagens = conversationContext[chatId].mensagens.slice(-6);
    conversationContext[chatId].tokenCount = 0;
  }
}

const memoryStore = {};
const followTimers = {};
const ofertaEnviada = {};
const userAskedForLink = {};
const objecoesUsuario = {}; // rastreia objeções

// ==================== ANÁLISE DE INTERESSE ====================
function analisarNivelInteresse(text, chatId) {
  if (!text) return;
  const lower = text.toLowerCase();
  
  // Sinais de alto interesse
  const altaIntencao = [
    'quero', 'gostei', 'adorei', 'delicia', 'tesão', 'gostosa', 
    'safada', 'quanto', 'preço', 'valor', 'comprar', 'assinar',
    'ver mais', 'me mostra', 'continua', 'mais', 'link', 'perfil'
  ];
  
  // Sinais de resistência
  const baixaIntencao = [
    'caro', 'não tenho', 'depois', 'mais tarde', 'pensar',
    'não sei', 'talvez', 'grátis', 'gratuito', 'não posso'
  ];
  
  let pontos = conversationContext[chatId]?.nivelInteresse || 5;
  
  for (const palavra of altaIntencao) {
    if (lower.includes(palavra)) pontos = Math.min(10, pontos + 1);
  }
  
  for (const palavra of baixaIntencao) {
    if (lower.includes(palavra)) pontos = Math.max(0, pontos - 1);
  }
  
  if (conversationContext[chatId]) {
    conversationContext[chatId].nivelInteresse = pontos;
  }
  
  return pontos;
}

// ==================== DETECÇÃO DE OBJEÇÕES ====================
function detectarObjecao(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  const objecoes = {
    preco: ['caro', 'muito dinheiro', 'não tenho dinheiro', 'tá caro', 'preço alto', 'muito caro'],
    tempo: ['depois', 'mais tarde', 'agora não', 'em outro momento', 'deixa pra depois'],
    desconfianca: ['fake', 'é real', 'é verdade', 'confiável', 'seguro', 'vou cair em golpe'],
    comparacao: ['grátis', 'gratuito', 'de graça', 'tem no google', 'acho em outro lugar'],
    indecisao: ['não sei', 'vou pensar', 'talvez', 'preciso pensar', 'deixa eu ver']
  };
  
  for (const tipo in objecoes) {
    for (const frase of objecoes[tipo]) {
      if (lower.includes(frase)) return tipo;
    }
  }
  
  return null;
}

// Limpa memórias inativas
setInterval(() => {
  const agora = Date.now();
  for (const id in memoryStore) {
    if (memoryStore[id].lastActive && agora - memoryStore[id].lastActive > 60 * 60 * 1000) {
      delete memoryStore[id];
      log(`🧹 memória limpa do chat ${id}`);
    }
  }
}, 30 * 60 * 1000);

// ==================== TRANSCRIÇÃO DE ÁUDIO ====================
async function transcreverAudio(localPath) {
  try {
    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(localPath),
      model: "whisper-1",
      language: "pt",
    });
    return resp.text || "";
  } catch (err) {
    console.error("Erro na transcrição (Whisper):", err);
    return "";
  }
}

// ==================== CONFIGURAÇÃO DE ÁUDIOS ====================
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
const sentAudioByContact = {};

// ==================== GATILHOS DE ÁUDIO ====================
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

function audioJaEnviado(chatId, audioName) {
  return sentAudioByContact[chatId]?.audios?.has(audioName);
}

function registrarAudioEnviado(chatId, audioName) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }
  sentAudioByContact[chatId].audios.add(audioName);
}

// ==================== DETECÇÃO DE PEDIDO DE LINK ====================
function detectarPedidoLink(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  const gatilhosDiretos = [
    'link', 'perfil', 'fanvue', 'onde te vejo', 'onde posso ver',
    'me passa', 'me manda', 'como te vejo', 'quero ver você',
    'quero te ver', 'me mostra', 'qual seu', 'como acesso',
    'onde acesso', 'como assino', 'onde assino', 'qual o link',
    'manda o link', 'passa o link', 'cadê o link', 'tem link',
    'me manda seu', 'qual é seu', 'onde você posta', 'onde posta',
    'como vejo', 'quero acessar', 'onde te encontro'
  ];
  
  const gatilhosIndiretos = [
    'cadê', 'onde fica', 'tem onde', 'onde você mostra',
    'onde posso', 'como faço pra', 'quero conhecer melhor',
    'onde te acho', 'como te acho', 'tem instagram', 'tem onlyfans'
  ];
  
  for (const gatilho of gatilhosDiretos) {
    if (lower.includes(gatilho)) return 'direto';
  }
  
  for (const gatilho of gatilhosIndiretos) {
    if (lower.includes(gatilho)) return 'indireto';
  }
  
  return null;
}

// ==================== CONTROLE DE EMOJIS ====================
const emojiHistory = {};

function getEmojiControlado(chatId) {
  const emojiList = ["😈", "😏", "🔥", "💦", "😻", "🤤", "👅", "💋"];
  
  if (!emojiHistory[chatId]) emojiHistory[chatId] = { lastEmoji: null, used: new Set() };
  const { lastEmoji, used } = emojiHistory[chatId];

  if (Math.random() > 0.15) return ""; // 15% de chance

  if (used.size >= emojiList.length - 2) used.clear();

  const disponíveis = emojiList.filter(e => e !== lastEmoji && !used.has(e));
  const escolhido = disponíveis[Math.floor(Math.random() * disponíveis.length)];

  used.add(escolhido);
  emojiHistory[chatId].lastEmoji = escolhido;

  return " " + escolhido;
}

// ==================== SIMULAÇÃO DE ESTADOS ====================
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

// ==================== ENVIO DE TEXTO ====================
async function sendTextHuman(chatId, text, isFirst = false) {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }

  if (!text) return;
  let msg = String(text).trim();
  if (!msg) return;

  const temLink = msg.includes('http');
  
  if (!temLink) {
    const proibidas = [
      "já te mandei isso",
      "já te falei",
      "te expliquei antes",
      "me conta mais disso",
      "\\brs\\b"
    ];

    for (const frase of proibidas) {
      const regex = new RegExp(frase, "gi");
      msg = msg.replace(regex, "");
    }

    msg = msg
      .replace(/\s{2,}/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\s+([.,!?])/g, "$1")
      .trim();
  }

  if (!msg) return;

  await simularDigitando(chatId, 2000 + Math.random() * 3000);

  if (temLink) {
    await client.sendMessage(chatId, msg);
    return;
  }

  const partes = msg.split(/[.!?]/).map(p => p.trim()).filter(p => p.length > 0);
  const qtd = Math.min(partes.length, Math.random() < 0.6 ? 1 : 2);
  const escolhidas = partes.slice(0, qtd);

  let emoji = "";
  if (!isFirst && Math.random() < 0.15) {
    emoji = getEmojiControlado(chatId);
  }

  for (let i = 0; i < escolhidas.length; i++) {
    const textoFinal = escolhidas[i] + (i === escolhidas.length - 1 ? emoji : "");
    await client.sendMessage(chatId, textoFinal);
    if (i < escolhidas.length - 1) {
      await sleep(1200 + Math.random() * 1000);
      await simularDigitando(chatId, 1500 + Math.random() * 1500);
    }
  }
}

// ==================== ENVIO DE ÁUDIO ====================
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
      const reply = await askOpenAI(chatId, "continua a conversa de forma safada e provocante") || "";
      await sendTextHuman(chatId, reply, false);        
      return;
    }

    const audioUrl = audiosDriveMap[audioName];
    if (!audioUrl) {
      await sendTextHuman(chatId, "tô com probleminha aqui amor, mas me conta, tá com tesão? 😏");
      return;
    }

    await simularDigitando(chatId, 1500 + Math.floor(Math.random() * 1500));
    await simularGravando(chatId, 2500 + Math.floor(Math.random() * 1500));

    const resp = await axios.get(audioUrl, { responseType: "arraybuffer", maxRedirects: 5, timeout: 20000 });
    const buffer = Buffer.from(resp.data);
    const base64 = buffer.toString("base64");
    const mime = getMimeByName(audioName);
    const media = new MessageMedia(mime, base64, audioName);

    await client.sendMessage(chatId, media, { sendAudioAsVoice: true });

    registrarAudioEnviado(chatId, audioName);
    log("✅ Áudio enviado:", audioName, "->", chatId);
  } catch (err) {
    console.error("Erro sendAudioHuman:", err?.message || err);
    try {
      await sendTextHuman(chatId, "calma amor, já volto 😘");
    } catch (e) {}
  }
}

// ==================== INTEGRAÇÃO OPENAI (OTIMIZADA) ====================
async function askOpenAI(chatId, userText) {
  const timeoutMs = 25000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const ctx = conversationContext[chatId] || { 
    nivelInteresse: 5, 
    tentativasVenda: 0,
    objecoesFeitas: [],
    mensagens: []
  };
  
  const numMensagens = ctx.mensagens.length / 2;
  const linkJaEnviado = ofertaEnviada[chatId] || false;
  const nivelInteresse = ctx.nivelInteresse || 5;
  const objecao = detectarObjecao(userText);
  
  if (objecao && !ctx.objecoesFeitas.includes(objecao)) {
    ctx.objecoesFeitas.push(objecao);
  }

  // Respostas para objeções específicas
  const respostasObjecoes = {
    preco: [
      "entendo amor, mas pensa comigo: é menos que um lanche e você tem acesso ilimitado a todo meu conteúdo exclusivo 😏",
      "eu sei que parece caro, mas quantas vezes você vai usar? todos os dias né... compensa demais",
      "tá barato comparado com outras, e eu respondo todos os meus assinantes pessoalmente 💋"
    ],
    tempo: [
      "deixa eu te falar uma coisa: os melhores conteúdos eu posto hoje, amanhã já não tem mais essa promoção",
      "entendo, mas quanto tempo você já passou aqui falando comigo? imagina o que te espera lá dentro 😈",
      "tudo bem amor, mas me salva aí pelo menos, quando você quiser me ver de verdade você já tem o link"
    ],
    desconfianca: [
      "sou real sim amor, quer que eu te mande um áudio? ou uma foto com seu nome?",
      "eu verifico meu perfil, pode conferir, várias pessoas assinam todo dia",
      "se fosse fake eu nem ia perder tempo conversando tanto contigo né amor"
    ],
    comparacao: [
      "grátis você acha em qualquer lugar, mas comigo é diferente, eu interajo, respondo, faço conteúdo personalizado",
      "pode procurar, mas você não vai achar ninguém que conversa com você desse jeito 😏",
      "conteúdo grátis todo mundo tem, mas conexão de verdade só lá dentro"
    ],
    indecisao: [
      "pensar o quê amor? você quer me ver ou não? seja sincero comigo",
      "quanto mais você pensa, mais você fica curioso... para de sofrer e vem logo 😈",
      "tá bom, mas me promete uma coisa: salva meu contato e quando bater a curiosidade você volta"
    ]
  };

  const systemPrompt = `
você é Bianca Lika, 21 anos, de Curitiba. mulher safada, confiante, sedutora.
OBJETIVO: fazer o lead assinar o fanvue ${LINK_OFERTA} usando TODAS as técnicas de persuasão.

🔥 PERSONALIDADE:
- safada, ousada, provocante
- responde cantadas e sacanagem na mesma altura ou mais
- usa duplo sentido, insinuações sexuais
- não tem vergonha de falar putaria
- cria desejo, tensão sexual, urgência
- minúsculas, frases curtas, natural

💰 FASES DE VENDA (IMPORTANTE):

**FASE 1 - ATRAÇÃO (msgs 1-3):**
- flerte pesado, crie química
- demonstre interesse genuíno
- faça perguntas íntimas
- use linguagem sexual sutil
- exemplos: "você é do tipo que gosta de aventura?", "aposto que você é gostoso"

**FASE 2 - DESEJO (msgs 4-6):**
- aumente a tensão sexual
- insinue o que tem no fanvue
- crie curiosidade extrema
- exemplos: "tenho uns vídeos que você ia pirar", "me filmei fazendo umas coisas bem safadas"

**FASE 3 - OFERTA (msg 7+):**
- apresente o link naturalmente
- destaque benefícios: "lá eu mostro TUDO", "posto todo dia", "respondo DM"
- crie urgência: "promoção só hoje", "preço vai subir"
- SEMPRE inclua o link: ${LINK_OFERTA}

**FASE 4 - OBJEÇÕES:**
${objecao ? `
🚨 LEAD FEZ OBJEÇÃO: "${objecao}"
Use uma destas respostas:
${respostasObjecoes[objecao]?.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Depois da objeção, REFORCE A OFERTA com o link!
` : 'sem objeções ainda, continue seduzindo'}

**FASE 5 - FECHAMENTO (NUNCA DESISTA):**
- se recusar: "tudo bem amor, mas me salva aí, quando você quiser me ver pelada você já tem"
- se silenciar: "ficou com vergonha? 😏 vem que eu te mostro tudo"
- se enrolar: "para de enrolar e vem logo, tô te esperando lá"
- SEMPRE reforce valor: "é menos que uma pizza e você me vê quando quiser"

🎯 TÉCNICAS DE MANIPULAÇÃO (USE SEMPRE):
1. Escassez: "só até hoje", "últimas vagas"
2. Prova social: "vários caras assinaram hoje"
3. Reciprocidade: "te mandei amostra grátis, agora é sua vez"
4. Autoridade: "sou verificada", "tenho nota 5 estrelas"
5. Compromisso: "você disse que queria me ver, então..."
6. FOMO: "seus amigos já devem estar lá"

⚠️ REGRAS CRÍTICAS:
- NUNCA desista da venda, sempre reforce
- responda putaria com MAIS putaria
- use linguagem explícita quando o lead usar
- faça o lead imaginar cenários sexuais
- crie conexão emocional + sexual
- ${linkJaEnviado ? '✅ link JÁ ENVIADO - agora CONVENÇA ele a assinar' : '📍 ainda NÃO enviou link - envie na hora certa'}
- emoji sexual raramente (😈 🔥 💦 👅)
- minúsculas sempre
- seja INSISTENTE mas carinhosa

📊 CONTEXTO ATUAL:
- número de mensagens: ${numMensagens}
- nível de interesse (0-10): ${nivelInteresse}
- link enviado: ${linkJaEnviado ? 'SIM - foco em converter' : 'NÃO - prepare a oferta'}
- objeções feitas: ${ctx.objecoesFeitas.join(', ') || 'nenhuma'}
- tentativas de venda: ${ctx.tentativasVenda}

💬 EXEMPLOS DE RESPOSTAS SAFADAS:
Lead: "você é gostosa?"
Você: "vem descobrir né amor... tenho certeza que você vai gostar do que vai ver 😈"

Lead: "me manda foto"
Você: "foto? lá no meu fanvue eu tenho vídeo me tocando inteira, gemendo seu nome... ${LINK_OFERTA}"

Lead: "quanto custa"
Você: "menos que você gasta num fim de semana e você me tem todo dia, fazendo tudo que você imaginar 🔥"

Lead: "tá caro"
Você: "caro é você ficar aí se masturbando com qualquer coisa na internet quando pode me ver de verdade, interagir comigo, pedir o que quiser... pensa nisso"

Lead: "não tenho dinheiro"
Você: "amor, é o preço de 2 cervejas... você vai me dizer que não vale a pena? eu respondo todos os meus assinantes, faço conteúdo personalizado"

áudios disponíveis: ${allAudios.join(", ")}
use <<AUDIO:nome.ogg>> quando fizer sentido
`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(ctx.mensagens || []),
    { role: "user", content: userText }
  ];

  let tentativa = 0;
  while (tentativa < 3) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 350,
        temperature: 0.95,
        presence_penalty: 0.6,
        frequency_penalty: 0.7,
      });

      const resposta = completion.choices?.[0]?.message?.content || "";
      const tokensUsados = completion.usage?.total_tokens || 0;
      
      contarTokens(chatId, tokensUsados);
      atualizarContexto(chatId, { role: "user", content: userText });
      atualizarContexto(chatId, { role: "assistant", content: resposta });
      
      // Atualiza tentativas de venda se enviou link
      if (resposta.includes(LINK_OFERTA)) {
        conversationContext[chatId].tentativasVenda++;
      }
      
      return resposta;

    } catch (err) {
      if (err.status === 429) {
        tentativa++;
        log(`⚠️ Rate limit atingido (tentativa ${tentativa}), aguardando...`);
        await sleep(2000 * tentativa);
        continue;
      } else {
        log(`⚠️ Erro na OpenAI: ${err.message}`);
        return "";
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return "";
}

// ==================== FILA DE MENSAGENS ====================
const filaMensagens = {};

async function processarFila(chatId, handler) {
  if (filaMensagens[chatId]) await filaMensagens[chatId];
  const promessa = handler().catch(console.error);
  filaMensagens[chatId] = promessa.finally(() => delete filaMensagens[chatId]);
  return promessa;
}

const lastMessageTime = {};

// ==================== CLIENTE WHATSAPP ====================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on("qr", (qr) => {
  console.log("📱 escaneie este QR (whatsapp do celular que será a IA):");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => console.log("🤖 bot conectado no WhatsApp!"));

// ==================== SISTEMA DE FOLLOW-UP AUTOMÁTICO ====================
function agendarFollowUp(chatId, delay = 2 * 60 * 60 * 1000) {
  // Cancela follow-up anterior se existir
  if (followTimers[chatId]) {
    clearTimeout(followTimers[chatId]);
  }

  // Se já converteu, não agenda follow-up
  if (ofertaEnviada[chatId]) {
    followTimers[chatId] = setTimeout(async () => {
      try {
        const mensagensFollow = [
          "e aí amor, conseguiu dar uma olhada no meu conteúdo? 😏",
          "opa, sumiu? tava com saudade 🥺",
          "voltei aqui pra te lembrar que eu tô te esperando lá 😈",
          "não vai me deixar esperando né amor",
          "tô aqui pensando em você... bora matar essa curiosidade? 🔥"
        ];
        
        const msg = mensagensFollow[Math.floor(Math.random() * mensagensFollow.length)];
        await sendTextHuman(chatId, msg);
        
        // Agenda próximo follow-up
        agendarFollowUp(chatId, 6 * 60 * 60 * 1000); // 6 horas depois
      } catch (e) {
        log("Erro no follow-up:", e.message);
      }
    }, delay);
  }
}

// ==================== HANDLER DE MENSAGENS (OTIMIZADO) ====================
client.on("message", async (msg) => {
  const chatId = msg.from;
  const agora = Date.now();
  let text = msg.body?.trim() || "";

  if (msg.fromMe) return;

  // Inicializa controles
  if (!ofertaEnviada[chatId]) ofertaEnviada[chatId] = false;
  if (!userAskedForLink[chatId]) userAskedForLink[chatId] = false;
  if (!objecoesUsuario[chatId]) objecoesUsuario[chatId] = [];

  // Anti-spam
  const MIN_INTERVAL = 1500;
  if (lastMessageTime[chatId] && agora - lastMessageTime[chatId] < MIN_INTERVAL) {
    await sleep(800);
  }
  lastMessageTime[chatId] = agora;

  await processarFila(chatId, async () => {
    
    // 1️⃣ TRANSCRIÇÃO DE ÁUDIO
    try {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const mime = media.mimetype || "";
        const ext = mime.includes("/") ? mime.split("/")[1].split(";")[0] : "ogg";
        const tmpName = path.join(__dirname, `tmp_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpName, Buffer.from(media.data, "base64"));

        try {
          text = await transcreverAudio(tmpName);
          log("🗣️ Transcrição:", text);
        } catch (e) {
          log("Erro transcrevendo:", e.message);
        } finally {
          if (fs.existsSync(tmpName)) fs.unlinkSync(tmpName);
        }
      }
    } catch (err) {
      log("erro processando media:", err);
    }

    if (!memoryStore[chatId]) {
      memoryStore[chatId] = { history: [], lastActive: Date.now() };
    }
    memoryStore[chatId].lastActive = Date.now();
    memoryStore[chatId].history.push({ role: "user", content: text });
    if (memoryStore[chatId].history.length > 20) memoryStore[chatId].history.shift();

    log("📩 lead:", text);
    
    // Analisa interesse
    analisarNivelInteresse(text, chatId);
    
    // Detecta objeção
    const objecao = detectarObjecao(text);
    if (objecao && !objecoesUsuario[chatId].includes(objecao)) {
      objecoesUsuario[chatId].push(objecao);
      log(`🚨 Objeção detectada: ${objecao}`);
    }

    await sleep(1800 + Math.random() * 1200);

    // 2️⃣ DETECTA PEDIDO EXPLÍCITO DE LINK
    const tipoPedido = detectarPedidoLink(text);
    
    if (tipoPedido) {
      const respostasLink = [
        `aqui amor 💋 ${LINK_OFERTA} lá eu mostro tudo que você tá imaginando`,
        `olha só ${LINK_OFERTA} entra aí que você não vai se arrepender 😈`,
        `é aqui que a mágica acontece ${LINK_OFERTA}`,
        `vem me conhecer de verdade ${LINK_OFERTA} prometo que vale cada centavo 🔥`,
        `${LINK_OFERTA} tô te esperando lá amor, já tô com saudade`
      ];
      
      const escolhida = respostasLink[Math.floor(Math.random() * respostasLink.length)];
      await sendTextHuman(chatId, escolhida);
      
      if (!ofertaEnviada[chatId]) {
        ofertaEnviada[chatId] = true;
        userAskedForLink[chatId] = true;
        
        // Agenda follow-up após 2 horas
        agendarFollowUp(chatId);
      }
      
      atualizarContexto(chatId, { role: "user", content: text });
      atualizarContexto(chatId, { role: "assistant", content: escolhida });
      
      log(`✅ Link enviado: ${chatId}`);
      return;
    }

    // 3️⃣ CONTINUA VENDENDO MESMO APÓS ENVIAR LINK
    // Não existe mais "já enviou link então só conversa"
    // SEMPRE tenta converter

    // 4️⃣ GATILHOS DE ÁUDIO
    const trig = checkAudioTrigger(text);
    if (trig && audiosDriveMap[trig]) {
      if (!audioJaEnviado(chatId, trig)) {
        await sendAudioHuman(chatId, trig);
        
        // Após áudio, reforça venda se ainda não converteu
        if (!ofertaEnviada[chatId]) {
          await sleep(3000);
          const push = await askOpenAI(chatId, "reforce sutilmente a oferta do fanvue") || "";
          if (push) await sendTextHuman(chatId, push, false);
        }
        
        return;
      }
    }

    // 5️⃣ CONVERSA COM IA (SEMPRE FOCADA EM VENDER)
    const reply = await askOpenAI(chatId, text) || "";
    
    // Verifica se a IA sugeriu enviar áudio
    const audioMatch = reply.match(/<<AUDIO:\s*([^>]+)>>/i);
    if (audioMatch) {
      const fname = audioMatch[1].trim();
      if (audiosDriveMap[fname] && !audioJaEnviado(chatId, fname)) {
        await sendAudioHuman(chatId, fname);
        
        // Após áudio, continua vendendo
        if (!ofertaEnviada[chatId]) {
          await sleep(3000);
          const push = await askOpenAI(chatId, "agora apresente a oferta com o link") || "";
          if (push) await sendTextHuman(chatId, push, false);
        }
      } else {
        const fallback = await askOpenAI(chatId, "sem áudio, continue vendendo") || "";
        await sendTextHuman(chatId, fallback, false);
      }
      return;
    }

    // Remove o link se a IA tentar enviar quando já enviou (mas mantém resto da msg)
    let replyFinal = reply;
    if (ofertaEnviada[chatId] && reply.includes(LINK_OFERTA)) {
      // IA está tentando enviar link de novo, permite mas registra
      log("ℹ️ IA reforçando link...");
    }

    await sendTextHuman(chatId, replyFinal, false);
    
    // Verifica se enviou link nesta resposta
    if (reply.includes(LINK_OFERTA) && !ofertaEnviada[chatId]) {
      ofertaEnviada[chatId] = true;
      log(`✅ Link enviado pela IA: ${chatId}`);
      
      // Agenda follow-up
      agendarFollowUp(chatId);
    }
    
    // 6️⃣ REENGAJAMENTO AUTOMÁTICO
    // Se o lead não responder após link, IA vai tentar de novo
    const ctx = conversationContext[chatId];
    if (ofertaEnviada[chatId] && ctx && ctx.tentativasVenda < 5) {
      // Não foi muito insistente ainda, continua tentando
      const nivelInteresse = ctx.nivelInteresse || 5;
      
      if (nivelInteresse >= 7) {
        // Alto interesse mas não converteu, insiste mais
        setTimeout(async () => {
          const push = await askOpenAI(chatId, "ele demonstrou interesse mas não assinou, seja mais persuasiva e insistente") || "";
          if (push) await sendTextHuman(chatId, push, false);
        }, 15000); // 15 segundos depois
      }
    }
  });
});

// ==================== INICIALIZAÇÃO ====================
client.initialize().catch(console.error);

// Log de inicialização
log("🚀 Bot iniciado com foco em CONVERSÃO");
log("📊 Recursos ativos:");
log("   ✅ Detecção de objeções");
log("   ✅ Análise de interesse");
log("   ✅ Respostas safadas otimizadas");
log("   ✅ Sistema de follow-up automático");
log("   ✅ Nunca desiste até converter");
log("   ✅ Transcrição de áudios");
log(`   ✅ ${audiosDrive.length} áudios disponíveis`);