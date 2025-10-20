/**
 * Script para converter todos os áudios em media/ para formato compatível com WhatsApp
 * Cria versões novas com prefixo "fixed_"
 * Requer: ffmpeg instalado e disponível no PATH
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const inputDir = path.resolve("./media");
const files = fs.readdirSync(inputDir);

const outputCodec = "libopus"; // codec correto para WhatsApp

console.log("🎧 Iniciando conversão dos áudios...\n");

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file, ext);
  const inputPath = path.join(inputDir, file);
  const outputPath = path.join(inputDir, `fixed_${name}.ogg`);

  // Ignorar se já é "fixed_"
  if (file.startsWith("fixed_")) continue;

  // Converter apenas arquivos de áudio comuns
  if (![".ogg", ".opus", ".mp3", ".m4a", ".wav"].includes(ext)) continue;

  try {
    console.log(`🎶 Convertendo: ${file} → fixed_${name}.ogg`);
    execSync(
      `ffmpeg -y -i "${inputPath}" -c:a ${outputCodec} -b:a 64k "${outputPath}"`,
      { stdio: "ignore" }
    );
  } catch (err) {
    console.error(`❌ Erro ao converter ${file}:`, err.message);
  }
}

console.log("\n✅ Conversão concluída!");
console.log("Todos os arquivos convertidos estão com prefixo 'fixed_'.");
