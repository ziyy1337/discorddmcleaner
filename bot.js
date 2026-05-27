const readline = require("readline");
const gradient = require("gradient-string");
const chalk = require("chalk");
const moment = require("moment");
const { Client } = require("discord.js-selfbot-v13");
const RATE_LIMIT_DELAY = 1000; // ms between delete ops

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const prompt = (q) => new Promise((resolve) => rl.question(q, resolve));

function clearConsole() {
  process.stdout.write('\x1Bc');
}

function printHeader() {
  console.log(gradient.instagram("──────────────────────────────"));
  console.log(gradient.instagram("      DM Temizleyici     "));
  console.log(gradient.instagram("──────────────────────────────\n"));
}

async function main() {
  clearConsole();
  printHeader();

  const token = process.env.DISCORD_TOKEN || await prompt(chalk.cyan("Lütfen hesabınızın tokenini giriniz: "));

  const client = new Client();

  try {
    await client.login(token);
  } catch {
    console.log(chalk.red("Token ile giriş başarısız!"));
    process.exit(1);
  }

  clearConsole();
  printHeader();
  console.log(chalk.green(`Giriş başarılı! Hesap: ${client.user.tag}`));
  console.log(chalk.blue(`Oluşturulma: ${moment(client.user.createdAt).format("LLL")}\n`));

  console.log(chalk.yellow("1 - DM temizlemeyi başlat\n"));

  const choice = await prompt(chalk.magenta("Seçiminiz: "));

  if (choice.trim() === "1") {
    clearConsole();
    printHeader();
    console.log(chalk.greenBright("──────────── DM Mesajları Siliniyor ────────────\n"));
    const idsInput = await prompt(chalk.cyan("Silmek istediğiniz kullanıcı ID'lerini (virgül/boşluk ile ayrılmış) giriniz: "));
    const userIds = idsInput.split(/[\s,]+/).filter(id => id && id.length >= 15);
    if (userIds.length === 0) {
      console.log(chalk.red("Geçerli kullanıcı ID'si bulunamadı."));
      process.exit(0);
    }
    let totalDeletedAll = 0;
    const promises = userIds.map(async (userId) => {
      let dmChannel = client.channels.cache.find(
        ch => ch.type === 1 && (ch.recipient?.id === userId || ch.recipients?.some(u => u.id === userId))
      );
      if (!dmChannel) {
        try {
          dmChannel = await client.users.fetch(userId).then(user => user.createDM());
        } catch {
          console.log(chalk.red(`Kullanıcı ${userId} ile DM kanalı bulunamadı veya açılamadı.`));
          return;
        }
      }
      console.log(chalk.yellow(`\n${userId} ile olan DM mesajlarınız silinmeye başlandı...`));
      const deletedCount = await deleteAllMessages(dmChannel, client.user.id, userId);
      totalDeletedAll += deletedCount;
    });
    await Promise.all(promises);
    console.log(chalk.green(`\nİşlem tamamlandı! Toplam silinen mesaj sayısı (tüm DMs): ${totalDeletedAll}`));
    process.exit(0);
  } else {
    console.log(chalk.red("Geçersiz seçim, çıkılıyor."));
    process.exit(0);
  }
}

async function deleteAllMessages(channel, clientUserId, userId) {
  let lastId = null;
  let totalDeleted = 0;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    let messages;
    try {
      messages = await channel.messages.fetch(options);
    } catch {
      break;
    }
    if (messages.size === 0) break;

    const ownMessages = messages.filter(m => m.author.id === clientUserId);
    for (const msg of ownMessages.values()) {
      try {
        await msg.delete();
        totalDeleted++;
        console.log(chalk.green(`[${userId}] Silinen mesaj sayısı: ${totalDeleted}`));
        await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
      } catch {}
    }

    lastId = messages.last().id;
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
  }
  return totalDeleted;
}

main();
