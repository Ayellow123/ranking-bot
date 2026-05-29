require("dotenv").config();

const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");

const WORLD = "pl228";
const TARGET_ALLY_TAGS = ["LN", "LN.", "LN!"];
const CHANNEL_ID = process.env.CHANNEL_ID;

const SAVE_FILE = "./farm-ranking-history.json";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log("Bot zalogowany jako " + client.user.tag);

  await wyslijRankingFarmiacych();

  ustawCodziennyRanking();
});

async function wyslijRankingFarmiacych() {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const topFarm = await pobierzTopFarmiacych(20);

  if (!topFarm.length) {
    console.log("Brak danych farmerów.");
    return;
  }

  dodajZmianyPozycji(topFarm);

  const farmerDnia = topFarm[0];
  const najwiekszyAwans = znajdzNajwiekszyAwans(topFarm);

  const content =
    "🌾 **TOP 20 Farmerów farmiących dziennie z Rodziny Plemion LN** 🌾\n" +
    formatujRanking(topFarm) +
    "\n👑 **Farmer dnia:** " +
    `${farmerDnia.name} [${farmerDnia.allyTag}] - ${formatNumber(farmerDnia.value)} - ${farmerDnia.date}` +
    "\n📈 **Największy awans:** " +
    (najwiekszyAwans
      ? `${najwiekszyAwans.name} [${najwiekszyAwans.allyTag}] - ▲${najwiekszyAwans.awans}`
      : "brak awansów");

  await channel.send(content);

  zapiszRanking(topFarm);

  console.log("Wysłano ranking farmerów.");
}

async function pobierzTopFarmiacych(limit) {
  const wynik = [];

  for (let offset = 0; offset <= 300; offset += 25) {
    const url =
      `https://${WORLD}.plemiona.pl/guest.php?village=null&screen=ranking&mode=in_a_day&type=loot_res&offset=${offset}`;

    console.log("Pobieram offset " + offset);

    const res = await fetch(url);

    if (!res.ok) {
      console.log("Błąd pobierania offset " + offset + ": " + res.status);
      break;
    }

    const html = await res.text();
    const rows = parsujRankingFarmienia(html);

    for (const row of rows) {
      if (TARGET_ALLY_TAGS.includes(row.allyTag) && wynik.length < limit) {
        wynik.push(row);
      }
    }

    console.log("Znaleziono LN: " + wynik.length + "/" + limit);

    if (wynik.length >= limit) break;

    await sleep(randomInt(3000, 8000));
  }

  return wynik.slice(0, limit);
}

function parsujRankingFarmienia(html) {
  const rows = [];

  html = String(html)
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ");

  const trRegex = /<tr[^>]*>(.*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const tr = trMatch[1];

    const tdMatches = [];
    const tdRegex = /<td[^>]*>(.*?)<\/td>/gi;
    let tdMatch;

    while ((tdMatch = tdRegex.exec(tr)) !== null) {
      tdMatches.push(czyscHtml(tdMatch[1]));
    }

    if (tdMatches.length < 5) continue;

    const name = tdMatches[1];
    const allyTag = tdMatches[2];
    const value = parseInt(tdMatches[3].replace(/[^0-9]/g, ""), 10);
    const date = tdMatches[4].replace(/\.20\d{2}/, "");

    if (name && allyTag && !isNaN(value)) {
      rows.push({
        name,
        allyTag,
        value,
        date
      });
    }
  }

  return rows;
}

function dodajZmianyPozycji(list) {
  const oldList = wczytajRanking();
  const oldPositions = {};

  oldList.forEach((p, i) => {
    oldPositions[p.name + "|" + p.allyTag] = i + 1;
  });

  list.forEach((p, i) => {
    const currentPos = i + 1;
    const key = p.name + "|" + p.allyTag;
    const oldPos = oldPositions[key];

    if (!oldPos) {
      p.change = "NEW";
      p.awans = 0;
    } else if (oldPos > currentPos) {
      p.awans = oldPos - currentPos;
      p.change = "▲" + p.awans;
    } else if (oldPos < currentPos) {
      p.awans = 0;
      p.change = "▼" + (currentPos - oldPos);
    } else {
      p.awans = 0;
      p.change = "-";
    }
  });
}

function znajdzNajwiekszyAwans(list) {
  let best = null;

  for (const p of list) {
    if (p.awans && p.awans > 0) {
      if (!best || p.awans > best.awans) {
        best = p;
      }
    }
  }

  return best;
}

function formatujRanking(list) {
  let text = "```\n";

  list.forEach((p, i) => {
    let name = p.name;

    if (name.length > 16) {
      name = name.substring(0, 13) + "...";
    }

    const place = String(i + 1).padStart(2, " ");
    const line = place + ". " + name + " [" + p.allyTag + "]";
    const points = formatNumber(p.value);
    const change = p.change || "-";
    const date = p.date || "";

    text +=
      line.padEnd(32, " ") +
      points.padStart(10, " ") +
      " " +
      change.padEnd(4, " ") +
      " " +
      date +
      "\n";
  });

  return text + "```";
}

function czyscHtml(text) {
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wczytajRanking() {
  if (!fs.existsSync(SAVE_FILE)) return [];

  try {
    return JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function zapiszRanking(list) {
  const simple = list.map(p => ({
    name: p.name,
    allyTag: p.allyTag
  }));

  fs.writeFileSync(SAVE_FILE, JSON.stringify(simple, null, 2), "utf8");
}

function ustawCodziennyRanking() {
  setInterval(async () => {
    const now = new Date();

    if (now.getHours() === 0 && now.getMinutes() === 10) {
      await wyslijRankingFarmiacych();
    }
  }, 60 * 1000);
}

function formatNumber(value) {
  return Number(value).toLocaleString("pl-PL");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(process.env.DISCORD_TOKEN);