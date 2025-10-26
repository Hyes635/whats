/*******************************************************
 * index.js - bot whatsapp-web.js + OpenAI (Whisper)
 * VERSÃO HUMANIZADA v2 - Conversação natural e vendas sutis
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
const MAX_CONTEXT_MESSAGES = 12;

function atualizarContexto(chatId, novaMensagem) {
  if (!conversationContext[chatId]) {
    conversationContext[chatId] = { 
      tokenCount: 0, 
      mensagens: [],
      nivelInteresse: 0,
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
const objecoesUsuario = {};

// ==================== ANÁLISE DE INTERESSE ====================
function analisarNivelInteresse(text, chatId) {
  if (!text) return;
  const lower = text.toLowerCase();
  
  const altaIntencao = [
    'quero', 'gostei', 'adorei', 'delicia', 'tesão', 'gostosa', 
    'safada', 'quanto', 'preço', 'valor', 'comprar', 'assinar',
    'ver mais', 'me mostra', 'continua', 'mais', 'link', 'perfil'
  ];
  
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

// ==================== CONTROLE DE EMOJIS MUITO REDUZIDO ====================
const emojisPorContexto = {
  flerte: ["😏", "😈"],
  excitacao: ["🔥", "💦"],
  carinho: ["😘", "❤️"],
  provocacao: ["😏"],
  risada: ["😂"],
};

const emojiHistory = {};

function getEmojiNatural(chatId, contexto = 'flerte') {
  // Apenas 8% de chance de usar emoji (bem raro)
  if (Math.random() > 0.08) return "";
  
  if (!emojiHistory[chatId]) {
    emojiHistory[chatId] = { lastEmoji: null, count: 0, lastUsed: 0 };
  }
  
  // Se usou emoji nas últimas mensagens, não usa
  if (emojiHistory[chatId].count > 0) {
    emojiHistory[chatId].count--;
    return "";
  }
  
  // Cooldown: não usa emoji se usou recentemente
  const agora = Date.now();
  if (agora - emojiHistory[chatId].lastUsed < 300000) { // 5 minutos
    return "";
  }
  
  const lista = emojisPorContexto[contexto] || emojisPorContexto.flerte;
  const escolhido = lista[Math.floor(Math.random() * lista.length)];
  
  emojiHistory[chatId].lastEmoji = escolhido;
  emojiHistory[chatId].count = 4; // Bloqueia próximas 4 mensagens
  emojiHistory[chatId].lastUsed = agora;
  
  return " " + escolhido;
}

// ==================== SIMULAÇÃO DE ESTADOS ====================
async function simularDigitando(chatId, duracao = null) {
  const chat = await client.getChatById(chatId).catch(() => null);
  if (!chat) return;
  
  const duracaoReal = duracao || (2000 + Math.random() * 4000);
  
  try {  
    await chat.sendStateTyping();
    await sleep(duracaoReal);
    await chat.clearState();
  } catch (e) {
    log("erro simularDigitando:", e.message);
  }
}

async function simularGravando(chatId, duracao = null) {
  const duracaoReal = duracao || (3000 + Math.random() * 3000);
  
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateRecording();
    await sleep(duracaoReal);
    await chat.clearState();
  } catch (e) {
    log("erro simularGravando:", e.message);
  }
}

// ==================== QUEBRA DE MENSAGENS NATURAL ====================
function quebrarMensagemNatural(texto) {
  if (!texto) return [];
  
  // Remove texto indesejado e marcações
  const proibidas = [
    "já te mandei isso",
    "já te falei",
    "te expliquei antes",
    "me conta mais disso",
    "\\brs\\b",
    "\\[pausa\\]",
    "\\(pausa\\)",
    "\\[LINK\\]"
  ];

  let msg = texto;
  for (const frase of proibidas) {
    const regex = new RegExp(frase, "gi");
    msg = msg.replace(regex, "");
  }

  msg = msg
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+|\s+$/g, "")
    .trim();

  if (!msg) return [];

  // Quebra agressiva - mensagens BEM curtas
  const pedacos = [];
  
  // Separa por pontuação forte
  const sentencas = msg.split(/([.!?]+)\s*/);
  let textoAtual = "";
  
  for (let i = 0; i < sentencas.length; i++) {
    const parte = sentencas[i].trim();
    if (!parte) continue;
    
    // Se é pontuação, pula (vamos remover depois)
    if (parte.match(/^[.!?]+$/)) {
      continue;
    }
    
    // Se o texto atual já tem conteúdo
    if (textoAtual) {
      // Se ficaria muito longo, quebra antes
      if (textoAtual.length > 45 || (textoAtual + " " + parte).length > 70) {
        pedacos.push(textoAtual.trim());
        textoAtual = parte;
      } else {
        textoAtual += " " + parte;
      }
    } else {
      textoAtual = parte;
    }
    
    // Se o texto atual tá bom, quebra
    if (textoAtual.length > 60) {
      pedacos.push(textoAtual.trim());
      textoAtual = "";
    }
  }
  
  if (textoAtual.trim()) {
    pedacos.push(textoAtual.trim());
  }
  
  // Segunda passada: quebra mensagens ainda longas
  const pedacosFinais = [];
  for (const pedaco of pedacos) {
    if (pedaco.length <= 70) {
      pedacosFinais.push(pedaco);
      continue;
    }
    
    // Quebra por vírgulas ou conjunções
    const subpartes = pedaco.split(/,\s+|(?:\s+(?:mas|e|então|aí|né|porque|que)\s+)/i);
    let temp = "";
    
    for (const sub of subpartes) {
      if (!sub.trim()) continue;
      
      if (!temp) {
        temp = sub.trim();
      } else if ((temp + " " + sub).length > 65) {
        pedacosFinais.push(temp.trim());
        temp = sub.trim();
      } else {
        temp += " " + sub.trim();
      }
    }
    
    if (temp.trim()) {
      pedacosFinais.push(temp.trim());
    }
  }
  
  // Remove reticências e limpa pontuação (mantém apenas ?)
  const pedacosLimpos = pedacosFinais.map(p => {
    let limpo = p.trim();
    // Remove reticências múltiplas
    limpo = limpo.replace(/\.{2,}/g, '');
    limpo = limpo.replace(/…/g, '');
    // Remove pontuação final se não for pergunta
    if (!limpo.endsWith('?')) {
      limpo = limpo.replace(/[.!,;:]+$/, '');
    }
    return limpo;
  }).filter(p => p.length > 0);
  
  // Limita a 4 mensagens
  return pedacosLimpos.slice(0, 4);
}

// ==================== ENVIO DE TEXTO HUMANIZADO ====================
async function sendTextHuman(chatId, text, contexto = 'normal') {
  if (!sentAudioByContact[chatId]) {
    sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
  }

  if (!text) return;
  
  const temLink = text.includes('http');
  
  // Se tem link, separa ele em mensagem própria
  if (temLink) {
    const partes = text.split(/(https?:\/\/[^\s]+)/);
    
    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i].trim();
      if (!parte) continue;
      
      if (parte.match(/^https?:\/\//)) {
        // É um link - envia sozinho após pausa
        await simularDigitando(chatId, 1000 + Math.random() * 1500);
        await client.sendMessage(chatId, parte);
        if (i < partes.length - 1) await sleep(1200 + Math.random() * 1000);
      } else {
        // É texto - quebra em mensagens menores
        const pedacos = quebrarMensagemNatural(parte);
        
        for (let j = 0; j < pedacos.length; j++) {
          const pedaco = pedacos[j];
          
          // Emoji apenas na última mensagem da última parte, raramente
          let textoFinal = pedaco;
          if (j === pedacos.length - 1 && i === partes.length - 1 && Math.random() < 0.12) {
            textoFinal += getEmojiNatural(chatId, contexto);
          }
          
          await simularDigitando(chatId, 1800 + Math.random() * 2500);
          await client.sendMessage(chatId, textoFinal);
          
          // Pausa entre mensagens
          if (j < pedacos.length - 1 || i < partes.length - 1) {
            await sleep(1200 + Math.random() * 2500);
          }
        }
      }
    }
    return;
  }
  
  // Mensagem sem link - quebra em várias mensagens curtas
  const pedacos = quebrarMensagemNatural(text);
  
  for (let i = 0; i < pedacos.length; i++) {
    const pedaco = pedacos[i];
    
    // Emoji APENAS na última mensagem e muito raramente
    let textoFinal = pedaco;
    if (i === pedacos.length - 1 && Math.random() < 0.10) {
      textoFinal += getEmojiNatural(chatId, contexto);
    }
    
    // Simula digitação com tempo variável
    await simularDigitando(chatId, 2000 + Math.random() * 3000);
    await client.sendMessage(chatId, textoFinal);
    
    // Pausa entre mensagens (se não for a última)
    if (i < pedacos.length - 1) {
      await sleep(1400 + Math.random() * 2800);
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
      await sendTextHuman(chatId, "ops, meu áudio bugou", 'normal');
      return;
    }

    if (audioJaEnviado(chatId, audioName)) {
      const reply = await askOpenAI(chatId, "continua a conversa de forma provocante sem ser muito explicita") || "";
      await sendTextHuman(chatId, reply, 'flerte');        
      return;
    }

    const audioUrl = audiosDriveMap[audioName];
    if (!audioUrl) {
      await sendTextHuman(chatId, "tô com probleminha aqui amor", 'normal');
      return;
    }

    await simularDigitando(chatId, 1500 + Math.random() * 1500);
    await simularGravando(chatId, 2500 + Math.random() * 2000);

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
      await sendTextHuman(chatId, "calma amor, já volto", 'normal');
    } catch (e) {}
  }
}

// ==================== INTEGRAÇÃO OPENAI (HUMANIZADA E GRADUAL) ====================
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

  const respostasObjecoes = {
    preco: [
      "entendo amor, mas pensa: é menos que um lanche",
      "eu sei que parece, mas você vai usar todo dia",
      "comparado com outras tá barato demais"
    ],
    tempo: [
      "os melhores conteúdos eu posto hoje",
      "entendo, mas quanto tempo você já passou aqui",
      "me salva aí pelo menos, quando quiser você volta"
    ],
    desconfianca: [
      "sou real sim amor, quer que eu mande um áudio",
      "eu verifico meu perfil, pode conferir",
      "se fosse fake eu nem tava conversando tanto"
    ],
    comparacao: [
      "grátis você acha em qualquer lugar",
      "pode procurar, mas ninguém conversa assim",
      "conteúdo grátis todo mundo tem"
    ],
    indecisao: [
      "pensar o quê amor, você quer ou não",
      "quanto mais você pensa, mais fica curioso",
      "me salva aí, quando bater a vontade você volta"
    ]
  };

  const systemPrompt = `você é Bianca Lika, 21 anos, de Curitiba. mulher safada, confiante, sedutora.
OBJETIVO: fazer o lead assinar o fanvue ${LINK_OFERTA} de forma GRADUAL e NATURAL

🎭 PERSONALIDADE:
- conversa como pessoa REAL, sem robô
- respostas CURTAS (máximo 1-2 frases)
- minúsculas sempre
- SEM pontuação final (só usa ? em perguntas)
- NUNCA usa reticências (...)
- NUNCA escreve [pausa] ou marcações
- emoji RARÍSSIMO (quase nunca)
- usa "kkk" quando algo é engraçado
- fala direto, sem enrolação

🔥 ESTRATÉGIA GRADUAL (IMPORTANTE):

**FASE 1 - CONEXÃO (mensagens 1-4):**
- SÓ conversa normal, conhece o lead
- faz perguntas sobre ELE
- demonstra interesse genuíno
- NÃO fala de conteúdo adulto ainda
- exemplo: "você é de onde" "do que você gosta" "trabalha com o que"
- seja leve, descontraída, real

**FASE 2 - CURIOSIDADE (mensagens 5-8):**
- insinua sutilmente que tem algo especial
- NÃO diz "vídeos safadinhos" - muito barato
- usa: "tenho umas coisas que poucos veem" "você parece diferente"
- cria mistério: "será que você aguenta"
- mantém controle da conversa

**FASE 3 - DESEJO (mensagens 9-12):**
- aumenta tensão sexual gradualmente
- responde provocações com MAIS provocação
- se ele fala putaria, você fala mais
- MAS sempre mantém controle: "calma aí"
- não oferece nada direto, cria necessidade

**FASE 4 - EXCLUSIVIDADE (mensagens 12+):**
- agora sim fala do "lugar especial"
- NUNCA "vídeos" ou "conteúdo" - soa comercial
- usa: "tenho um lugar onde faço tudo" "só mostro pra quem é VIP" "lá eu não tenho limites"
- cria FOMO: "poucos têm acesso"

**FASE 5 - OFERTA (quando ele pedir ou mostrar muito interesse):**
- apresenta link naturalmente
- exemplo: "quer ver tudo que eu faço" [pausa] [link]
- destaca: "lá eu respondo todo mundo" "posto todo dia"

${objecao ? `
🚨 OBJEÇÃO DETECTADA: "${objecao}"
${respostasObjecoes[objecao]?.map((r, i) => `${i + 1}. ${r}`).join('\n')}
Depois reforça sutilmente o valor
` : ''}

⚠️ REGRAS CRÍTICAS:
- NAS PRIMEIRAS 4 MENSAGENS: só conversa normal, ZERO sexo
- NUNCA diz "vídeos safadinhos" ou "conteúdo picante" - soa desesperado
- Use: "tenho um lugar especial" "lá eu faço tudo" "só pra VIP"
- SEM reticências (...) NUNCA
- SEM pontuação final (exceto ?)
- SEM emoji (só raramente)
- QUEBRE mensagens em múltiplas caixas curtas
- Responda na ENERGIA do lead mas mantenha controle
- ${linkJaEnviado ? '✅ link enviado - convence do valor' : '📍 construa desejo primeiro'}
- Contexto: ${numMensagens} mensagens | Interesse: ${nivelInteresse}/10

💬 EXEMPLOS:

Lead: "nossa que voz linda"
❌ ERRADO: "você sabia que eu tenho bastante conteúdo safadinho"
✅ CERTO: "obrigada" + "o que mais você achou de mim"

Lead: "ta fazendo o que de bom gatinha"
❌ ERRADO: "sempre tem algo novo pra você ver"
✅ CERTO: "aqui conversando com você" + "e você, aprontando"

Lead: "queria ouvir uns gemidos seu"
❌ ERRADO: "gemidos kkk tenho uns vídeos bem safadinhos"
✅ CERTO: "calma lá" + "você já tá querendo tudo" + "vamos devagar que eu te mostro"

Lead: "uma vídeo chamada ou um vídeo seu gozando"
❌ ERRADO: "videochamada é complicado mas eu tenho conteúdo picante"
✅ CERTO: "videochamada eu não faço" + "mas tenho um lugar onde eu faço de tudo" + "coisas que você nem imagina"

Lead: "que tesão você mexendo na buceta"
❌ ERRADO: "eu adoro saber que te deixo assim"
✅ CERTO: "quer ver isso de verdade" + "ou só quer imaginar" + "porque eu gravo tudo"

NUNCA ofereça conteúdo explícito logo de cara
SEMPRE construa rapport antes (3-4 msgs)
Crie MISTÉRIO e EXCLUSIVIDADE
Seja PROVOCANTE mas com CLASSE`;

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
        max_tokens: 100,
        temperature: 0.85,
        presence_penalty: 0.7,
        frequency_penalty: 0.8,
      });

      let resposta = completion.choices?.[0]?.message?.content || "";
      const tokensUsados = completion.usage?.total_tokens || 0;
      
      // Remove emojis excessivos
      resposta = resposta.replace(/([\u{1F300}-\u{1F9FF}])\1+/gu, '$1');
      
      // Remove termos proibidos se aparecerem nas primeiras mensagens
      if (numMensagens < 4) {
        const termosProibidos = ['vídeo', 'video', 'safad', 'picante', 'conteúdo', 'conteudo'];
        for (const termo of termosProibidos) {
          const regex = new RegExp(termo, 'gi');
          if (regex.test(resposta)) {
            log(`⚠️ IA tentou falar de conteúdo muito cedo (msg ${numMensagens})`);
            // Força resposta mais casual
            resposta = resposta.replace(regex, '');
          }
        }
      }
      
      contarTokens(chatId, tokensUsados);
      atualizarContexto(chatId, { role: "user", content: userText });
      atualizarContexto(chatId, { role: "assistant", content: resposta });
      
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

client.on('qr', (qr) => {
  console.log("📱 Escaneie o QR code abaixo:\n");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => console.log("🤖 bot conectado no WhatsApp!"));

// ==================== SISTEMA DE FOLLOW-UP AUTOMÁTICO ====================
function agendarFollowUp(chatId, delay = 2 * 60 * 60 * 1000) {
  if (followTimers[chatId]) {
    clearTimeout(followTimers[chatId]);
  }

  if (ofertaEnviada[chatId]) {
    followTimers[chatId] = setTimeout(async () => {
      try {
        const mensagensFollow = [
          "e aí, conseguiu ver",
          "opa, sumiu",
          "tava pensando em você aqui",
          "bora matar essa curiosidade"
        ];
        
        const msg = mensagensFollow[Math.floor(Math.random() * mensagensFollow.length)];
        await sendTextHuman(chatId, msg, 'normal');
        
        agendarFollowUp(chatId, 6 * 60 * 60 * 1000);
      } catch (e) {
        log("Erro no follow-up:", e.message);
      }
    }, delay);
  }
}

// ==================== HANDLER DE MENSAGENS (HUMANIZADO) ====================
client.on("message", async (msg) => {
  const chatId = msg.from;
  const agora = Date.now();
  let text = msg.body?.trim() || "";

  if (msg.fromMe) return;

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
    
    // TRANSCRIÇÃO DE ÁUDIO
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
    
    analisarNivelInteresse(text, chatId);
    
    const objecao = detectarObjecao(text);
    if (objecao && !objecoesUsuario[chatId].includes(objecao)) {
      objecoesUsuario[chatId].push(objecao);
      log(`🚨 Objeção detectada: ${objecao}`);
    }

    // Delay natural e variável
    await sleep(1800 + Math.random() * 2500);

    // DETECTA PEDIDO EXPLÍCITO DE LINK
    const tipoPedido = detectarPedidoLink(text);
    
    if (tipoPedido) {
      const introducoes = [
        "olha só",
        "aqui amor",
        "é aqui",
        "vem"
      ];
      
      const introducao = introducoes[Math.floor(Math.random() * introducoes.length)];
      
      // Envia introdução
      await sendTextHuman(chatId, introducao, 'normal');
      
      // Pausa antes do link
      await sleep(1500 + Math.random() * 1500);
      
      // Envia link sozinho com digitação
      await simularDigitando(chatId, 1200 + Math.random() * 1000);
      await client.sendMessage(chatId, LINK_OFERTA);
      
      // Depois explica o valor
      await sleep(2000 + Math.random() * 1500);
      
      const explicacoes = [
        "lá eu mostro tudo",
        "você vai gostar do que vai ver",
        "posto todo dia conteúdo novo",
        "respondo todo mundo lá"
      ];
      
      const explicacao = explicacoes[Math.floor(Math.random() * explicacoes.length)];
      await sendTextHuman(chatId, explicacao, 'normal');
      
      if (!ofertaEnviada[chatId]) {
        ofertaEnviada[chatId] = true;
        userAskedForLink[chatId] = true;
        agendarFollowUp(chatId);
      }
      
      atualizarContexto(chatId, { role: "user", content: text });
      atualizarContexto(chatId, { role: "assistant", content: introducao + " " + LINK_OFERTA + " " + explicacao });
      
      log(`✅ Link enviado: ${chatId}`);
      return;
    }

    // GATILHOS DE ÁUDIO
    const trig = checkAudioTrigger(text);
    if (trig && audiosDriveMap[trig]) {
      if (!audioJaEnviado(chatId, trig)) {
        await sendAudioHuman(chatId, trig);
        
        // Após áudio, continua conversa sutilmente
        if (!ofertaEnviada[chatId] && Math.random() > 0.5) {
          await sleep(2500 + Math.random() * 2000);
          const push = await askOpenAI(chatId, "continua a conversa de forma natural sem mencionar conteúdo explícito ainda") || "";
          if (push) {
            await sendTextHuman(chatId, push, 'normal');
          }
        }
        
        return;
      }
    }

    // CONVERSA COM IA
    const reply = await askOpenAI(chatId, text) || "";
    
    if (!reply) {
      await sendTextHuman(chatId, "calma aí amor", 'normal');
      return;
    }
    
    // Detecta contexto emocional
    let contexto = 'normal';
    if (reply.match(/gostosa|safad|tesão|delícia|goza|prazer/i)) {
      contexto = 'flerte';
    } else if (reply.match(/kkk|haha|rsrs/i)) {
      contexto = 'risada';
    } else if (reply.match(/amor|bebê|fofo|lindo/i)) {
      contexto = 'carinho';
    }
    
    await sendTextHuman(chatId, reply, contexto);
    
    if (reply.includes(LINK_OFERTA) && !ofertaEnviada[chatId]) {
      ofertaEnviada[chatId] = true;
      log(`✅ Link enviado pela IA: ${chatId}`);
      agendarFollowUp(chatId);
    }
    
    // REENGAJAMENTO (menos agressivo)
    const ctx = conversationContext[chatId];
    if (ofertaEnviada[chatId] && ctx && ctx.tentativasVenda < 3) {
      const nivelInteresse = ctx.nivelInteresse || 5;
      
      if (nivelInteresse >= 7 && Math.random() > 0.7) {
        setTimeout(async () => {
          const push = await askOpenAI(chatId, "ele tá muito interessado mas não decidiu, dá um empurrãozinho sutil e natural") || "";
          if (push) await sendTextHuman(chatId, push, 'flerte');
        }, 25000 + Math.random() * 15000);
      }
    }
  });
});

// ==================== INICIALIZAÇÃO ====================
client.initialize().catch(console.error);

log("🚀 Bot humanizado v2 iniciado");
log("📊 Características:");
log("   ✅ Construção GRADUAL de desejo (4 fases)");
log("   ✅ Conexão real antes de vender");
log("   ✅ Mensagens quebradas (45-70 chars)");
log("   ✅ Emojis raríssimos (8% apenas)");
log("   ✅ SEM reticências ou [pausa]");
log("   ✅ SEM pontuação final (exceto ?)");
log("   ✅ Link sempre separado");
log("   ✅ Linguagem exclusiva e misteriosa");
log("   ✅ Timing variável (2-5s)");
log(`   ✅ ${audiosDrive.length} áudios disponíveis`);