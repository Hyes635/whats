const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const axios = require("axios");


// === ARRAY COM SEUS ÁUDIOS DO DRIVE ===   
const audiosDrive = [
  { file: "fixed_prontinho__so_ascessar_o_conteudo.ogg", url: "https://drive.google.com/uc?export=download&id=1Lw-KiIv9V7pzPUvYG_djcuHtLiio7Frh" },
  { file: "fixed_to_indo_pra_acad.ogg", url: "https://drive.google.com/uc?export=download&id=1Be41WQoXIxNFhWzt8H5tGdRHk2e-Ee7Y" },
  { file: "fixed_voce_que_me_ver_peladinha.ogg", url: "https://drive.google.com/uc?export=download&id=1bEJqkr6FxmNZtV_VcYrziyCMP3Z8VTAz" },
  { file: "fixed_salva_meu_contato.ogg", url: "https://drive.google.com/uc?export=download&id=1y18Kgjargpxy1NAx3Mu6H2WYk0nMp9Yv" },
  { file: "fixed_quer_q_te_explique.ogg", url: "https://drive.google.com/uc?export=download&id=1ed1g_2JA1ATIhDretNZ3EXmQziw2p0Mm" },
  { file: "fixed_pra_me_ver_nua_tem_que_comprar_os_packs.ogg", url: "https://drive.google.com/uc?export=download&id=19drb30U3fwSzRe8nS_HtCZFw4QTR-P0H" },
  { file: "fixed_pra_vc_me_ver_pelada_tem_que_pagar.ogg", url: "https://drive.google.com/uc?export=download&id=1RhZarneh_YSBn1QME9mi4CbjMmpktRCL" },
  { file: "fixed_vou_ter_enviar_minhas_foto.ogg", url: "https://drive.google.com/uc?export=download&id=1aTuUjUh2bYkfPovuJMgoIkSSGDZ7NTbR" },
  { file: "fixed_saio_com_quem_ja_e_meu_cliente.ogg", url: "https://drive.google.com/uc?export=download&id=1gNds3pXyV_YYYzCUqzVg2BTirgw4IMst" },
  { file: "fixed_vc_demora_muito_pra_responder.ogg", url: "https://drive.google.com/uc?export=download&id=1ownw2nY3MooknDGkC6Fzykaq-QgS-nSg" },
  { file: "fixed_sou_de_vdd.ogg", url: "https://drive.google.com/uc?export=download&id=1YLtFCKezM5MimKRJLi2J8P0ujzcTd7Qz" },
  { file: "fixed_pedindo_pra_aguardar.ogg", url: "https://drive.google.com/uc?export=download&id=1Q3Th_tFRd8eVk5e5FHHy9C9nrkIBVvAB" },
  { file: "fixed_oi_gatinho_lindo.ogg", url: "https://drive.google.com/uc?export=download&id=1y5f5jizqFJHqZ1ygfaAooY3VlkoJWq-t" },
  { file: "fixed_ja_to_com_sdd.ogg", url: "https://drive.google.com/uc?export=download&id=1kfcn88RS2rVIIDwtd8pK5eBWQkqRVgjn" },
  { file: "fixed_mensagem_direta_pra_compra_.ogg", url: "https://drive.google.com/uc?export=download&id=1BDiti38QyZpy2XHORz8-N7aiJavCuGyU" },
  { file: "fixed_gravei_me_gozando_todinha.ogg", url: "https://drive.google.com/uc?export=download&id=1qzTAxv1OrmiQyJXmkM3onx2cZRJf1Q3H" },
  { file: "fixed_o_que_achou_das_amostras.ogg", url: "https://drive.google.com/uc?export=download&id=1JID4OZ8lY6ddDKnXfrsUKjiSrRAxPfSS" },
  { file: "fixed_oi_meu_amor_tudo_bem.ogg", url: "https://drive.google.com/uc?export=download&id=1HFtIUitU4ja79_8WhP1RhOPUj3RmXn5k" },
  { file: "fixed_bom_dia_meu_cliente_favorito.ogg", url: "https://drive.google.com/uc?export=download&id=11qw_EAYgmZF2MydCXIpdSZJd1-ny_to-" },
  { file: "fixed_a_nao_esquece_de_manda_o_comprovante.ogg", url: "https://drive.google.com/uc?export=download&id=1hFNadVThTjCw9EfFLTJ4nR4o65Rxh6uX" },
];

async function sendAudioTest(client, to, audio) {
  try {
    const response = await axios.get(audio.url, { responseType: "arraybuffer" });
    const media = new MessageMedia(
      "audio/ogg; codecs=opus",
      Buffer.from(response.data, "binary").toString("base64"),
      audio.file
    );

    await client.sendMessage(to, media, { sendAudioAsVoice: true });
    console.log(`✅ Enviado: ${audio.file}`);

    // Envia uma mensagem de texto com o nome do arquivo
    await client.sendMessage(to, `🎵 Enviado: ${audio.file}`);

  } catch (err) {
    console.error(`❌ Erro ao enviar ${audio.file}:`, err.message);
    await client.sendMessage(to, `⚠️ Erro ao enviar: ${audio.file}`);
  }
}

// === INICIALIZA O CLIENTE WHATSAPP ===
const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  console.log("📲 Escaneie o QR Code abaixo para conectar:");
  qrcode.generate(qr, { small: true }); // mostra o QR no terminal
});


client.on("ready", async () => {
  console.log("✅ Cliente conectado!");

  const numeroTeste = "5512981240688@c.us"; // 👈 coloque aqui SEU número de teste

  for (const audio of audiosDrive) {
    await sendAudioTest(client, numeroTeste, audio);
    await new Promise((res) => setTimeout(res, 5000)); // espera 5 segundos entre cada envio
  }

  console.log("🎉 Todos os áudios foram enviados!");
});

client.initialize();
