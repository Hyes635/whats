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
    const ofertaEnviada = {}; // controla se a oferta já foi enviada por chat
    const userAskedForLink = {};     // novo: true se o link foi enviado por pedido do usuário

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
        conversationContext[chatId] = { tokenCount: 0, mensagens: [] };
      }

      // Se ainda for array antigo, converte
      if (Array.isArray(conversationContext[chatId])) {
        conversationContext[chatId] = { tokenCount: 0, mensagens: conversationContext[chatId] };
      }

      conversationContext[chatId].mensagens.push(novaMensagem);

      // limita tamanho
      if (conversationContext[chatId].mensagens.length > MAX_CONTEXT_MESSAGES) {
        conversationContext[chatId].mensagens.shift();
      }
    }


    // 🧠 Função separada para contar tokens
    function contarTokens(chatId, tokensUsados) {
      if (!conversationContext[chatId]) conversationContext[chatId] = { tokenCount: 0, mensagens: [] };
      if (!conversationContext[chatId].tokenCount) conversationContext[chatId].tokenCount = 0;
      conversationContext[chatId].tokenCount += tokensUsados;

      if (conversationContext[chatId].tokenCount > 7000) {
        console.log(`🧹 limpando contexto antigo do chat ${chatId}`);
        conversationContext[chatId].mensagens = conversationContext[chatId].mensagens.slice(-5);
        conversationContext[chatId].tokenCount = 0;
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


    async function transcreverAudio(localPath) {
      try {
        const resp = await openai.audio.transcriptions.create({
          file: fs.createReadStream(localPath),
          model: "whisper-1",
          language: "pt", // idioma: português
        });
    
        return resp.text || "";
      } catch (err) {
        console.error("Erro na transcrição (Whisper):", err);
        return "";
      }
    }
    

    import OpenAI from "openai";
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const LINK_OFERTA = "https://www.fanvue.com/likinha";


    const client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });
    
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

    // --- Controle de Emojis
    const emojiList = ["😊", "😉", "😏", "😻", "❤️", "😈", "🤭", "🥰", "😘"];
    const emojiHistory = {}; // { chatId: { lastEmoji, used: Set } }

    function getEmojiControlado(chatId) {
      if (!emojiHistory[chatId]) emojiHistory[chatId] = { lastEmoji: null, used: new Set() };
      const { lastEmoji, used } = emojiHistory[chatId];

      // chance de apenas 10%
      if (Math.random() > 0.05) return "";

      // reseta se já usou quase todos
      if (used.size >= emojiList.length - 2) used.clear();

      // filtra para não repetir o último nem os já usados recentemente
      const disponíveis = emojiList.filter(e => e !== lastEmoji && !used.has(e));
      const escolhido = disponíveis[Math.floor(Math.random() * disponíveis.length)];

      used.add(escolhido);
      emojiHistory[chatId].lastEmoji = escolhido;

      return " " + escolhido;
    }

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
      return sentAudioByContact[chatId]?.audios?.has(audioName);
    }
    function registrarAudioEnviado(chatId, audioName) {
      if (!sentAudioByContact[chatId]) {
        sentAudioByContact[chatId] = { audios: new Set(), usedEmojis: new Set() };
        }
      sentAudioByContact[chatId].audios.add(audioName);
    }

    // ---------- simulação de digitação / gravação ----------
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

        // remove pontuação grudada em links
        texto = texto.replace(/(https?:\/\/[^\s.,!?]+)/g, "$1");
        texto = texto.replace(/([.,!?])\s*(https?:\/\/[^\s]+)/g, " $2");
        texto = texto.replace(/(https?:\/\/[^\s]+)[.,!?]+$/g, "$1");
      
      
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
      let msg = String(text).trim();
      if (!msg) return;
    
      // 🧹 lista de frases proibidas
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
    
      // 🧼 remove frases proibidas mesmo com pontuação, emojis ou variações de espaço
      for (const frase of proibidas) {
        const pattern = frase
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escapa caracteres especiais
          .replace(/\s+/g, "\\s*");               // ignora variações de espaço
        const regex = new RegExp(pattern + "[\\s.,!?🤭😏😈😻😅😂🥰💋💦❤️]*", "gi");
        msg = msg.replace(regex, "");
      }
    
      // limpa espaços e pontuação sobrando
      msg = msg
        .replace(/\s{2,}/g, " ")
        .replace(/^\s+|\s+$/g, "")
        .replace(/\s+([.,!?])/g, "$1")
        .trim();
    
      if (!msg) return; // se sobrar nada, não envia
    
      // simula digitação
      await simularDigitando(chatId, 3000 + Math.random() * 4000);
    
      // quebra em partes curtas (máx. 2 linhas cada)
      const partes = msg.includes("http")
        ? [msg]
        : msg.split(/[.!?]/).map(p => p.trim()).filter(p => p.length > 0);
    
      const random = Math.random();
      const qtd = Math.min(
        partes.length,
        random < 0.4 ? 1 : random < 0.8 ? 2 : 3
      );
      const escolhidas = partes.slice(0, qtd);
    
      // chance pequena de emoji (10%)
      let emoji = "";
const addEmoji = !isFirst && Math.random() < 0.1;

if (addEmoji) {
  if (!emojiHistory[chatId]) emojiHistory[chatId] = new Set();
  const allEmojis = ["😊", "😉", "😏", "😻", "❤️", "😈", "🤭", "🥰", "😘"];
  const used = emojiHistory[chatId];

  if (used.size >= allEmojis.length) used.clear();

  const available = allEmojis.filter(e => !used.has(e));
  if (available.length > 0) {
    emoji = " " + available[Math.floor(Math.random() * available.length)];
    used.add(emoji.trim());
  }
}

    
      // envia mensagens em partes com pausas
      for (let i = 0; i < escolhidas.length; i++) {
        const textoFinal = escolhidas[i] + emoji;
        await client.sendMessage(chatId, textoFinal);
        if (i < escolhidas.length - 1 && !msg.includes("http")) {
          await sleep(1500 + Math.random() * 1500);
          await simularDigitando(chatId, 2000 + Math.random() * 2000);
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
          const reply = await askOpenAI(chatId, "continua a conversa normalmente") || "";
          await sendTextHuman(chatId, reply, false);        
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

    
    // ---------- OpenAI interaction ----------
    async function askOpenAI(chatId, userText) {
      const timeoutMs = 20000;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      frases possíveis: 
      - “lá eu mostro mais de mim 😏”
      - “me vê lá, é mais fácil”
      - “acho que você vai gostar do que tem lá”
      
      🧠 sempre mantenha a conversa engajada, sem parecer que quer vender algo.
      se o lead responder de forma fria, tente reaquecer o papo com curiosidade ou humor.
      se ele for mais ousado, mantenha o controle com charme e confiança.
      
      🎙️ quando fizer sentido mandar áudio, use o formato <AUDIO:nome.ext>.
      
      
      
      contexto: ${allAudios.map(a => `- ${a}`).join("\n")}
      `;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(conversationContext[chatId]?.mensagens || []),
      { role: "user", content: userText }
    ];
    
    let tentativa = 0;
    while (tentativa < 3) {
      try {
    
        // sempre reforça o estilo a cada pergunta
        const messages = [
          { role: "system", content: systemPrompt },
          ...(conversationContext[chatId]?.mensagens || []),
          { role: "user", content: userText }
        ];      
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          max_tokens: 300,
          temperature: 0.9,
          presence_penalty: 0.5,
          frequency_penalty: 0.8,
        });

        const resposta = completion.choices?.[0]?.message?.content || "";
        const tokensUsados = completion.usage?.total_tokens || 0;
        contarTokens(chatId, tokensUsados);
        atualizarContexto(chatId, { role: "assistant", content: resposta });
        return resposta;

      } catch (err) {
        if (err.status === 429) {
          tentativa++;
          console.log(`⚠️ Rate limit atingido (tentativa ${tentativa}), aguardando...`);
          await sleep(2000 * tentativa); // espera 2s, 4s, 6s...
          continue;
        } else {
          console.log(`⚠️ Erro na OpenAI: ${err.message}`);
          return "";
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return ""; // se falhar todas as tentativas
    }
    
    // 📨 Fila por usuário para evitar respostas simultâneas
    const filaMensagens = {};

    async function processarFila(chatId, handler) {
      if (filaMensagens[chatId]) await filaMensagens[chatId];
      const promessa = handler().catch(console.error);
      filaMensagens[chatId] = promessa.finally(() => delete filaMensagens[chatId]);
      return promessa;
    }

    const lastMessageTime = {};

    // marca o usuário que pediu link (pra evitar followup depois)
    function markUserAskedLink(chatId) {
      userAskedForLink[chatId] = true;
      setTimeout(() => {
        delete userAskedForLink[chatId];
      }, 6 * 60 * 60 * 1000); // limpa depois de 6 horas
    }
    client.on("message", async (msg) => {
      const chatId = msg.from;
      const agora = Date.now();
      let text = msg.body?.trim() || "";
    
      if (msg.fromMe) return;
    
      if (!userAskedForLink[chatId]) userAskedForLink[chatId] = false;
      if (!ofertaEnviada[chatId]) ofertaEnviada[chatId] = false;
    
      // detectar pedido explícito de link/perfil
      // detecta interesse claro em ver o perfil / link
const explicitLinkRegex = /\b(fanvue|link|perfil|ver você|ver vc|onde te vejo|como te vejo|onde posso ver|me passa|me manda|me mostra|qual seu fanvue|quero te ver|quero ver|como acesso|como entro|como assino|como vejo|onde fica)\b/i;
const pediuLink = explicitLinkRegex.test(text);

    
if (pediuLink && !ofertaEnviada[chatId]) {
  markUserAskedLink(chatId);
  
  const respostasLink = [
    `claro 😏 dá uma olhada aqui ${LINK_OFERTA}`,
    `te mando sim 😘 ${LINK_OFERTA}`,
    `aqui amor 💋 ${LINK_OFERTA}`,
    `me encontra lá 😈 ${LINK_OFERTA}`,
    `olha só, é aqui que posto tudo ${LINK_OFERTA}`
  ];
  
  const respostaEscolhida = respostasLink[Math.floor(Math.random() * respostasLink.length)];
  await sendTextHuman(chatId, respostaEscolhida);
  
  ofertaEnviada[chatId] = true;
  return;
}

    
      // controle anti-spam
      const MIN_INTERVAL = 2000;  
      if (lastMessageTime[chatId] && agora - lastMessageTime[chatId] < MIN_INTERVAL) {
        await sleep(1000);
      }
      lastMessageTime[chatId] = agora;
    
    
      await processarFila(chatId, async () => {
    
        atualizarContexto(chatId, { role: "user", content: text });
        if (!memoryStore[chatId]) memoryStore[chatId] = { history: [], lastActive: Date.now() };
        memoryStore[chatId].lastActive = Date.now();
    
        // --- Transcrição de áudio ---
        try {
          if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const mime = media.mimetype || "";
            const ext = mime.includes("/") ? mime.split("/")[1].split(";")[0] : "ogg";
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
    
        memoryStore[chatId].history.push({ role: "user", content: text });
        if (memoryStore[chatId].history.length > 16) memoryStore[chatId].history.shift();
    
        log("mensagem do lead:", text);
        await sleep(2500 + Math.random() * 1500);
    
        const trig = checkAudioTrigger(text);
        if (trig && audiosDriveMap[trig]) {
          if (!audioJaEnviado(chatId, trig)) {
            await sendAudioHuman(chatId, trig);
          } else {
            const reply = await askOpenAI(chatId, text) || "";
            await sendTextHuman(chatId, reply, false);
          }
    
          return;
        }
    
        const reply = await askOpenAI(chatId, text) || "";
        const replyText = String(reply || "");
    
        const audioMatch = replyText.match(/<<AUDIO:\s*([^>]+)>>/i);
        if (audioMatch) {
          const fname = audioMatch[1].trim();
          if (audiosDriveMap[fname]) {
            if (!audioJaEnviado(chatId, fname)) {
              await sendAudioHuman(chatId, fname);
            } else {
              const reply = await askOpenAI(chatId, "continua a conversa normalmente") || "";
              await sendTextHuman(chatId, reply, false);
            }
          } else {
            await sendTextHuman(chatId, "amor, to com um probleminha aqui, me espera um pouquinho", false);
          }
          return;
        }
    
        await sendTextHuman(chatId, replyText, false);
    
        // se o lead NÃO pediu link → agenda T3
        if (!userAskedForLink[chatId]) {
        }
      });
    });
    
    
    

    // inicializa
    client.initialize().catch(console.error);
